import React, { useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { ChatInterface } from '@/modules/chat';
import type { SplitPaneTarget } from '@/modules/project-workspace/hooks/useProjectsState';
import type { Project, ProjectSession } from '@/shared/types';
import { getSessionTitle } from '@/shared/utils';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';

type ChatPaneFrameProps = {
  project: Project | null;
  session: ProjectSession | null;
  onClose: () => void;
  /** Called when a click or keyboard focus lands anywhere inside the pane. */
  onFocus: () => void;
  /** False outside the split view: the frame then adds nothing around its chat. */
  isFramed?: boolean;
  children: ReactNode;
};

/**
 * One cell of the split view: the conversation's name, a close button, and its
 * chat. The main chat stays inside this frame when the split view closes, so
 * opening or closing a split does not remount it.
 */
export function ChatPaneFrame({ project, session, onClose, onFocus, isFramed = true, children }: ChatPaneFrameProps) {
  // The main pane has a project but no session while a new chat is open.
  const sessionTitle = session ? getSessionTitle(session) : project ? 'New chat' : 'Loading…';
  const projectName = project?.displayName || project?.path || '';

  return (
    <div
      onFocus={onFocus}
      onPointerDown={onFocus}
      className={isFramed
        ? 'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border focus-within:ring-2 focus-within:ring-primary/60'
        : 'flex h-full min-h-0 flex-col'}
    >
      {isFramed && (
        <div className="flex h-8 flex-shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-2 text-xs">
          <span className="min-w-0 flex-1 truncate" title={`${projectName} · ${sessionTitle}`}>
            {projectName && <span className="text-muted-foreground">{projectName} · </span>}
            <span className="font-medium text-foreground">{sessionTitle}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${sessionTitle}`}
            title="Close pane"
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

type SplitChatPaneProps = {
  target: SplitPaneTarget;
  isActive: boolean;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  /** Present only when the pane's project is the main pane's, whose files the editor opens. */
  onFileOpen?: React.ComponentProps<typeof ChatInterface>['onFileOpen'];
  onShowSettings: () => void;
  showRawParameters: boolean;
  showThinking: boolean;
  sendByCtrlEnter: boolean;
  externalMessageUpdate: number;
  onClose: (sessionId: string) => void;
  onReplace: (previousSessionId: string, nextSessionId: string) => void;
  onFocusPane: (sessionId: string) => void;
};

/** Rendered by WorkspaceMain for each conversation opened beside the main chat. */
function SplitChatPane({
  target,
  isActive,
  ws,
  sendMessage,
  onFileOpen,
  onShowSettings,
  showRawParameters,
  showThinking,
  sendByCtrlEnter,
  externalMessageUpdate,
  onClose,
  onReplace,
  onFocusPane,
}: SplitChatPaneProps) {
  const { sessionId, project, session } = target;

  const handleClose = useCallback(() => onClose(sessionId), [onClose, sessionId]);
  const handleFocus = useCallback(() => onFocusPane(sessionId), [onFocusPane, sessionId]);
  // A fork from this pane opens in this pane, not in the main one.
  const handleNavigateToSession = useCallback(
    (targetSessionId: string) => onReplace(sessionId, targetSessionId),
    [onReplace, sessionId],
  );

  return (
    <ChatPaneFrame project={project} session={session} onClose={handleClose} onFocus={handleFocus}>
      {project && session ? (
        <WorkspaceErrorBoundary showDetails>
          <ChatInterface
            isActive={isActive}
            paneRole="split"
            isSplitView
            selectedProject={project}
            selectedSession={session}
            ws={ws}
            sendMessage={sendMessage}
            onFileOpen={onFileOpen}
            onNavigateToSession={handleNavigateToSession}
            onShowSettings={onShowSettings}
            showRawParameters={showRawParameters}
            showThinking={showThinking}
            sendByCtrlEnter={sendByCtrlEnter}
            externalMessageUpdate={externalMessageUpdate}
            onShowAllTasks={null}
          />
        </WorkspaceErrorBoundary>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
      )}
    </ChatPaneFrame>
  );
}

export default React.memo(SplitChatPane);
