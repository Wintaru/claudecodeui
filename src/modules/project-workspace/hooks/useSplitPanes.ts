import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';

const SPLIT_PANES_STORAGE_KEY = 'cloudcli-split-panes';
const NO_SPLIT_PANES: string[] = [];
/** Panes beside the main one; with the main pane that makes four. */
export const MAX_SPLIT_PANES = 3;

/** Read the stored split pane ids, tolerating missing, invalid or oversized storage. */
function readStoredSplitSessionIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SPLIT_PANES_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    const ids = parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
    return [...new Set(ids)].slice(0, MAX_SPLIT_PANES);
  } catch {
    return [];
  }
}

function writeStoredSplitSessionIds(sessionIds: string[]): void {
  try {
    localStorage.setItem(SPLIT_PANES_STORAGE_KEY, JSON.stringify(sessionIds));
  } catch {
    // Storage unavailable: the panes still work for this page load.
  }
}

type UseSplitPanesArgs = {
  /** The session the address names, shown in the main pane. */
  mainSessionId: string | null;
  navigate: NavigateFunction;
  isMobile: boolean;
};

/**
 * Owns the conversations shown beside the main chat. The address keeps naming
 * the main pane, so links, reload and selection work as before; this list holds
 * only the other panes, and it never holds the main session, so no
 * conversation shows twice.
 */
export function useSplitPanes({ mainSessionId, navigate, isMobile }: UseSplitPanesArgs) {
  const [storedSplitSessionIds, setStoredSplitSessionIds] = useState<string[]>(readStoredSplitSessionIds);
  // The split pane that last had focus; null means the main pane.
  const [lastFocusedSplitSessionId, setLastFocusedSplitSessionId] = useState<string | null>(null);

  useEffect(() => {
    writeStoredSplitSessionIds(storedSplitSessionIds);
  }, [storedSplitSessionIds]);

  // A session selected the normal way while it sits in a split pane moves to
  // the main pane.
  useEffect(() => {
    if (!mainSessionId) {
      return;
    }
    setStoredSplitSessionIds((previous) => (
      previous.includes(mainSessionId) ? previous.filter((id) => id !== mainSessionId) : previous
    ));
    // Choosing a conversation for the main pane is a switch to it.
    setLastFocusedSplitSessionId(null);
  }, [mainSessionId]);

  // A phone-width screen shows the main pane only; the stored list stays for
  // the next wide screen.
  const splitSessionIds = isMobile ? NO_SPLIT_PANES : storedSplitSessionIds;
  const splitSessionIdsRef = useRef(splitSessionIds);
  splitSessionIdsRef.current = splitSessionIds;
  const isSplitFull = storedSplitSessionIds.length >= MAX_SPLIT_PANES;
  // A closed or moved pane gives focus back to the main pane.
  const focusedSplitSessionId = lastFocusedSplitSessionId && splitSessionIds.includes(lastFocusedSplitSessionId)
    ? lastFocusedSplitSessionId
    : null;

  /** Records which pane has focus: a split pane's session id, or null for the main pane. */
  const focusPane = useCallback((splitSessionId: string | null) => {
    setLastFocusedSplitSessionId(splitSessionId);
  }, []);

  const openSessionInSplit = useCallback((sessionId: string) => {
    if (!mainSessionId) {
      navigate(`/session/${sessionId}`);
      return;
    }
    if (sessionId === mainSessionId) {
      return;
    }
    setStoredSplitSessionIds((previous) => (
      previous.includes(sessionId) || previous.length >= MAX_SPLIT_PANES
        ? previous
        : [...previous, sessionId]
    ));
  }, [mainSessionId, navigate]);

  const closeSplitPane = useCallback((sessionId: string) => {
    setStoredSplitSessionIds((previous) => previous.filter((id) => id !== sessionId));
    setLastFocusedSplitSessionId((previous) => (previous === sessionId ? null : previous));
  }, []);

  /** Closes the main pane: the first split pane takes its place, or the workspace goes empty. */
  const closeMainPane = useCallback(() => {
    const [nextMainSessionId] = splitSessionIdsRef.current;
    navigate(nextMainSessionId ? `/session/${nextMainSessionId}` : '/');
  }, [navigate]);

  /** A fork from a split pane opens in that pane. */
  const replaceSplitPane = useCallback((previousSessionId: string, nextSessionId: string) => {
    setStoredSplitSessionIds((previous) => {
      if (previous.includes(nextSessionId) || nextSessionId === mainSessionId) {
        return previous.filter((id) => id !== previousSessionId);
      }
      return previous.map((id) => (id === previousSessionId ? nextSessionId : id));
    });
    setLastFocusedSplitSessionId((previous) => (previous === previousSessionId ? nextSessionId : previous));
  }, [mainSessionId]);

  return {
    splitSessionIds,
    splitSessionIdsRef,
    isSplitFull,
    focusedSplitSessionId,
    focusPane,
    openSessionInSplit,
    closeSplitPane,
    closeMainPane,
    replaceSplitPane,
  };
}
