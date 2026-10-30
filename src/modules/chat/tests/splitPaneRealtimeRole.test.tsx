import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ChatPaneRole } from '@/modules/chat/hooks/useChatRealtimeHandlers';

/**
 * Every chat pane receives every frame from the one socket. The main pane keeps
 * the app-wide effects for every session (sounds, title indicator, the
 * sidebar's processing state); a split pane handles only its own session, so
 * one completion plays one sound however many panes are open.
 */

const sounds = vi.hoisted(() => ({ completion: 0, notification: 0, title: 0 }));

vi.mock('@/shared/utils', () => ({
  playChatCompletionSound: async () => { sounds.completion += 1; },
  playNotificationSound: async () => { sounds.notification += 1; },
}));

vi.mock('@/modules/chat/utils/pageTitleNotification', () => ({
  showCompletionTitleIndicator: () => { sounds.title += 1; },
}));

const { useChatRealtimeHandlers } = await import('@/modules/chat/hooks/useChatRealtimeHandlers');

const renderPane = (paneRole: ChatPaneRole, sessionId: string) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: string[] = [];
  const processing: Array<string | null | undefined> = [];
  const idle: Array<string | null | undefined> = [];
  const sessionStore = {
    appendRealtime: (sid: string) => { appended.push(sid); },
    getMessages: () => [],
    updateStreaming: () => {},
    finalizeStreaming: () => {},
  } as unknown as SessionStore;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    paneRole,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: sessionId } as ProjectSession,
    currentSessionId: sessionId,
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: new Map() },
    accumulatedStreamRef: { current: new Map() },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    onSessionProcessing: (sid) => { processing.push(sid); },
    onSessionIdle: (sid) => { idle.push(sid); },
    onSessionBackground: (sid) => { idle.push(sid); },
    requestLatestMessages: async () => {},
    sessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { appended, processing, idle, dispatch };
};

const event = (kind: string, sessionId: string, extra: Record<string, unknown> = {}): ServerEvent => ({
  kind,
  sessionId,
  ...extra,
} as unknown as ServerEvent);

beforeEach(() => {
  sounds.completion = 0;
  sounds.notification = 0;
  sounds.title = 0;
});

test('a split pane ignores frames for other sessions', () => {
  const split = renderPane('split', 'split-session');

  split.dispatch(event('text', 'main-session', { content: 'hi' }));
  split.dispatch(event('text', 'split-session', { content: 'hi' }));

  assert.deepEqual(split.appended, ['split-session']);
});

test('one completion plays one sound with a main pane and a split pane open', () => {
  const main = renderPane('main', 'main-session');
  const split = renderPane('split', 'split-session');
  const completion = event('complete', 'split-session');

  main.dispatch(completion);
  split.dispatch(completion);

  assert.equal(sounds.completion, 1);
  assert.equal(sounds.title, 1);
});

test('only the main pane writes the sidebar processing state', () => {
  const main = renderPane('main', 'main-session');
  const split = renderPane('split', 'split-session');
  const status = event('status', 'split-session', { text: 'Thinking' });

  main.dispatch(status);
  split.dispatch(status);

  assert.deepEqual(main.processing, ['split-session']);
  assert.deepEqual(split.processing, []);
});

test('a permission request plays its sound once', () => {
  const main = renderPane('main', 'main-session');
  const split = renderPane('split', 'split-session');
  const request = event('permission_request', 'split-session', { requestId: 'r1', toolName: 'Bash' });

  main.dispatch(request);
  split.dispatch(request);

  assert.equal(sounds.notification, 1);
});
