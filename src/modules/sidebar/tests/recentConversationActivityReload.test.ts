import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, RecentConversationListItem } from '@/shared/types';

/**
 * The Conversations list is a REST snapshot, while `projects` is patched live
 * when a session gets a new message. Loaded rows take the new activity from
 * `projects` and move at once, then one quiet merge brings their new last
 * prompt and reply; a conversation that is not loaded yet is merged in from
 * the server without dropping the pages already loaded.
 */

const recentConversationsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    recentConversations: (options: { limit: number; offset: number }) => recentConversationsResponse(options),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => Promise.resolve({ ok: true, json: async () => ({ data: { sessions: [] } }) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const t = ((key: string) => key) as unknown as TFunction;
const RELOAD_DELAY_MS = 1000;

const EARLIER = '2026-10-30T09:00:00.000Z';
const MIDDLE = '2026-10-30T09:03:00.000Z';
const LATER = '2026-10-30T09:05:00.000Z';

const conversation = (sessionId: string, lastActivity: string): RecentConversationListItem => ({
  sessionId,
  provider: 'claude',
  projectId: 'project-1',
  projectDisplayName: 'repo',
  sessionTitle: sessionId,
  lastActivity,
});

const buildProject = (activity: Record<string, string>): Project => ({
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: Object.entries(activity).map(([id, lastActivity]) => ({ id, lastActivity, __provider: 'claude' as const })),
  sessionMeta: { hasMore: false, total: Object.keys(activity).length },
});

const page = (rows: RecentConversationListItem[], hasMore = false) => ({
  ok: true,
  json: async () => ({ data: { conversations: rows, total: rows.length, hasMore } }),
});

const respondWith = (rows: RecentConversationListItem[], hasMore = false) => {
  recentConversationsResponse.mockResolvedValueOnce(page(rows, hasMore));
};

const rowIds = (rows: RecentConversationListItem[]) => rows.map((row) => row.sessionId);

const openConversationsTab = async (initialProjects: Project[]) => {
  const rendered = renderHook(
    ({ projects }: { projects: Project[] }) => useSidebarController({
      projects,
      selectedProject: null,
      selectedSession: null,
      activeSessions: new Set<string>(),
      backgroundSessionIds: new Set<string>(),
      isLoading: false,
      isMobile: false,
      t,
      onRefresh: vi.fn(),
      onProjectSelect: vi.fn(),
      onSessionSelect: vi.fn(),
      setCurrentProject: vi.fn(),
      setSidebarVisible: vi.fn(),
      sidebarVisible: true,
    }),
    { initialProps: { projects: initialProjects } },
  );
  act(() => {
    rendered.result.current.setSearchMode('conversations');
  });
  await waitFor(() => {
    assert.ok(rendered.result.current.recentConversations.length > 0);
  });
  return rendered;
};

const waitPastReloadDelay = () => act(() => vi.advanceTimersByTimeAsync(RELOAD_DELAY_MS + 100));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  recentConversationsResponse.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a new message in a loaded conversation moves it to the top at once, then refreshes its preview quietly', async () => {
  respondWith([conversation('session-1', EARLIER), conversation('session-2', EARLIER)]);
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': EARLIER, 'session-2': EARLIER })]);

  respondWith([{ ...conversation('session-2', LATER), lastReply: 'new reply' }, conversation('session-1', EARLIER)]);
  rerender({ projects: [buildProject({ 'session-1': EARLIER, 'session-2': LATER })] });

  assert.deepEqual(rowIds(result.current.recentConversations), ['session-2', 'session-1']);
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
  await waitPastReloadDelay();
  await waitFor(() => {
    assert.equal(result.current.recentConversations[0].lastReply, 'new reply');
  });
  assert.equal(recentConversationsResponse.mock.calls.length, 2);
  assert.equal(result.current.isRecentConversationsLoading, false);

  await waitPastReloadDelay();
  assert.equal(recentConversationsResponse.mock.calls.length, 2);
});

test('a server that still reports the older activity is not asked again', async () => {
  respondWith([conversation('session-1', EARLIER)]);
  const { rerender } = await openConversationsTab([buildProject({ 'session-1': EARLIER })]);

  respondWith([conversation('session-1', EARLIER)]);
  rerender({ projects: [buildProject({ 'session-1': LATER })] });
  await waitPastReloadDelay();
  await waitPastReloadDelay();

  assert.equal(recentConversationsResponse.mock.calls.length, 2);
});

test('a conversation that is not loaded is merged in quietly, keeping the loaded pages', async () => {
  respondWith([conversation('session-1', MIDDLE)], true);
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': MIDDLE })]);
  respondWith([conversation('session-2', EARLIER)]);
  act(() => {
    result.current.loadMoreRecentConversations();
  });
  await waitFor(() => {
    assert.deepEqual(rowIds(result.current.recentConversations), ['session-1', 'session-2']);
  });

  let resolveMerge: (value: unknown) => void = () => {};
  recentConversationsResponse.mockReturnValueOnce(new Promise((resolve) => {
    resolveMerge = resolve;
  }));
  rerender({ projects: [buildProject({ 'session-1': MIDDLE, 'session-3': LATER })] });
  await waitPastReloadDelay();

  assert.equal(recentConversationsResponse.mock.calls.length, 3);
  assert.deepEqual(recentConversationsResponse.mock.calls[2][0], { limit: 40, offset: 0 });
  assert.equal(result.current.isRecentConversationsLoading, false);

  await act(async () => {
    resolveMerge(page([conversation('session-3', LATER), conversation('session-1', MIDDLE)], true));
  });
  await waitFor(() => {
    assert.deepEqual(rowIds(result.current.recentConversations), ['session-3', 'session-1', 'session-2']);
  });
});

test('opening the tab loads once, even when sessions already carry activity', async () => {
  respondWith([conversation('session-1', EARLIER), conversation('session-2', EARLIER)]);
  await openConversationsTab([buildProject({ 'session-1': EARLIER, 'session-2': EARLIER })]);

  await waitPastReloadDelay();
  assert.equal(recentConversationsResponse.mock.calls.length, 1);
});

test('newer activity below the current newest keeps the order and refreshes the preview', async () => {
  respondWith([conversation('session-1', LATER), conversation('session-2', EARLIER)]);
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': LATER, 'session-2': EARLIER })]);

  respondWith([conversation('session-1', LATER), conversation('session-2', MIDDLE)]);
  rerender({ projects: [buildProject({ 'session-1': LATER, 'session-2': MIDDLE })] });

  assert.deepEqual(rowIds(result.current.recentConversations), ['session-1', 'session-2']);
  assert.equal(result.current.recentConversations[1].lastActivity, MIDDLE);
  await waitPastReloadDelay();
  assert.equal(recentConversationsResponse.mock.calls.length, 2);
  assert.deepEqual(rowIds(result.current.recentConversations), ['session-1', 'session-2']);
});

test('a failed merge is tried again on the next activity change', async () => {
  respondWith([conversation('session-1', EARLIER)]);
  const { result, rerender } = await openConversationsTab([buildProject({ 'session-1': EARLIER })]);

  recentConversationsResponse.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  rerender({ projects: [buildProject({ 'session-1': EARLIER, 'session-2': MIDDLE })] });
  await waitPastReloadDelay();
  assert.equal(recentConversationsResponse.mock.calls.length, 2);
  assert.equal(result.current.recentConversationsError, false);

  respondWith([conversation('session-2', LATER), conversation('session-1', EARLIER)]);
  rerender({ projects: [buildProject({ 'session-1': EARLIER, 'session-2': LATER })] });
  await waitPastReloadDelay();
  await waitFor(() => {
    assert.deepEqual(rowIds(result.current.recentConversations), ['session-2', 'session-1']);
  });
  assert.equal(recentConversationsResponse.mock.calls.length, 3);
});
