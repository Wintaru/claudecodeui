import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat/hooks/useSessionStore';

/**
 * One socket carries the stream of every session that runs from this browser
 * tab, so each session keeps its own text buffer: when the viewed session and
 * a background session stream at the same time, neither gets the other's text.
 */

const STREAM_FLUSH_MS = 100;

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const streamedText = new Map<string, string>();
  const sessionStore = {
    updateStreaming: (sessionId: string, text: string) => {
      streamedText.set(sessionId, text);
    },
    finalizeStreaming: () => {},
    appendRealtime: () => {},
  } as unknown as SessionStore;

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setTokenBudget: () => {},
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: new Map() },
    accumulatedStreamRef: { current: new Map() },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { streamedText, dispatch };
};

const delta = (sessionId: string, content: string): ServerEvent => ({
  kind: 'stream_delta',
  sessionId,
  content,
} as unknown as ServerEvent);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('two sessions that stream at once keep their own text', () => {
  const { streamedText, dispatch } = renderHandlers();

  dispatch(delta('viewed-session', 'Hello '));
  dispatch(delta('background-session', 'Other '));
  dispatch(delta('viewed-session', 'world'));
  dispatch(delta('background-session', 'reply'));
  vi.advanceTimersByTime(STREAM_FLUSH_MS);

  assert.equal(streamedText.get('viewed-session'), 'Hello world');
  assert.equal(streamedText.get('background-session'), 'Other reply');
});

test('the end of one stream leaves the other session buffering', () => {
  const { streamedText, dispatch } = renderHandlers();

  dispatch(delta('viewed-session', 'Hello'));
  dispatch(delta('background-session', 'Other'));
  dispatch({ kind: 'stream_end', sessionId: 'background-session' } as unknown as ServerEvent);
  assert.equal(streamedText.get('background-session'), 'Other');
  assert.equal(streamedText.has('viewed-session'), false);

  dispatch(delta('viewed-session', ' world'));
  vi.advanceTimersByTime(STREAM_FLUSH_MS);

  assert.equal(streamedText.get('viewed-session'), 'Hello world');
});
