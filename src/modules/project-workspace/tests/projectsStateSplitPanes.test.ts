import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, ProjectSession, ServerEvent } from '@/shared/types';

/**
 * A conversation in a split pane is on screen, so its own activity must not
 * mark it unread, and a change to its transcript on disk must reach its pane
 * the way `externalMessageUpdate` reaches the main pane.
 */

const projectsResponse = vi.fn();
const sessionDetailsResponse = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    projects: () => projectsResponse(),
    projectTaskmaster: () => Promise.resolve({ ok: false }),
    sessionDetails: (sessionId: string) => sessionDetailsResponse(sessionId),
    projectSessions: () => Promise.resolve({ ok: false }),
  },
}));

const mainSession: ProjectSession = { id: 'main-session', summary: 'Main', __provider: 'claude' };
const splitSession: ProjectSession = { id: 'split-session', summary: 'Split', __provider: 'claude' };
const otherSession: ProjectSession = { id: 'other-session', summary: 'Other', __provider: 'claude' };

const project: Project = {
  projectId: 'project-1',
  path: '/repo',
  fullPath: '/repo',
  displayName: 'repo',
  isStarred: false,
  sessions: [mainSession, splitSession, otherSession],
  sessionMeta: { hasMore: false, total: 3 },
};

const upsert = (session: ProjectSession): ServerEvent => ({
  kind: 'session_upserted',
  sessionId: session.id,
  session,
  project: { projectId: 'project-1' },
} as unknown as ServerEvent);

const renderWithSplitPane = async () => {
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project] });
  let listener: ((event: ServerEvent) => void) | null = null;
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');

  const { result } = renderHook(() =>
    useProjectsState({
      sessionId: 'main-session',
      navigate: vi.fn(),
      subscribe: (fn) => {
        listener = fn;
        return () => { listener = null; };
      },
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
  await waitFor(() => {
    assert.equal(result.current.projects.length, 1);
  });
  act(() => {
    result.current.handleOpenSessionInSplit('split-session');
  });
  assert.deepEqual(result.current.splitSessionIds, ['split-session']);

  const dispatch = (event: ServerEvent) => act(() => listener?.(event));
  return { result, dispatch };
};

beforeEach(() => {
  localStorage.clear();
  projectsResponse.mockReset();
  sessionDetailsResponse.mockReset();
  sessionDetailsResponse.mockResolvedValue({ ok: false });
});

afterEach(() => {
  vi.resetModules();
});

test('activity in a split pane does not mark it unread', async () => {
  const { result, dispatch } = await renderWithSplitPane();

  dispatch({ kind: 'text', sessionId: 'split-session', content: 'hi' } as unknown as ServerEvent);
  dispatch({ kind: 'text', sessionId: 'other-session', content: 'hi' } as unknown as ServerEvent);

  assert.equal(result.current.sidebarSharedProps.attentionSessionIds.has('split-session'), false);
  assert.equal(result.current.sidebarSharedProps.attentionSessionIds.has('other-session'), true);
});

test('a split pane resolves a session past the loaded pages, and closes on an unknown one', async () => {
  localStorage.setItem('cloudcli-split-panes', JSON.stringify(['older-session', 'gone-session', 'flaky-session']));
  sessionDetailsResponse.mockImplementation(async (sessionId: string) => {
    if (sessionId === 'older-session') {
      return { ok: true, json: async () => ({ data: { summary: 'Older', provider: 'claude', project: { projectId: 'project-1' } } }) };
    }
    return { ok: false, status: sessionId === 'gone-session' ? 404 : 503 };
  });
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project] });
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');

  const { result } = renderHook(() =>
    useProjectsState({
      sessionId: 'main-session',
      navigate: vi.fn(),
      subscribe: () => () => {},
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );

  // A failure other than "not found" keeps the pane, to try again later.
  await waitFor(() => {
    assert.deepEqual(result.current.splitSessionIds, ['older-session', 'flaky-session']);
  });
  await waitFor(() => {
    const [target] = result.current.splitPaneTargets;
    assert.equal(target.session?.summary, 'Older');
    assert.equal(target.project?.projectId, 'project-1');
  });
});

test('an update to another session leaves a split pane\'s target unchanged', async () => {
  const { result, dispatch } = await renderWithSplitPane();
  const [targetBefore] = result.current.splitPaneTargets;

  dispatch(upsert({ ...otherSession, summary: 'Other, renamed' }));

  await waitFor(() => {
    assert.equal(result.current.projects[0].sessions?.find((session) => session.id === 'other-session')?.summary, 'Other, renamed');
  });
  assert.equal(result.current.splitPaneTargets[0], targetBefore);
});

test('the context target follows the focused pane, and never borrows the main pane for an unresolved one', async () => {
  localStorage.setItem('cloudcli-split-panes', JSON.stringify(['split-session', 'flaky-session']));
  sessionDetailsResponse.mockResolvedValue({ ok: false, status: 503 });
  projectsResponse.mockResolvedValue({ ok: true, json: async () => [project] });
  const { useProjectsState } = await import('@/modules/project-workspace/hooks/useProjectsState');
  const { result } = renderHook(() =>
    useProjectsState({
      sessionId: 'main-session',
      navigate: vi.fn(),
      subscribe: () => () => {},
      isMobile: false,
      isSessionProcessing: () => false,
    }),
  );
  await waitFor(() => {
    assert.equal(result.current.sidebarSharedProps.contextTarget?.session?.id, 'main-session');
  });

  act(() => result.current.focusPane('split-session'));
  assert.equal(result.current.sidebarSharedProps.contextTarget?.session?.id, 'split-session');

  // Its project is still unknown: showing the main pane's push command here would name the wrong folder.
  act(() => result.current.focusPane('flaky-session'));
  assert.equal(result.current.sidebarSharedProps.contextTarget, null);
});

test('a change on disk to a split session signals its pane', async () => {
  const { result, dispatch } = await renderWithSplitPane();

  dispatch(upsert(splitSession));

  assert.equal(result.current.splitExternalUpdates['split-session'], 1);
  assert.equal(result.current.sidebarSharedProps.attentionSessionIds.has('split-session'), false);
});
