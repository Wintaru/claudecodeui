import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, test, vi } from 'vitest';

import { api } from '@/shared/api';
import type { Project, SessionContext, SidebarContextTarget } from '@/shared/types';
import { describePaneSummary, describePushState, toVsCodeUrl } from '@/modules/session-context/utils/sessionContextFormatting';
import { useSessionContext } from '@/modules/session-context/hooks/useSessionContext';

/**
 * The context panel shows the focused conversation's push command and links. A
 * push command copied while the panel still shows the previous conversation
 * would push the wrong repository, so a target switch must hide the old answer.
 */

const t = ((key: string, options?: string | { defaultValue?: string; [value: string]: unknown }) => {
  if (typeof options === 'string') {
    return options;
  }
  return (options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
}) as unknown as TFunction;

const git = (overrides: Partial<NonNullable<SessionContext['git']>> = {}): NonNullable<SessionContext['git']> => ({
  branch: '884-turningPrompt',
  hasUpstream: true,
  remoteName: 'origin',
  ahead: 0,
  behind: 0,
  changedFileCount: 0,
  stagedFileCount: 0,
  pushCommand: 'git -C /w/x push',
  repo: null,
  ...overrides,
});

const contextFor = (folderPath: string): SessionContext => ({
  folderPath,
  folderExists: true,
  git: git({ pushCommand: `git -C ${folderPath} push` }),
  issue: null,
  pullRequest: null,
  compareUrl: null,
  notes: [],
  worktrees: [],
  lastReply: null,
});

const target = (projectId: string, sessionId: string): SidebarContextTarget => ({
  project: { projectId, displayName: projectId, path: `/w/${projectId}`, fullPath: `/w/${projectId}` } as Project,
  session: { id: sessionId },
});

const jsonResponse = (data: SessionContext) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

afterEach(() => {
  vi.restoreAllMocks();
});

test('describePushState covers no upstream, commits to push, behind, and up to date', () => {
  assert.equal(describePushState(git({ hasUpstream: false, ahead: null, behind: null }), t), 'Not pushed yet');
  assert.equal(describePushState(git({ ahead: 3 }), t), '3 commits to push');
  assert.equal(describePushState(git({ ahead: 2, behind: 1 }), t), '2 commits to push · 1 behind');
  assert.equal(describePushState(git(), t), 'Nothing to push');
});

test('describePaneSummary names the branch, the PR, and the push state', () => {
  const context = contextFor('/w/a');
  assert.equal(describePaneSummary(context, t), '884-turningPrompt · Nothing to push');
  assert.equal(
    describePaneSummary({ ...context, pullRequest: { number: 12, url: 'https://x/12', state: 'OPEN' } }, t),
    '884-turningPrompt · PR #12 · Nothing to push',
  );
  assert.equal(describePaneSummary({ ...context, git: null }, t), 'Not a git repository');
  assert.equal(describePaneSummary({ ...context, folderExists: false }, t), 'Folder removed');
});

test('toVsCodeUrl gives one slash after the authority on Windows and POSIX paths', () => {
  assert.equal(toVsCodeUrl('C:\\workspaces\\Ocuvera-884\\884-HANDOFF.md'), 'vscode://file/C:/workspaces/Ocuvera-884/884-HANDOFF.md');
  assert.equal(toVsCodeUrl('/home/josh/My Notes.md'), 'vscode://file/home/josh/My%20Notes.md');
  assert.equal(toVsCodeUrl('C:\\notes\\PR#12?.md'), 'vscode://file/C:/notes/PR%2312%3F.md');
});

test('switching targets hides the previous context until the new one arrives', async () => {
  let resolveSecond: (response: Response) => void = () => {};
  const spy = vi.spyOn(api, 'sessionContext')
    .mockImplementationOnce(async () => jsonResponse(contextFor('/w/a')))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    }));

  const { result, rerender } = renderHook((props: { target: SidebarContextTarget }) => useSessionContext(props.target), {
    initialProps: { target: target('a', 's1') },
  });
  await waitFor(() => assert.equal(result.current.context?.folderPath, '/w/a'));

  rerender({ target: target('b', 's2') });
  assert.equal(result.current.context, null, 'the old push command must not show for the new target');
  await waitFor(() => assert.equal(spy.mock.calls.length, 2));

  await act(async () => {
    resolveSecond(jsonResponse(contextFor('/w/b')));
  });
  await waitFor(() => assert.equal(result.current.context?.folderPath, '/w/b'));
});

test('a streaming reply does not cancel the running request; it asks once more afterwards', async () => {
  const resolvers: Array<(response: Response) => void> = [];
  const spy = vi.spyOn(api, 'sessionContext').mockImplementation(() => new Promise<Response>((resolve) => {
    resolvers.push(resolve);
  }));
  const withActivity = (lastActivity: string): SidebarContextTarget => ({
    ...target('a', 's1'),
    session: { id: 's1', lastActivity },
  });
  const { result, rerender } = renderHook((props: { target: SidebarContextTarget }) => useSessionContext(props.target), {
    initialProps: { target: withActivity('t0') },
  });
  await waitFor(() => assert.equal(spy.mock.calls.length, 1));

  // Three activity changes while the first request runs.
  rerender({ target: withActivity('t1') });
  rerender({ target: withActivity('t2') });
  rerender({ target: withActivity('t3') });
  const [firstSignal] = spy.mock.calls[0].slice(2) as [{ signal: AbortSignal }];
  assert.equal(firstSignal.signal.aborted, false, 'the running request keeps going');

  await act(async () => {
    resolvers[0](jsonResponse(contextFor('/w/a')));
  });
  await waitFor(() => assert.equal(result.current.context?.folderPath, '/w/a'));
  await waitFor(() => assert.equal(spy.mock.calls.length, 2), { timeout: 2000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(spy.mock.calls.length, 2, 'one follow-up request, not one per change');
});

test('a window focus asks again for the same target', async () => {
  const spy = vi.spyOn(api, 'sessionContext').mockImplementation(async () => jsonResponse(contextFor('/w/a')));
  const { result } = renderHook(() => useSessionContext(target('a', 's1')));
  await waitFor(() => assert.equal(result.current.context?.folderPath, '/w/a'));

  act(() => {
    window.dispatchEvent(new Event('focus'));
  });

  await waitFor(() => assert.equal(spy.mock.calls.length, 2));
  assert.equal(result.current.context?.folderPath, '/w/a', 'a refresh of the same target keeps the shown context');
});
