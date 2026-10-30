import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, test, vi } from 'vitest';

import { api } from '@/shared/api';
import type { PullRequestReview, SessionContext } from '@/shared/types';
import { usePullRequestReview } from '@/modules/session-context/hooks/usePullRequestReview';
import { describeChecks, describePaneSummary } from '@/modules/session-context/utils/sessionContextFormatting';

/**
 * The review threads are a GitHub call, so a collapsed pane must not make it,
 * and a pane that moves to another PR must never show the old PR's threads.
 */

const t = ((key: string, options?: string | { defaultValue?: string; [value: string]: unknown }) => {
  if (typeof options === 'string') {
    return options;
  }
  return (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

const reviewWith = (threadCount: number, checks: PullRequestReview['checks'] = null): PullRequestReview => ({
  threads: Array.from({ length: threadCount }, (_unused, index) => ({
    path: `src/file${index}.ts`,
    line: index + 1,
    isOutdated: false,
    url: `https://github.com/o/r/pull/12#discussion_${index}`,
    author: 'copilot-pull-request-reviewer',
    isBot: true,
    body: 'Consider a guard here.',
    replyCount: 0,
  })),
  hasMoreThreads: false,
  checks,
});

const jsonResponse = (data: PullRequestReview) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('a collapsed panel makes no review request; expanding makes one', async () => {
  const spy = vi.spyOn(api, 'sessionContextReview').mockImplementation(async () => jsonResponse(reviewWith(2)));
  const { result, rerender } = renderHook((props: { isActive: boolean }) => usePullRequestReview('p', 12, props.isActive), {
    initialProps: { isActive: false },
  });
  assert.equal(spy.mock.calls.length, 0);

  rerender({ isActive: true });
  await waitFor(() => assert.equal(result.current.review?.threads.length, 2));
  assert.deepEqual(spy.mock.calls[0].slice(0, 2), ['p', 12]);

  // Collapsing keeps the last answer, so the bar can still show the count.
  rerender({ isActive: false });
  assert.equal(result.current.review?.threads.length, 2);
});

test('no PR means no request', () => {
  const spy = vi.spyOn(api, 'sessionContextReview');
  renderHook(() => usePullRequestReview('p', null, true));
  assert.equal(spy.mock.calls.length, 0);
});

test('another PR hides the previous threads until its own arrive', async () => {
  let resolveSecond: (response: Response) => void = () => {};
  vi.spyOn(api, 'sessionContextReview')
    .mockImplementationOnce(async () => jsonResponse(reviewWith(3)))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    }));
  const { result, rerender } = renderHook((props: { pr: number }) => usePullRequestReview('p', props.pr, true), {
    initialProps: { pr: 12 },
  });
  await waitFor(() => assert.equal(result.current.review?.threads.length, 3));

  rerender({ pr: 13 });
  assert.equal(result.current.review, null);

  await act(async () => {
    resolveSecond(jsonResponse(reviewWith(1)));
  });
  await waitFor(() => assert.equal(result.current.review?.threads.length, 1));
});

test('an expanded panel reads the threads again every two minutes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const spy = vi.spyOn(api, 'sessionContextReview').mockImplementation(async () => jsonResponse(reviewWith(0)));
  renderHook(() => usePullRequestReview('p', 12, true));
  await waitFor(() => assert.equal(spy.mock.calls.length, 1));

  await act(async () => {
    vi.advanceTimersByTime(2 * 60 * 1000);
  });
  await waitFor(() => assert.equal(spy.mock.calls.length, 2));
});

test('describeChecks puts failures first, then running checks', () => {
  assert.equal(describeChecks({ total: 3, failedNames: ['test'], pendingCount: 1 }, t), '1 checks failed');
  assert.equal(describeChecks({ total: 3, failedNames: [], pendingCount: 2 }, t), '2 checks running');
  assert.equal(describeChecks({ total: 3, failedNames: [], pendingCount: 0 }, t), 'Checks passed');
});

test('the bar adds the thread count and checks once the review has loaded', () => {
  const context: SessionContext = {
    folderPath: '/w/a',
    folderExists: true,
    git: {
      branch: 'wintaru/x',
      hasUpstream: true,
      remoteName: 'origin',
      ahead: 2,
      behind: 0,
      changedFileCount: 0,
      stagedFileCount: 0,
      pushCommand: 'git -C /w/a push',
      repo: null,
    },
    issue: null,
    pullRequest: { number: 12, url: 'https://x/12', state: 'OPEN' },
    compareUrl: null,
    notes: [],
    worktrees: [],
    lastReply: null,
  };
  const review = reviewWith(3, { total: 4, failedNames: [], pendingCount: 0 });
  assert.equal(describePaneSummary(context, t, review), 'wintaru/x · PR #12 · 3 open threads · Checks passed · 2 commits to push');
});
