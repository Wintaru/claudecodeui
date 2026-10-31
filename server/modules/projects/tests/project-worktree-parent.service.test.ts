import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readWorktreeMainPath } from '@/modules/projects/services/project-worktree-parent.service.js';
import { normalizeProjectPath } from '@/shared/utils.js';

async function withFolders(runTest: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'worktree-parent-'));
  try {
    await runTest(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a worktree names its main checkout', async () => {
  await withFolders(async (root) => {
    const main = path.join(root, 'Repo');
    const worktree = path.join(root, 'Repo-feature');
    await mkdir(path.join(main, '.git', 'worktrees', 'Repo-feature'), { recursive: true });
    await mkdir(worktree);
    await writeFile(path.join(worktree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'Repo-feature')}\n`);

    assert.equal(await readWorktreeMainPath(worktree), normalizeProjectPath(main));
  });
});

test('a main checkout, a plain folder and a submodule have no main checkout', async () => {
  await withFolders(async (root) => {
    const main = path.join(root, 'Repo');
    await mkdir(path.join(main, '.git'), { recursive: true });
    const plain = path.join(root, 'notes');
    await mkdir(plain);
    const submodule = path.join(root, 'Repo', 'lib');
    await mkdir(submodule, { recursive: true });
    await writeFile(path.join(submodule, '.git'), 'gitdir: ../.git/modules/lib\n');

    assert.equal(await readWorktreeMainPath(main), null);
    assert.equal(await readWorktreeMainPath(plain), null);
    assert.equal(await readWorktreeMainPath(submodule), null);
    assert.equal(await readWorktreeMainPath(path.join(root, 'missing')), null);
  });
});
