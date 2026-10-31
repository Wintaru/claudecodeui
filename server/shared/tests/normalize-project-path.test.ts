import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProjectPath } from '@/shared/utils.js';

// Windows treats both spellings of a drive letter as one folder, so the
// project key must not depend on which one a tool happened to send.
test('one Windows folder gets one key whatever the drive letter case', () => {
  assert.equal(normalizeProjectPath('C:\\workspaces\\Ocuvera'), 'c:\\workspaces\\Ocuvera');
  assert.equal(normalizeProjectPath('c:\\workspaces\\Ocuvera'), 'c:\\workspaces\\Ocuvera');
  assert.equal(normalizeProjectPath('C:/workspaces/Ocuvera/'), 'c:\\workspaces\\Ocuvera');
  assert.equal(normalizeProjectPath('\\\\?\\C:\\workspaces'), 'c:\\workspaces');
  assert.equal(normalizeProjectPath('C:\\'), 'c:\\');
});

test('only the drive letter changes case', () => {
  assert.equal(normalizeProjectPath('C:\\Workspaces\\MixedCase'), 'c:\\Workspaces\\MixedCase');
});

test('UNC paths keep their spelling', () => {
  assert.equal(normalizeProjectPath('\\\\Server\\Share\\Dir'), '\\\\Server\\Share\\Dir');
});
