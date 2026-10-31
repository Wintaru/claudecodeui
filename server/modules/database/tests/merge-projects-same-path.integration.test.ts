import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { mergeProjectsWithSameNormalizedPath } from '@/modules/database/migrations.js';

/**
 * Rows written before drive letters were normalized: the same Windows folder
 * under `c:` and `C:`, which the sidebar showed as two projects.
 */

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'merge-projects-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function seedLegacyRows(): void {
  const db = getConnection();
  const insertProject = db.prepare(
    'INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived) VALUES (?, ?, ?, ?, 0)',
  );
  insertProject.run('lower', 'c:\\workspaces\\Repo', 'Repo', 0);
  insertProject.run('upper', 'C:\\workspaces\\Repo', 'Main repo', 1);
  insertProject.run('only-upper', 'C:\\workspaces', 'workspaces', 0);

  const insertSession = db.prepare(
    "INSERT INTO sessions (session_id, provider, project_path) VALUES (?, 'claude', ?)",
  );
  insertSession.run('s-lower', 'c:\\workspaces\\Repo');
  insertSession.run('s-upper', 'C:\\workspaces\\Repo');
  insertSession.run('s-root', 'C:\\workspaces');

  db.prepare("INSERT INTO users (id, username, password_hash) VALUES (1, 'josh', 'x')").run();
  db.prepare("INSERT INTO session_drafts (user_id, draft_scope, draft_text) VALUES (1, 'project:upper', 'half typed')").run();
}

test('projects that differ only in drive letter case become one, keeping sessions, star and drafts', async () => {
  await withIsolatedDatabase(() => {
    seedLegacyRows();
    const db = getConnection();

    mergeProjectsWithSameNormalizedPath(db);

    const projects = db.prepare(
      'SELECT project_id, project_path, custom_project_name, isStarred FROM projects ORDER BY project_path',
    ).all();
    // The rename on the lost row beats the folder name the kept row was given.
    assert.deepEqual(projects, [
      { project_id: 'only-upper', project_path: 'c:\\workspaces', custom_project_name: 'workspaces', isStarred: 0 },
      { project_id: 'lower', project_path: 'c:\\workspaces\\Repo', custom_project_name: 'Main repo', isStarred: 1 },
    ]);

    const sessions = db.prepare('SELECT session_id, project_path FROM sessions ORDER BY session_id').all();
    assert.deepEqual(sessions, [
      { session_id: 's-lower', project_path: 'c:\\workspaces\\Repo' },
      { session_id: 's-root', project_path: 'c:\\workspaces' },
      { session_id: 's-upper', project_path: 'c:\\workspaces\\Repo' },
    ]);

    const drafts = db.prepare('SELECT draft_scope, draft_text FROM session_drafts').all();
    assert.deepEqual(drafts, [{ draft_scope: 'project:lower', draft_text: 'half typed' }]);
  });
});

test('a second run changes nothing', async () => {
  await withIsolatedDatabase(() => {
    seedLegacyRows();
    const db = getConnection();
    mergeProjectsWithSameNormalizedPath(db);
    const before = db.prepare('SELECT * FROM projects ORDER BY project_id').all();

    mergeProjectsWithSameNormalizedPath(db);

    assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY project_id').all(), before);
  });
});
