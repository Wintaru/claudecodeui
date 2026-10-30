import { useCallback, useEffect, useState } from 'react';

import { api, readApiJson } from '@/shared/api';
import type { PullRequestReview } from '@/shared/types';

/** While the panel stays open, the threads are read again this often. */
const REVIEW_REFRESH_MS = 2 * 60 * 1000;

type PullRequestReviewState = {
  review: PullRequestReview | null;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
};

/**
 * Loads a PR's open review threads and checks, only while `isActive` (the
 * pane's panel is expanded), so a collapsed pane makes no GitHub calls. The
 * last answer stays after a collapse, so the bar can keep its thread count.
 */
export function usePullRequestReview(
  projectId: string | null,
  pullRequestNumber: number | null,
  isActive: boolean,
): PullRequestReviewState {
  // Keyed by PR, so another pane's or another PR's threads never show while the next ones load.
  const [loaded, setLoaded] = useState<{ key: string; review: PullRequestReview } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const reviewKey = projectId && pullRequestNumber ? `${projectId}|${pullRequestNumber}` : null;
  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  useEffect(() => {
    if (!isActive || !reviewKey) {
      return undefined;
    }
    const timer = window.setInterval(refresh, REVIEW_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isActive, reviewKey, refresh]);

  useEffect(() => {
    if (!isActive || !projectId || !pullRequestNumber || !reviewKey) {
      return undefined;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setHasError(false);
    api.sessionContextReview(projectId, pullRequestNumber, { signal: controller.signal })
      .then((response) => readApiJson<{ data: PullRequestReview }>(response))
      .then(({ data }) => setLoaded({ key: reviewKey, review: data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('[session-context] review load failed:', error);
        setHasError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });
    return () => {
      controller.abort();
      setIsLoading(false);
    };
  }, [isActive, projectId, pullRequestNumber, reviewKey, refreshCount]);

  const review = reviewKey && loaded?.key === reviewKey ? loaded.review : null;
  return { review, isLoading, hasError, refresh };
}
