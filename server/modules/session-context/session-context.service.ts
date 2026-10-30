import path from 'node:path';

import type { GitCommandRunner } from '@/shared/types.js';
import {
  buildPushCommand,
  comparablePath,
  extractCodeBlocks,
  isCheckoutNoteFile,
  matchesCheckoutDoc,
  NOTE_FOLDERS,
  parseGitHubRepo,
  parseIssueNumber,
  type GitHubRepo,
  type ReplyCodeBlock,
} from '@/modules/session-context/session-context.helpers.js';

export type SessionContextNoteKind = 'checkout' | 'prBody' | 'handoff' | 'designDoc' | 'walkthrough';

export type SessionContextNote = { kind: SessionContextNoteKind; name: string; path: string };

export type SessionContextGit = {
  branch: string | null;
  hasUpstream: boolean;
  remoteName: string | null;
  /** Null when the branch has no upstream yet, so nothing can be compared. */
  ahead: number | null;
  behind: number | null;
  changedFileCount: number;
  stagedFileCount: number;
  pushCommand: string | null;
  repo: GitHubRepo | null;
};

export type SessionContextPullRequest = { number: number; url: string; state: string };

export type SessionContextWorktree = { path: string; branch: string | null; isCurrent: boolean };

export type SessionContext = {
  folderPath: string;
  folderExists: boolean;
  git: SessionContextGit | null;
  issue: { number: number; url: string | null } | null;
  pullRequest: SessionContextPullRequest | null;
  compareUrl: string | null;
  notes: SessionContextNote[];
  worktrees: SessionContextWorktree[];
  lastReply: { timestamp: string; blocks: ReplyCodeBlock[] } | null;
};

export type LastReply = { timestamp: string; content: string };

export type SessionContextDependencies = {
  runGit: GitCommandRunner;
  /** `gh pr list` for one branch of one repo; resolves null when gh is missing, slow, or finds nothing. */
  findPullRequest: (folderPath: string, branch: string, repo: GitHubRepo) => Promise<SessionContextPullRequest | null>;
  pathExists: (candidatePath: string) => Promise<boolean>;
  /** File names in a folder; an empty list when the folder does not exist. */
  listFileNames: (folderPath: string) => Promise<string[]>;
  readTextFile: (filePath: string) => Promise<string | null>;
  /** Trillian's worktree root (`root` in `~/.config/trillian/worktrees.json`), or null. */
  readWorkspaceRoot: () => Promise<string | null>;
  readLastReply: (sessionId: string) => Promise<LastReply | null>;
  logError: (message: string, error: unknown) => void;
};

export type ReadSessionContextInput = { folderPath: string; sessionId: string | null };

const PULL_REQUEST_CACHE_MS = 2 * 60 * 1000;
const NO_PULL_REQUEST_CACHE_MS = 20 * 1000;

type GitErrorLogger = SessionContextDependencies['logError'];

/**
 * Runs git and returns stdout untrimmed, or null when it fails. Failures that
 * are a normal answer (no upstream, detached HEAD) pass no logger.
 */
async function tryGitRaw(runGit: GitCommandRunner, args: string[], cwd: string, logError?: GitErrorLogger): Promise<string | null> {
  try {
    return (await runGit(args, cwd)).stdout;
  } catch (error) {
    logError?.(`[session-context] git ${args.join(' ')} failed in ${cwd}`, error);
    return null;
  }
}

async function tryGit(runGit: GitCommandRunner, args: string[], cwd: string, logError?: GitErrorLogger): Promise<string | null> {
  const output = await tryGitRaw(runGit, args, cwd, logError);
  return output === null ? null : output.trim();
}

/** Counts porcelain entries. The first column is the staged state, so the output must not be trimmed. */
function countStatus(porcelain: string): { changed: number; staged: number } {
  const lines = porcelain.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const staged = lines.filter((line) => line[0] !== ' ' && line[0] !== '?').length;
  return { changed: lines.length, staged };
}

type Upstream = { remoteName: string; remoteRef: string; shortName: string };

/** The branch's configured upstream, or null when it has none or it is a local branch. */
async function readUpstream(branch: string, folderPath: string, runGit: GitCommandRunner): Promise<Upstream | null> {
  const output = await tryGit(
    runGit,
    ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short)', `refs/heads/${branch}`],
    folderPath,
  );
  const [remoteName, remoteRef, shortName] = (output ?? '').split('\0');
  // A remote name of "." means the upstream is a local branch, which a push does not go to.
  return remoteName && remoteName !== '.' && remoteRef && shortName ? { remoteName, remoteRef, shortName } : null;
}

async function readGit(folderPath: string, deps: SessionContextDependencies): Promise<{ git: SessionContextGit; mainCheckout: string; topLevel: string } | null> {
  const { runGit, logError } = deps;
  const topLevel = await tryGit(runGit, ['rev-parse', '--show-toplevel'], folderPath);
  if (topLevel === null) {
    return null;
  }

  const [branchOutput, status, remoteUrl, commonDir] = await Promise.all([
    tryGit(runGit, ['symbolic-ref', '--quiet', '--short', 'HEAD'], folderPath),
    tryGitRaw(runGit, ['status', '--porcelain'], folderPath, logError),
    tryGit(runGit, ['remote', 'get-url', 'origin'], folderPath),
    tryGit(runGit, ['rev-parse', '--path-format=absolute', '--git-common-dir'], folderPath, logError),
  ]);

  const branch = branchOutput || null;
  const upstream = branch ? await readUpstream(branch, folderPath, runGit) : null;
  // Only an upstream that is this branch on a remote makes a plain push correct. A
  // branch cut from origin/develop without --no-track tracks develop; a plain push
  // there fails or pushes onto develop, so it gets `-u` like a branch with no upstream.
  const tracksOwnBranch = Boolean(branch && upstream && upstream.remoteRef === `refs/heads/${branch}`);

  let ahead: number | null = null;
  let behind: number | null = null;
  if (tracksOwnBranch && upstream) {
    const counts = await tryGit(runGit, ['rev-list', '--count', '--left-right', `${upstream.shortName}...HEAD`], folderPath, logError);
    const [behindRaw, aheadRaw] = (counts ?? '').split(/\s+/);
    const parsedBehind = Number.parseInt(behindRaw ?? '', 10);
    const parsedAhead = Number.parseInt(aheadRaw ?? '', 10);
    // Unknown stays null, so a failed count never reads as "Nothing to push".
    behind = Number.isNaN(parsedBehind) ? null : parsedBehind;
    ahead = Number.isNaN(parsedAhead) ? null : parsedAhead;
  }

  const remoteName = upstream?.remoteName ?? (remoteUrl !== null ? 'origin' : null);
  const counts = countStatus(status ?? '');
  // The common git dir is `<main checkout>/.git` for the main checkout and every linked worktree.
  const mainCheckout = commonDir ? path.dirname(path.resolve(commonDir)) : path.resolve(topLevel);

  return {
    mainCheckout,
    topLevel,
    git: {
      branch,
      hasUpstream: tracksOwnBranch,
      remoteName,
      ahead,
      behind,
      changedFileCount: counts.changed,
      stagedFileCount: counts.staged,
      pushCommand: remoteName ? buildPushCommand({ folderPath, branch, hasUpstream: tracksOwnBranch, remoteName }) : null,
      repo: remoteUrl ? parseGitHubRepo(remoteUrl) : null,
    },
  };
}

async function readBaseBranch(mainCheckout: string, deps: SessionContextDependencies): Promise<string | null> {
  const repoConfig = await deps.readTextFile(path.join(mainCheckout, '.trillian-repo.json'));
  if (repoConfig) {
    try {
      const parsed = JSON.parse(repoConfig) as { git?: { baseBranch?: unknown } };
      if (typeof parsed.git?.baseBranch === 'string' && parsed.git.baseBranch) {
        return parsed.git.baseBranch;
      }
    } catch (error) {
      deps.logError(`[session-context] unreadable .trillian-repo.json in ${mainCheckout}`, error);
    }
  }
  const originHead = await tryGit(deps.runGit, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], mainCheckout);
  return originHead ? originHead.replace(/^origin\//, '') : null;
}

/** `checkoutRoot` is the checkout's top level, so a project opened at a subfolder still finds its own worktree. */
async function readWorktrees(checkoutRoot: string, runGit: GitCommandRunner): Promise<SessionContextWorktree[]> {
  const output = await tryGit(runGit, ['worktree', 'list', '--porcelain'], checkoutRoot);
  if (!output) {
    return [];
  }
  const current = comparablePath(checkoutRoot);
  const worktrees: SessionContextWorktree[] = [];
  for (const block of output.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const worktreeLine = lines.find((line) => line.startsWith('worktree '));
    if (!worktreeLine) {
      continue;
    }
    const worktreePath = path.resolve(worktreeLine.slice('worktree '.length));
    const branchLine = lines.find((line) => line.startsWith('branch '));
    worktrees.push({
      path: worktreePath,
      branch: branchLine ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '') : null,
      isCurrent: comparablePath(worktreePath) === current,
    });
  }
  return worktrees;
}

type NoteMatch = { repoName: string | null; issueNumber: number | null; branchSlug: string | null };

async function readNotes(
  folderPath: string,
  folderExists: boolean,
  workspaceRoot: string | null,
  match: NoteMatch,
  deps: SessionContextDependencies,
): Promise<SessionContextNote[]> {
  const inFolder = async (folder: string, kind: SessionContextNoteKind, keep: (name: string) => boolean) => (
    (await deps.listFileNames(folder))
      .filter(keep)
      .sort((a, b) => a.localeCompare(b))
      .map((name): SessionContextNote => ({ kind, name, path: path.join(folder, name) }))
  );

  const checkoutNotes = folderExists ? await inFolder(folderPath, 'checkout', isCheckoutNoteFile) : [];
  if (!workspaceRoot) {
    return checkoutNotes;
  }

  const handoffFolder = path.join(workspaceRoot, NOTE_FOLDERS.handoffs, path.basename(folderPath));
  const [handoffNotes, designDocs, walkthroughs] = await Promise.all([
    inFolder(handoffFolder, 'handoff', (name) => name.toLowerCase().endsWith('.md')),
    match.repoName
      ? inFolder(path.join(workspaceRoot, NOTE_FOLDERS.designDocs), 'designDoc', (name) => matchesCheckoutDoc(name, match))
      : Promise.resolve([]),
    match.repoName
      ? inFolder(
        path.join(workspaceRoot, NOTE_FOLDERS.walkthroughs, match.repoName),
        'walkthrough',
        (name) => matchesCheckoutDoc(name, { ...match, repoName: null }),
      )
      : Promise.resolve([]),
  ]);

  const prBodies = handoffNotes
    .filter((note) => note.name.toLowerCase() === 'pr-body.md')
    .map((note): SessionContextNote => ({ ...note, kind: 'prBody' }));
  const otherHandoffs = handoffNotes.filter((note) => note.name.toLowerCase() !== 'pr-body.md');

  return [...checkoutNotes, ...prBodies, ...otherHandoffs, ...designDocs, ...walkthroughs];
}

async function readLastReplyBlocks(sessionId: string | null, deps: SessionContextDependencies): Promise<SessionContext['lastReply']> {
  if (!sessionId) {
    return null;
  }
  try {
    const reply = await deps.readLastReply(sessionId);
    return reply ? { timestamp: reply.timestamp, blocks: extractCodeBlocks(reply.content) } : null;
  } catch (error) {
    deps.logError(`[session-context] could not read the last reply of session ${sessionId}`, error);
    return null;
  }
}

/**
 * Builds the reader for the sidebar's context panel. It keeps a short PR cache,
 * because `gh` is a network call and the panel asks again on every focus change.
 */
export function createSessionContextReader(deps: SessionContextDependencies, now: () => number = Date.now) {
  // Holds the promise, so a burst of requests shares one `gh` call.
  const pullRequestCache = new Map<string, { value: Promise<SessionContextPullRequest | null>; expiresAt: number }>();

  const findPullRequestCached = (folderPath: string, branch: string, repo: GitHubRepo) => {
    const key = `${comparablePath(folderPath)}|${branch}`;
    const cached = pullRequestCache.get(key);
    if (cached && cached.expiresAt > now()) {
      return cached.value;
    }
    const value = deps.findPullRequest(folderPath, branch, repo);
    pullRequestCache.set(key, { value, expiresAt: now() + PULL_REQUEST_CACHE_MS });
    // "No PR" (or a gh failure) is kept briefly, so a PR opened a moment ago shows up soon.
    value.then(
      (found) => {
        if (!found) {
          pullRequestCache.set(key, { value, expiresAt: now() + NO_PULL_REQUEST_CACHE_MS });
        }
      },
      () => pullRequestCache.delete(key),
    );
    return value;
  };

  return async function readSessionContext({ folderPath, sessionId }: ReadSessionContextInput): Promise<SessionContext> {
    const [folderExists, workspaceRoot, lastReply] = await Promise.all([
      deps.pathExists(folderPath),
      deps.readWorkspaceRoot(),
      readLastReplyBlocks(sessionId, deps),
    ]);

    const gitResult = folderExists ? await readGit(folderPath, deps) : null;
    const git = gitResult?.git ?? null;
    const branch = git?.branch ?? null;
    const issueNumber = parseIssueNumber(branch, folderPath);
    const repoName = gitResult ? path.basename(gitResult.mainCheckout) : null;

    const [baseBranch, worktrees] = await Promise.all([
      gitResult ? readBaseBranch(gitResult.mainCheckout, deps) : Promise.resolve(null),
      gitResult ? readWorktrees(gitResult.topLevel, deps.runGit) : Promise.resolve([]),
    ]);

    // The base branch has no PR of its own; `gh pr list --head master` finds some old PR from a fork.
    const isFeatureBranch = Boolean(branch && branch !== baseBranch);
    const pullRequest = isFeatureBranch && branch && git?.repo ? await findPullRequestCached(folderPath, branch, git.repo) : null;
    const notes = await readNotes(folderPath, folderExists, workspaceRoot, {
      repoName,
      issueNumber,
      branchSlug: isFeatureBranch ? branch?.split('/').pop() ?? null : null,
    }, deps);

    const repo = git?.repo ?? null;
    const repoUrl = repo ? `https://github.com/${repo.owner}/${repo.name}` : null;

    return {
      folderPath,
      folderExists,
      git,
      issue: issueNumber !== null ? { number: issueNumber, url: repoUrl ? `${repoUrl}/issues/${issueNumber}` : null } : null,
      pullRequest,
      compareUrl: repoUrl && baseBranch && isFeatureBranch && !pullRequest
        ? `${repoUrl}/compare/${baseBranch}...${branch}?expand=1`
        : null,
      notes,
      worktrees,
      lastReply,
    };
  };
}
