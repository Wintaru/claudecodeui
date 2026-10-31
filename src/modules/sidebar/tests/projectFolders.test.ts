import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Project } from '@/shared/types';
import { isSameFolderPath, nestWorktreeProjects } from '@/modules/sidebar/utils/sidebarProjectFormatting';

/**
 * The project list is one row per folder. A git worktree sits under the repo
 * it was made from, so a repo with many worktrees reads as one group.
 */

const project = (projectId: string, fullPath: string, worktreeOf: string | null = null): Project => ({
  projectId,
  displayName: projectId,
  fullPath,
  worktreeOf,
});

test('the same folder matches however each tool spelled it', () => {
  assert.equal(isSameFolderPath('C:\\workspaces\\Ocuvera\\', 'c:/workspaces/ocuvera'), true);
  assert.equal(isSameFolderPath('c:\\workspaces\\Ocuvera', 'c:\\workspaces\\Ocuvera-884'), false);
  assert.equal(isSameFolderPath('/home/j/Repo', '/home/j/repo'), false, 'POSIX paths keep their case');
});

test('worktrees follow their repo, and the list keeps its order otherwise', () => {
  const rows = nestWorktreeProjects([
    project('trillian', 'c:\\workspaces\\AgenticTrillian'),
    project('wt-b', 'c:\\workspaces\\Ocuvera-b', 'c:\\workspaces\\Ocuvera'),
    project('ocuvera', 'c:\\workspaces\\Ocuvera'),
    project('wt-a', 'c:\\workspaces\\Ocuvera-a', 'C:\\workspaces\\Ocuvera'),
  ]);

  assert.deepEqual(
    rows.map((row) => [row.project.projectId, row.parentProjectId, row.worktreeCount]),
    [
      ['trillian', null, 0],
      ['ocuvera', null, 2],
      ['wt-b', 'ocuvera', 0],
      ['wt-a', 'ocuvera', 0],
    ],
  );
});

test('a starred worktree keeps its place in the starred group', () => {
  const rows = nestWorktreeProjects([
    { ...project('wt-a', 'c:\\workspaces\\Ocuvera-a', 'c:\\workspaces\\Ocuvera'), isStarred: true },
    project('ocuvera', 'c:\\workspaces\\Ocuvera'),
  ]);

  assert.deepEqual(rows.map((row) => [row.project.projectId, row.parentProjectId]), [['wt-a', null], ['ocuvera', null]]);
});

test('a worktree whose repo is not in the list stays a top-level row', () => {
  const rows = nestWorktreeProjects([
    project('wt-a', 'c:\\workspaces\\Ocuvera-a', 'c:\\workspaces\\Ocuvera'),
  ]);

  assert.deepEqual(rows, [{ project: rows[0].project, parentProjectId: null, worktreeCount: 0 }]);
});
