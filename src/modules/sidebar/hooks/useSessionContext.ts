import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { SessionContext, SidebarContextTarget } from '@/shared/types';

const REQUEST_DELAY_MS = 300;

type SessionContextState = {
  context: SessionContext | null;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
};

/**
 * Loads the context panel's facts for the focused conversation. It asks again
 * when the target or its last activity changes, and when the window gets focus
 * back, because a push made in another shell leaves no other trace here.
 */
export function useSessionContext(target: SidebarContextTarget | null): SessionContextState {
  // Keyed by target, so a switch never shows the previous conversation's push command while the next one loads.
  const [loaded, setLoaded] = useState<{ key: string; context: SessionContext } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const projectId = target?.project.projectId ?? null;
  const sessionId = target?.session?.id ?? null;
  const lastActivity = target?.session?.lastActivity ?? target?.session?.updated_at ?? null;
  const targetKey = `${projectId ?? ''}|${sessionId ?? ''}`;

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  useEffect(() => {
    if (!projectId) {
      return undefined;
    }

    // A newer target or refresh supersedes this request; its late answer must not win.
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);
    // A streaming reply bumps lastActivity often; each request runs several git
    // processes, so a burst waits for a short quiet gap and sends one request.
    const timer = window.setTimeout(() => {
      api.sessionContext(projectId, sessionId, { signal: controller.signal })
        .then((response) => readApiJson<{ data: SessionContext }>(response))
        .then(({ data }) => {
          setLoaded({ key: targetKey, context: data });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          console.warn('[session-context] load failed:', error);
          setHasError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        });
    }, REQUEST_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, sessionId, targetKey, lastActivity, refreshCount]);

  const context = projectId && loaded?.key === targetKey ? loaded.context : null;
  return { context, isLoading, hasError, refresh };
}
