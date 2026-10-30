import { createContext, useContext } from 'react';

/**
 * The project that relative file references in model-authored markdown
 * resolve against.
 *
 * Markdown is rendered deep inside the transcript (messages, tool results,
 * streaming halves) and none of those call sites know the selected project.
 * ChatInterface provides it once so `![alt](imagenes/foto.png)` can be fetched
 * through the authenticated project files route instead of failing as a bare
 * `<img src>` against the web origin.
 */
export const MarkdownWorkspaceContext = createContext<{
  projectId: string | null;
  /**
   * False in a split pane whose project is not the main pane's: file links go
   * to the workspace editor, which opens files of the main pane's project only.
   */
  canOpenFiles: boolean;
}>({ projectId: null, canOpenFiles: true });

/** DB `projectId` of the project the transcript belongs to, or null outside a project. */
export function useMarkdownWorkspaceProjectId(): string | null {
  return useContext(MarkdownWorkspaceContext).projectId;
}

export function useMarkdownCanOpenFiles(): boolean {
  return useContext(MarkdownWorkspaceContext).canOpenFiles;
}
