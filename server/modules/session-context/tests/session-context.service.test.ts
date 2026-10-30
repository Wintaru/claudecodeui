import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { GitCommandRunner } from '@/shared/types.js';

import { createSessionContextReader, type SessionContextDependencies } from '../session-context.service.js';

const ROOT = path.resolve('/w');
const WORKTREE = path.join(ROOT, 'Ocuvera-884-turningPrompt');
const MAIN = path.join(ROOT, 'Ocuvera');

/** A fake git that answers from a table keyed by the joined arguments. */
const fakeGit = (answers: Record<string, string>): GitCommandRunner => async (args) => {
  const key = args.join(' ');
  if (key in answers) {
    return { stdout: answers[key], stderr: '' };
  }
  throw new Error(`git ${key} failed`);
};

const UPSTREAM_QUERY = 'for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:short) refs/heads/884-turningPrompt';

const WORKTREE_GIT = {
  'rev-parse --show-toplevel': WORKTREE,
  'symbolic-ref --quiet --short HEAD': '884-turningPrompt',
  // The unstaged entry comes first: its leading space is the staged column and must survive.
  'status --porcelain': ' M changed.cs\nM  staged.cs\n?? new.cs\n',
  'remote get-url origin': 'https://github.com/Ocuvera/Ocuvera.git',
  'rev-parse --path-format=absolute --git-common-dir': path.join(MAIN, '.git'),
  'symbolic-ref --quiet --short refs/remotes/origin/HEAD': 'origin/master',
  'worktree list --porcelain': `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/master\n\nworktree ${WORKTREE}\nHEAD def\nbranch refs/heads/884-turningPrompt\n`,
};

const baseDeps = (overrides: Partial<SessionContextDependencies> = {}): SessionContextDependencies => ({
  runGit: fakeGit(WORKTREE_GIT),
  findPullRequest: async () => null,
  pathExists: async () => true,
  listFileNames: async (folder) => ({
    [WORKTREE]: ['884-P5-HANDOFF.md', 'README.md'],
    [path.join(ROOT, 'handoffs', 'Ocuvera-884-turningPrompt')]: ['PR-BODY.md', 'notes.md'],
    [path.join(ROOT, 'DesignDocs')]: ['Ocuvera-884-patient-position-manager-DESIGN.md', 'Ocuvera-880-x-DESIGN.md', 'TEMPLATE.md'],
    [path.join(ROOT, 'walkthroughs', 'Ocuvera')]: ['884-turningPrompt-WALKTHROUGH.md'],
  }[folder] ?? []),
  readTextFile: async () => null,
  readWorkspaceRoot: async () => ROOT,
  readLastReply: async () => ({ timestamp: '2026-10-30T12:00:00Z', content: 'Run:\n```powershell\nov-test\n```' }),
  logError: () => {},
  ...overrides,
});

test('a worktree with no upstream gets the -u push, issue, compare link, notes, and last-reply blocks', async () => {
  const read = createSessionContextReader(baseDeps());
  const context = await read({ folderPath: WORKTREE, sessionId: 's1' });

  assert.equal(context.git?.pushCommand, `git -C ${WORKTREE} push -u origin 884-turningPrompt`);
  assert.equal(context.git?.ahead, null);
  assert.equal(context.git?.changedFileCount, 3);
  assert.equal(context.git?.stagedFileCount, 1);
  assert.deepEqual(context.issue, { number: 884, url: 'https://github.com/Ocuvera/Ocuvera/issues/884' });
  assert.equal(context.compareUrl, 'https://github.com/Ocuvera/Ocuvera/compare/master...884-turningPrompt?expand=1');
  assert.deepEqual(context.notes.map((note) => [note.kind, note.name]), [
    ['checkout', '884-P5-HANDOFF.md'],
    ['prBody', 'PR-BODY.md'],
    ['handoff', 'notes.md'],
    ['designDoc', 'Ocuvera-884-patient-position-manager-DESIGN.md'],
    ['walkthrough', '884-turningPrompt-WALKTHROUGH.md'],
  ]);
  assert.deepEqual(context.worktrees.map((worktree) => [worktree.branch, worktree.isCurrent]), [
    ['master', false],
    ['884-turningPrompt', true],
  ]);
  assert.deepEqual(context.lastReply?.blocks, [{ language: 'powershell', code: 'ov-test' }]);
});

test('an upstream gives a plain push and ahead/behind counts; an open PR replaces the compare link', async () => {
  const read = createSessionContextReader(baseDeps({
    runGit: fakeGit({
      ...WORKTREE_GIT,
      [UPSTREAM_QUERY]: 'origin\0refs/heads/884-turningPrompt\0origin/884-turningPrompt\n',
      'rev-list --count --left-right origin/884-turningPrompt...HEAD': '1\t3',
    }),
    findPullRequest: async () => ({ number: 1148, url: 'https://github.com/Ocuvera/Ocuvera/pull/1148', state: 'OPEN' }),
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.git?.pushCommand, `git -C ${WORKTREE} push`);
  assert.equal(context.git?.ahead, 3);
  assert.equal(context.git?.behind, 1);
  assert.equal(context.pullRequest?.number, 1148);
  assert.equal(context.compareUrl, null);
  assert.equal(context.lastReply, null);
});

test('a branch that tracks another branch gets the -u push and no counts', async () => {
  const read = createSessionContextReader(baseDeps({
    runGit: fakeGit({
      ...WORKTREE_GIT,
      [UPSTREAM_QUERY]: 'origin\0refs/heads/develop\0origin/develop\n',
    }),
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.git?.hasUpstream, false);
  assert.equal(context.git?.pushCommand, `git -C ${WORKTREE} push -u origin 884-turningPrompt`);
  assert.equal(context.git?.ahead, null);
});

test('a branch that tracks a local branch pushes to origin, not to a remote named after the branch', async () => {
  const read = createSessionContextReader(baseDeps({
    runGit: fakeGit({ ...WORKTREE_GIT, [UPSTREAM_QUERY]: '.\0refs/heads/master\0master\n' }),
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.git?.pushCommand, `git -C ${WORKTREE} push -u origin 884-turningPrompt`);
});

test('a failed ahead/behind count stays unknown instead of "nothing to push"', async () => {
  const errors: string[] = [];
  const read = createSessionContextReader(baseDeps({
    runGit: fakeGit({ ...WORKTREE_GIT, [UPSTREAM_QUERY]: 'origin\0refs/heads/884-turningPrompt\0origin/884-turningPrompt\n' }),
    logError: (message) => errors.push(message),
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.git?.hasUpstream, true);
  assert.equal(context.git?.ahead, null);
  assert.equal(context.git?.behind, null);
  assert.equal(errors.length, 1);
});

test('the PR lookup is cached per folder and branch', async () => {
  let lookups = 0;
  let clock = 0;
  const read = createSessionContextReader(baseDeps({
    findPullRequest: async () => {
      lookups += 1;
      return null;
    },
  }), () => clock);

  await read({ folderPath: WORKTREE, sessionId: null });
  await read({ folderPath: WORKTREE, sessionId: null });
  assert.equal(lookups, 1);
  clock = 3 * 60 * 1000;
  await read({ folderPath: WORKTREE, sessionId: null });
  assert.equal(lookups, 2);
});

test('the base branch gets no PR lookup and no compare link', async () => {
  let lookups = 0;
  const read = createSessionContextReader(baseDeps({
    runGit: fakeGit({ ...WORKTREE_GIT, 'symbolic-ref --quiet --short HEAD': 'master' }),
    findPullRequest: async () => {
      lookups += 1;
      return { number: 84, url: 'https://github.com/Ocuvera/Ocuvera/pull/84', state: 'CLOSED' };
    },
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(lookups, 0);
  assert.equal(context.pullRequest, null);
  assert.equal(context.compareUrl, null);
});

test('a removed folder has no git facts and no push command', async () => {
  const read = createSessionContextReader(baseDeps({ pathExists: async () => false }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.folderExists, false);
  assert.equal(context.git, null);
  assert.deepEqual(context.worktrees, []);
  assert.equal(context.issue?.number, 884);
});

test('a folder outside git keeps its notes and drops the git parts', async () => {
  const read = createSessionContextReader(baseDeps({ runGit: fakeGit({}) }));
  const context = await read({ folderPath: WORKTREE, sessionId: null });

  assert.equal(context.git, null);
  assert.equal(context.compareUrl, null);
  assert.deepEqual(context.notes.map((note) => note.kind), ['checkout', 'prBody', 'handoff']);
});

test('a failed last-reply read is logged and leaves the rest intact', async () => {
  const errors: string[] = [];
  const read = createSessionContextReader(baseDeps({
    readLastReply: async () => {
      throw new Error('transcript gone');
    },
    logError: (message) => errors.push(message),
  }));
  const context = await read({ folderPath: WORKTREE, sessionId: 's1' });

  assert.equal(context.lastReply, null);
  assert.equal(context.git?.branch, '884-turningPrompt');
  assert.equal(errors.length, 1);
});
