import { access, readdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import { projectsDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { runGitCommand } from '@/modules/worktrees/index.js';
import { createSessionContextRouter } from '@/modules/session-context/session-context.routes.js';
import type { GitHubRepo } from '@/modules/session-context/session-context.helpers.js';
import { openInEditor } from '@/modules/session-context/session-context-open.service.js';
import {
  createSessionContextReader,
  type LastReply,
  type SessionContextPullRequest,
} from '@/modules/session-context/session-context.service.js';
import { AppError } from '@/shared/utils.js';

const GH_TIMEOUT_MS = 5000;
const EDITOR_LAUNCH_DEADLINE_MS = 5000;
/** The tail of a transcript searched for Claude's last reply; tool rows sit between replies. */
const LAST_REPLY_SEARCH_DEPTH = 40;
const TRILLIAN_WORKTREES_CONFIG = path.join(os.homedir(), '.config', 'trillian', 'worktrees.json');

/** Runs `gh` with a deadline; resolves null on any failure, since a PR link is optional. */
function runGh(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, { cwd, shell: false });
    let stdout = '';
    // Read stderr too: an unread pipe that fills up blocks gh until the timeout.
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      console.warn(`[session-context] gh ${args.slice(0, 2).join(' ')} timed out after ${GH_TIMEOUT_MS} ms in ${cwd}`);
      resolve(null);
    }, GH_TIMEOUT_MS);
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      console.warn('[session-context] gh could not start:', error.message);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.warn(`[session-context] gh ${args.slice(0, 2).join(' ')} exited ${code} in ${cwd}: ${stderr.trim()}`);
      }
      resolve(code === 0 ? stdout : null);
    });
  });
}

/** A few candidates, so an open PR wins over an older closed one that reused the branch name. */
const PULL_REQUEST_CANDIDATES = 5;

async function findPullRequest(folderPath: string, branch: string, repo: GitHubRepo): Promise<SessionContextPullRequest | null> {
  const output = await runGh(
    [
      'pr', 'list',
      '--repo', `${repo.owner}/${repo.name}`,
      '--head', branch,
      '--state', 'all',
      '--limit', String(PULL_REQUEST_CANDIDATES),
      '--json', 'number,url,state',
    ],
    folderPath,
  );
  if (!output) {
    return null;
  }
  try {
    const candidates = (JSON.parse(output) as Array<Partial<SessionContextPullRequest>>)
      .filter((pr): pr is SessionContextPullRequest => typeof pr.number === 'number' && typeof pr.url === 'string');
    const chosen = candidates.find((pr) => pr.state === 'OPEN') ?? candidates[0];
    return chosen ? { number: chosen.number, url: chosen.url, state: String(chosen.state ?? '') } : null;
  } catch (error) {
    console.warn('[session-context] unreadable gh output:', error);
    return null;
  }
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath);
    return true;
  } catch {
    return false;
  }
}

async function listFileNames(folderPath: string): Promise<string[]> {
  try {
    const entries = await readdir(folderPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readWorkspaceRoot(): Promise<string | null> {
  const config = await readTextFile(TRILLIAN_WORKTREES_CONFIG);
  if (!config) {
    return null;
  }
  try {
    const parsed = JSON.parse(config) as { root?: unknown };
    return typeof parsed.root === 'string' && parsed.root ? path.resolve(parsed.root) : null;
  } catch (error) {
    console.warn(`[session-context] unreadable ${TRILLIAN_WORKTREES_CONFIG}:`, error);
    return null;
  }
}

/**
 * Runs VS Code's `code` command detached. On Windows cross-spawn runs
 * `code.cmd` through cmd.exe, which starts even when `code` is missing, so the
 * result comes from the exit code: `code` hands the arguments to the running
 * editor and exits at once. A launch still running after the deadline counts
 * as started, so a slow cmd.exe cannot hold the request.
 */
function launchVsCode(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (detail: string) => reject(new AppError(`Could not start VS Code: ${detail}`, {
      code: 'EDITOR_LAUNCH_FAILED',
      statusCode: 500,
    }));
    const child = spawn('code', args, { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    child.unref();
    const timer = setTimeout(resolve, EDITOR_LAUNCH_DEADLINE_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      fail(error.message);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        fail(`code exited with ${code}`);
      }
    });
  });
}

async function readLastReply(sessionId: string): Promise<LastReply | null> {
  const { messages } = await sessionsService.fetchHistory(sessionId, { limit: LAST_REPLY_SEARCH_DEPTH });
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind === 'text' && message.role === 'assistant' && message.content?.trim()) {
      return { timestamp: message.timestamp, content: message.content };
    }
  }
  return null;
}

const readSessionContext = createSessionContextReader({
  runGit: runGitCommand,
  findPullRequest,
  pathExists,
  listFileNames,
  readTextFile,
  readWorkspaceRoot,
  readLastReply,
  logError: (message, error) => console.warn(message, error),
});

/** Router mounted by the server entrypoint at `/api/session-context`. */
export const sessionContextRoutes = createSessionContextRouter({
  resolveProjectPath(projectId) {
    const projectPath = projectsDb.getProjectPathById(projectId);
    if (!projectPath) {
      throw new AppError(`Unable to resolve project path for "${projectId}"`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    return projectPath;
  },
  read: readSessionContext,
  openInEditor: (input) => openInEditor(input, {
    runGit: runGitCommand,
    realPath: (candidatePath) => realpath(candidatePath),
    readWorkspaceRoot,
    launchEditor: launchVsCode,
  }),
});
