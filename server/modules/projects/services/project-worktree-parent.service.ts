import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeProjectPath } from '@/shared/utils.js';

const GITDIR_PREFIX = 'gitdir:';

/**
 * The main checkout a git worktree belongs to, or null for a main checkout, a
 * folder outside git, or a submodule.
 *
 * A worktree's `.git` is a file, `gitdir: <main>/.git/worktrees/<name>`, so
 * this reads one small file instead of running git for every project.
 */
export async function readWorktreeMainPath(projectPath: string): Promise<string | null> {
  let gitFileText: string;
  try {
    const gitPath = path.join(projectPath, '.git');
    if (!(await fs.stat(gitPath)).isFile()) {
      return null;
    }
    gitFileText = await fs.readFile(gitPath, 'utf8');
  } catch {
    // No `.git`, or one that cannot be read: show the folder as its own project.
    return null;
  }

  const firstLine = gitFileText.split(/\r?\n/, 1)[0].trim();
  if (!firstLine.startsWith(GITDIR_PREFIX)) {
    return null;
  }
  const gitDir = path.resolve(projectPath, firstLine.slice(GITDIR_PREFIX.length).trim());
  const worktreesDir = path.dirname(gitDir);
  const mainGitDir = path.dirname(worktreesDir);
  if (path.basename(worktreesDir) !== 'worktrees' || path.basename(mainGitDir) !== '.git') {
    return null;
  }
  return normalizeProjectPath(path.dirname(mainGitDir));
}
