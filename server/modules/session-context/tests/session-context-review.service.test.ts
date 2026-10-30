import assert from 'node:assert/strict';
import test from 'node:test';

import type { GitCommandRunner } from '@/shared/types.js';

import { parsePullRequestReview, readPullRequestReview } from '../session-context-review.service.js';

const comment = (login: string, typename: string, body = 'Consider a guard here.') => ({
  author: { login, __typename: typename },
  body,
  url: `https://github.com/Wintaru/claudecodeui/pull/12#discussion_${login}`,
});

const reviewOutput = (overrides: { threads?: unknown[]; hasNextPage?: boolean; checks?: unknown[] | null } = {}) => JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: overrides.hasNextPage ?? false },
          nodes: overrides.threads ?? [],
        },
        commits: {
          nodes: [{
            commit: {
              statusCheckRollup: overrides.checks === null ? null : { contexts: { nodes: overrides.checks ?? [] } },
            },
          }],
        },
      },
    },
  },
});

test('keeps only unresolved threads, marks bots, and counts replies', () => {
  const review = parsePullRequestReview(reviewOutput({
    threads: [
      { isResolved: true, isOutdated: false, path: 'a.ts', line: 1, comments: { totalCount: 1, nodes: [comment('Wintaru', 'User')] } },
      { isResolved: false, isOutdated: false, path: 'b.ts', line: 7, comments: { totalCount: 3, nodes: [comment('copilot-pull-request-reviewer', 'Bot')] } },
      { isResolved: false, isOutdated: true, path: 'c.ts', line: null, originalLine: 40, comments: { totalCount: 1, nodes: [comment('borigas', 'User')] } },
    ],
  }));

  assert.equal(review.threads.length, 2);
  assert.deepEqual(
    review.threads.map(({ path, line, isOutdated, author, isBot, replyCount }) => ({ path, line, isOutdated, author, isBot, replyCount })),
    [
      { path: 'b.ts', line: 7, isOutdated: false, author: 'copilot-pull-request-reviewer', isBot: true, replyCount: 2 },
      // An outdated thread falls back to the line it was written on.
      { path: 'c.ts', line: 40, isOutdated: true, author: 'borigas', isBot: false, replyCount: 0 },
    ],
  );
  assert.equal(review.hasMoreThreads, false);
});

test('a thread with a deleted author shows as ghost and a long body is cut', () => {
  const review = parsePullRequestReview(reviewOutput({
    threads: [{
      isResolved: false,
      path: 'a.ts',
      line: 2,
      comments: { totalCount: 1, nodes: [{ author: null, body: 'x'.repeat(1200), url: 'https://github.com/o/r/pull/1#d' }] },
    }],
    hasNextPage: true,
  }));

  const [thread] = review.threads;
  assert.equal(thread.author, 'ghost');
  assert.equal(thread.isBot, false);
  assert.equal(thread.body.length, 1001);
  assert.equal(review.hasMoreThreads, true);
});

test('sorts checks into failed and pending, and gives null when there are none', () => {
  const review = parsePullRequestReview(reviewOutput({
    checks: [
      { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'ERROR' },
      { __typename: 'StatusContext', context: 'ci/deploy', state: 'PENDING' },
    ],
  }));
  assert.deepEqual(review.checks, { total: 5, failedNames: ['test', 'ci/legacy'], pendingCount: 2 });

  assert.equal(parsePullRequestReview(reviewOutput({ checks: null })).checks, null);
});

test('a missing pull request is a 404', () => {
  assert.throws(
    () => parsePullRequestReview(JSON.stringify({ data: { repository: { pullRequest: null } } })),
    (error: { code?: string; statusCode?: number }) => error.code === 'PULL_REQUEST_NOT_FOUND' && error.statusCode === 404,
  );
});

test('the query names the checkout\'s own repo and a gh failure is a 502', async () => {
  const runGit: GitCommandRunner = async () => ({ stdout: 'git@github.com:Wintaru/claudecodeui.git\n', stderr: '' });
  const calls: Array<{ owner: string; name: string; number: number }> = [];

  const review = await readPullRequestReview({ folderPath: '/w/x', pullRequestNumber: 12 }, {
    runGit,
    runGraphQl: async (_query, variables) => {
      calls.push(variables);
      return reviewOutput();
    },
  });
  assert.deepEqual(calls, [{ owner: 'Wintaru', name: 'claudecodeui', number: 12 }]);
  assert.deepEqual(review.threads, []);

  await assert.rejects(
    readPullRequestReview({ folderPath: '/w/x', pullRequestNumber: 12 }, { runGit, runGraphQl: async () => null }),
    (error: { code?: string; statusCode?: number }) => error.code === 'GITHUB_REQUEST_FAILED' && error.statusCode === 502,
  );
});

test('a checkout with no GitHub origin is a 404 before any gh call', async () => {
  let graphQlCalls = 0;
  await assert.rejects(
    readPullRequestReview({ folderPath: '/w/x', pullRequestNumber: 1 }, {
      runGit: async () => {
        throw new Error('no origin');
      },
      runGraphQl: async () => {
        graphQlCalls += 1;
        return null;
      },
    }),
    (error: { code?: string }) => error.code === 'REPO_NOT_GITHUB',
  );
  assert.equal(graphQlCalls, 0);
});
