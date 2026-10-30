import { useCallback, useEffect, useRef, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { SessionContext, SidebarContextTarget } from '@/shared/types';

const REQUEST_DELAY_MS = 300;

type SessionContextState = {
  context: SessionContext | null;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
};

type InFlight = { key: string; controller: AbortController; timer: number };

/**
 * Loads the context panel's facts for the focused conversation. It asks again
 * when the target or its last activity changes, and when the window gets focus
 * back, because a push made in another shell leaves no other trace here.
 *
 * Only a new target cancels a running request. A streaming reply changes the
 * last activity about once a second, faster than a request takes, so letting
 * it cancel would keep the panel on its skeleton for the whole reply. A change
 * for the same target instead asks once more after the running request ends.
 */
export function useSessionContext(target: SidebarContextTarget | null): SessionContextState {
  // Keyed by target, so a switch never shows the previous conversation's push command while the next one loads.
  const [loaded, setLoaded] = useState<{ key: string; context: SessionContext } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const inFlightRef = useRef<InFlight | null>(null);
  const isStaleRef = useRef(false);

  const projectId = target?.project.projectId ?? null;
  const sessionId = target?.session?.id ?? null;
  const lastActivity = target?.session?.lastActivity ?? target?.session?.updated_at ?? null;
  const targetKey = `${projectId ?? ''}|${sessionId ?? ''}`;

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  // Cancels whatever is running when the panel goes away.
  useEffect(() => () => {
    const inFlight = inFlightRef.current;
    if (inFlight) {
      window.clearTimeout(inFlight.timer);
      inFlight.controller.abort();
      inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    const running = inFlightRef.current;
    if (running && running.key === targetKey) {
      isStaleRef.current = true;
      return;
    }
    if (running) {
      window.clearTimeout(running.timer);
      running.controller.abort();
      inFlightRef.current = null;
    }
    isStaleRef.current = false;
    if (!projectId) {
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);
    // A short quiet gap first, so a burst of focus and activity changes sends one request.
    const timer = window.setTimeout(() => {
      api.sessionContext(projectId, sessionId, { signal: controller.signal })
        .then((response) => readApiJson<{ data: SessionContext }>(response))
        .then(({ data }) => {
          setLoaded({ key: targetKey, context: data });
          setHasError(false);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          console.warn('[session-context] load failed:', error);
          setHasError(true);
        })
        .finally(() => {
          if (controller.signal.aborted) {
            return;
          }
          inFlightRef.current = null;
          setIsLoading(false);
          if (isStaleRef.current) {
            isStaleRef.current = false;
            refresh();
          }
        });
    }, REQUEST_DELAY_MS);
    inFlightRef.current = { key: targetKey, controller, timer };
  }, [projectId, sessionId, targetKey, lastActivity, refreshCount, refresh]);

  const context = projectId && loaded?.key === targetKey ? loaded.context : null;
  return { context, isLoading, hasError, refresh };
}
