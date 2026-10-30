import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { GitCommandRunner } from '@/shared/types.js';

import { openInEditor, type OpenInEditorDependencies } from '../session-context-open.service.js';

const ROOT = path.resolve('/w');
const MAIN = path.join(ROOT, 'Ocuvera');
const WORKTREE = path.join(ROOT, 'Ocuvera-884-turningPrompt');
const SIBLING = path.join(ROOT, 'Ocuvera-882-amqpWebSocketsSpike');

const git: GitCommandRunner = async (args) => {
  const key = args.join(' ');
  if (key === 'rev-parse --show-toplevel') {
    return { stdout: `${WORKTREE}\n`, stderr: '' };
  }
  if (key === 'worktree list --porcelain') {
    return { stdout: `worktree ${MAIN}\nbranch refs/heads/master\n\nworktree ${WORKTREE}\n\nworktree ${SIBLING}\n`, stderr: '' };
  }
  throw new Error(`git ${key} failed`);
};

const setup = (overrides: Partial<OpenInEditorDependencies> = {}) => {
  const launches: string[][] = [];
  const touched: string[] = [];
  const deps: OpenInEditorDependencies = {
    runGit: git,
    realPath: async (candidate) => {
      touched.push(candidate);
      return candidate;
    },
    readWorkspaceRoot: async () => ROOT,
    launchEditor: async (args) => {
      launches.push(args);
    },
    ...overrides,
  };
  return { deps, launches, touched };
};

test('the checkout folder and its sibling worktrees open as folders', async () => {
  const { deps, launches } = setup();
  await openInEditor({ folderPath: WORKTREE, targetPath: WORKTREE }, deps);
  await openInEditor({ folderPath: WORKTREE, targetPath: SIBLING }, deps);

  assert.deepEqual(launches, [[WORKTREE], [SIBLING]]);
});

test('a note file opens in its checkout\'s window', async () => {
  const { deps, launches } = setup();
  const handoff = path.join(WORKTREE, '884-P5-HANDOFF.md');
  const designDoc = path.join(ROOT, 'DesignDocs', 'Ocuvera-884-x-DESIGN.md');
  await openInEditor({ folderPath: WORKTREE, targetPath: handoff }, deps);
  await openInEditor({ folderPath: WORKTREE, targetPath: designDoc }, deps);

  assert.deepEqual(launches, [[WORKTREE, handoff], [WORKTREE, designDoc]]);
});

test('a path the panel does not link to is refused before anything touches the disk', async () => {
  const { deps, launches, touched } = setup();
  const refused = [
    path.join(ROOT, 'Elsewhere'),
    path.join(ROOT, 'Elsewhere', 'notes.md'),
    path.join(WORKTREE, 'appsettings.json'),
    path.join(ROOT, 'DesignDocs', '..', 'secrets.md'),
    '\\\\attacker-host\\share\\x.md',
    '-n.md',
  ];
  for (const targetPath of refused) {
    await assert.rejects(openInEditor({ folderPath: WORKTREE, targetPath }, deps), /not one the context panel links to/);
  }
  assert.deepEqual(launches, []);
  assert.deepEqual(touched, []);
});

test('a note that is a link to a file outside the allowed folders is refused', async () => {
  const outside = path.join(ROOT, 'Elsewhere', 'secret.md');
  const { deps, launches } = setup({
    realPath: async (candidate) => (candidate.endsWith('linked.md') ? outside : candidate),
  });
  await assert.rejects(
    openInEditor({ folderPath: WORKTREE, targetPath: path.join(WORKTREE, 'linked.md') }, deps),
    /not one the context panel links to/,
  );
  assert.deepEqual(launches, []);
});

test('a missing path is reported, not launched', async () => {
  const { deps, launches } = setup({
    realPath: async () => {
      throw new Error('ENOENT');
    },
  });
  await assert.rejects(openInEditor({ folderPath: WORKTREE, targetPath: WORKTREE }, deps), /no longer exists/);
  await assert.rejects(openInEditor({ folderPath: WORKTREE, targetPath: path.join(WORKTREE, 'gone.md') }, deps), /no longer exists/);
  assert.deepEqual(launches, []);
});
