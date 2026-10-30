import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';
import type { ChatPaneRole } from '@/modules/chat/hooks/useChatRealtimeHandlers';

/**
 * Every chat pane receives every frame from the one socket. A split pane
 * handles only its own session. The main pane plays the sounds and the title
 * indicator for every session, so one completion plays one sound however many
 * panes are open. The sidebar's processing state of a session is written by
 * the pane that shows it, which sent its subscribe and so can tell an old idle
 * answer from a current one.
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

type PaneOptions = {
  paneRole: ChatPaneRole;
  sessionId: string;
  splitPaneSessionIds?: ReadonlySet<string>;
  subscribeSentAt?: Map<string, number>;
};

const renderPane = ({ paneRole, sessionId, splitPaneSessionIds, subscribeSentAt = new Map() }: PaneOptions) => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const appended: string[] = [];
  const processing: Array<string | null | undefined> = [];
  const idle: Array<{ sessionId: string | null | undefined; ifStartedBefore?: number }> = [];
  const sessionStore = {
    appendRealtime: (sid: string) => { appended.push(sid); },
    getMessages: () => [],
    updateStreaming: () => {},
    finalizeStreaming: () => {},
  } as unknown as SessionStore;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    paneRole,
    splitPaneSessionIds,
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
    statusCheckSentAtRef: { current: subscribeSentAt },
    onSessionProcessing: (sid) => { processing.push(sid); },
    onSessionIdle: (sid, options) => { idle.push({ sessionId: sid, ifStartedBefore: options?.ifStartedBefore }); },
    onSessionBackground: (sid) => { idle.push({ sessionId: sid }); },
    requestLatestMessages: async () => {},
    sessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { appended, processing, idle, dispatch };
};

const renderMainAndSplit = () => {
  const main = renderPane({
    paneRole: 'main',
    sessionId: 'main-session',
    splitPaneSessionIds: new Set(['split-session']),
  });
  const split = renderPane({
    paneRole: 'split',
    sessionId: 'split-session',
    subscribeSentAt: new Map([['split-session', 1000]]),
  });
  const dispatch = (event: ServerEvent) => {
    main.dispatch(event);
    split.dispatch(event);
  };
  return { main, split, dispatch };
};

const event = (kind: string, sessionId: string | null, extra: Record<string, unknown> = {}): ServerEvent => ({
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
  const split = renderPane({ paneRole: 'split', sessionId: 'split-session' });

  split.dispatch(event('text', 'main-session', { content: 'hi' }));
  split.dispatch(event('text', 'split-session', { content: 'hi' }));

  assert.deepEqual(split.appended, ['split-session']);
});

test('one completion plays one sound with a main pane and a split pane open', () => {
  const { dispatch } = renderMainAndSplit();

  dispatch(event('complete', 'split-session'));

  assert.equal(sounds.completion, 1);
  assert.equal(sounds.title, 1);
});

test('a permission request plays its sound once', () => {
  const { dispatch } = renderMainAndSplit();

  dispatch(event('permission_request', 'split-session', { requestId: 'r1', toolName: 'Bash' }));

  assert.equal(sounds.notification, 1);
});

test('the split pane writes its own session state, and the main pane does not', () => {
  const { main, split, dispatch } = renderMainAndSplit();

  dispatch(event('status', 'split-session', { text: 'Thinking' }));

  assert.deepEqual(split.processing, ['split-session']);
  assert.deepEqual(main.processing, []);
});

test('an idle answer for a split session carries the split pane\'s subscribe time', () => {
  const { main, split, dispatch } = renderMainAndSplit();

  dispatch(event('chat_subscribed', 'split-session', { isProcessing: false }));

  assert.deepEqual(split.idle, [{ sessionId: 'split-session', ifStartedBefore: 1000 }]);
  assert.deepEqual(main.idle, []);
});

test('the main pane still writes the state of a session that no pane shows', () => {
  const { main, split, dispatch } = renderMainAndSplit();

  dispatch(event('status', 'background-session', { text: 'Thinking' }));

  assert.deepEqual(main.processing, ['background-session']);
  assert.deepEqual(split.processing, []);
});

test('a protocol error that names no session shows in the main pane only', () => {
  const { main, split, dispatch } = renderMainAndSplit();

  dispatch(event('protocol_error', null, { code: 'INTERNAL_ERROR', error: 'boom' }));

  assert.deepEqual(main.appended, ['main-session']);
  assert.deepEqual(split.appended, []);
});
