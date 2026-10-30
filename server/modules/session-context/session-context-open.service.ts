import path from 'node:path';

import type { GitCommandRunner } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { comparablePath, isInsideFolder, NOTE_FOLDERS } from '@/modules/session-context/session-context.helpers.js';

export type OpenInEditorDependencies = {
  runGit: GitCommandRunner;
  /** The path with every link and junction resolved; rejects when the path does not exist. */
  realPath: (candidatePath: string) => Promise<string>;
  readWorkspaceRoot: () => Promise<string | null>;
  /** Starts the editor with these arguments; rejects when it cannot start. */
  launchEditor: (args: string[]) => Promise<void>;
};

export type OpenInEditorInput = { folderPath: string; targetPath: string };

async function readCheckoutRoot(folderPath: string, runGit: GitCommandRunner): Promise<string> {
  try {
    const topLevel = (await runGit(['rev-parse', '--show-toplevel'], folderPath)).stdout.trim();
    return topLevel ? path.resolve(topLevel) : folderPath;
  } catch {
    return folderPath;
  }
}

async function readWorktreePaths(folderPath: string, runGit: GitCommandRunner): Promise<string[]> {
  try {
    const { stdout } = await runGit(['worktree', 'list', '--porcelain'], folderPath);
    return stdout.split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => path.resolve(line.slice('worktree '.length)));
  } catch {
    return [];
  }
}

const notAllowed = () => new AppError('That path is not one the context panel links to', {
  code: 'OPEN_PATH_NOT_ALLOWED',
  statusCode: 403,
});

const missing = () => new AppError('That path no longer exists', { code: 'OPEN_PATH_MISSING', statusCode: 404 });

/**
 * Opens a folder, or a note file inside its checkout's window, in VS Code on
 * this machine. `code <folder>` opens the folder in a new window, or brings
 * forward the window that already has it. Only the paths the panel shows are
 * accepted: the project's checkout, its repo's worktrees, and `.md` notes in
 * the checkout or the workspace's note folders.
 *
 * The allow-list runs on the path text before anything touches the disk, so a
 * refused path (a UNC share, for example) is never opened, even to test that it
 * exists. A note is then checked again after links and junctions are resolved.
 */
export async function openInEditor({ folderPath, targetPath }: OpenInEditorInput, deps: OpenInEditorDependencies): Promise<void> {
  const target = path.resolve(targetPath);
  const [checkoutRoot, worktrees, workspaceRoot] = await Promise.all([
    readCheckoutRoot(folderPath, deps.runGit),
    readWorktreePaths(folderPath, deps.runGit),
    deps.readWorkspaceRoot(),
  ]);

  const allowedFolders = [folderPath, checkoutRoot, ...worktrees];
  if (allowedFolders.some((folder) => comparablePath(folder) === comparablePath(target))) {
    const realTarget = await deps.realPath(target).catch(() => {
      throw missing();
    });
    await deps.launchEditor([realTarget]);
    return;
  }

  const allowedParents = [
    checkoutRoot,
    ...(workspaceRoot ? Object.values(NOTE_FOLDERS).map((folder) => path.join(workspaceRoot, folder)) : []),
  ];
  const isNoteText = target.toLowerCase().endsWith('.md') && allowedParents.some((parent) => isInsideFolder(target, parent));
  if (!isNoteText) {
    throw notAllowed();
  }

  const realTarget = await deps.realPath(target).catch(() => {
    throw missing();
  });
  const realParents = await Promise.all(allowedParents.map((parent) => deps.realPath(parent).catch(() => parent)));
  if (!realParents.some((parent) => isInsideFolder(realTarget, parent))) {
    throw notAllowed();
  }
  await deps.launchEditor([checkoutRoot, realTarget]);
}
