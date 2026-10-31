import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import type { SidebarProjectListProps } from '@/shared/types';
import { getPageTitle } from '@/shared/utils';
import SidebarProjectItem from '@/modules/sidebar/SidebarProjectItem';
import SidebarProjectsState from '@/modules/sidebar/SidebarProjectsState';
import { nestWorktreeProjects } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { readUnfoldedWorktreeRepoIds, writeUnfoldedWorktreeRepoIds } from '@/modules/sidebar/utils/sidebarStoredPreferences';


/** Rendered by SidebarContent to list the filtered projects, delegating each row to SidebarProjectItem. */
export default function SidebarProjectList({
  projects,
  filteredProjects,
  selectedProject,
  selectedSession,
  isLoading,
  loadingProgress,
  isProjectExpanded,
  activeRename,
  initialSessionsLoaded,
  currentTime,

  deletingProjects,
  tasksEnabled,
  mcpServerStatus,
  getProjectSessions,
  onLoadMoreSessions,
  loadingMoreProjects,
  activeSessions,
  backgroundSessionIds,
  attentionSessionIds,
  isProjectStarred,
  onRenameDraftChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onSessionSelect,
  onDeleteSession,
  onForkSession,
  splitView,
  onNewSession,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  sessionSelection,
  onSetSessionSelection,
  onToggleSessionSelected,
  onCancelSessionSelection,
  onDeleteSelectedSessions,
  t,
}: SidebarProjectListProps) {
  const pageTitle = getPageTitle(selectedProject, selectedSession);
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  const rows = useMemo(() => nestWorktreeProjects(filteredProjects), [filteredProjects]);
  // The list receives the search result, not the search text: fewer rows means a search is narrowing it.
  const isSearching = filteredProjects.length !== projects.length;
  // Repos start folded; this holds the ones the user opened.
  const [unfoldedRepoIds, setUnfoldedRepoIds] = useState<ReadonlySet<string>>(readUnfoldedWorktreeRepoIds);
  const toggleRepoFold = useCallback((projectId: string) => {
    setUnfoldedRepoIds((previous) => {
      const next = new Set(previous);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    writeUnfoldedWorktreeRepoIds(unfoldedRepoIds);
  }, [unfoldedRepoIds]);

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;

  return (
      <div className="pb-safe-area-inset-bottom md:space-y-1">
        {!showProjects
          ? state
          : rows.map(({ project, parentProjectId, worktreeCount }) => {
              // A folded repo hides its worktrees, but never one that is open,
              // busy or waiting for the user, and never while a search runs.
              if (
                parentProjectId
                && !unfoldedRepoIds.has(parentProjectId)
                && !isSearching
                && project.projectId !== selectedProject?.projectId
                && !getProjectSessions(project).some((session) => (
                  activeSessions.has(session.id) || attentionSessionIds.has(session.id)
                ))
              ) {
                return null;
              }
              // Both renames are resolved here rather than inside the row, so
              // every other row is handed the same scalars on each keystroke and
              // its memo boundary holds.
              const renamingProject =
                activeRename?.target === 'project' && activeRename.id === project.projectId
                  ? activeRename
                  : null;
              const renamingSession =
                activeRename?.target === 'session' && activeRename.projectId === project.projectId
                  ? activeRename
                  : null;
              // Resolved here for the same reason as the renames: only the
              // project in selection mode sees a set, every other row keeps
              // being handed the same `null` and its memo holds.
              const selectedSessionIds =
                sessionSelection?.projectId === project.projectId ? sessionSelection.sessionIds : null;

              // React key + per-project state lookups all use the DB `projectId`
              // so they remain stable across renames and session changes.
              const item = (
              <SidebarProjectItem
                project={project}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                isExpanded={isProjectExpanded(project.projectId)}
                isDeleting={deletingProjects.has(project.projectId)}
                isStarred={isProjectStarred(project.projectId)}
                isEditing={renamingProject !== null}
                renameDraft={renamingProject?.draft ?? ''}
                sessions={getProjectSessions(project)}
                initialSessionsLoaded={initialSessionsLoaded.has(project.projectId)}
                isLoadingMoreSessions={loadingMoreProjects.has(project.projectId)}
                currentTime={currentTime}
                sessionRenameId={renamingSession?.id ?? null}
                sessionRenameDraft={renamingSession?.draft ?? ''}
                tasksEnabled={tasksEnabled}
                mcpServerStatus={mcpServerStatus}
                onRenameDraftChange={onRenameDraftChange}
                onToggleProject={onToggleProject}
                onProjectSelect={onProjectSelect}
                onToggleStarProject={onToggleStarProject}
                onStartEditingProject={onStartEditingProject}
                onCancelEditingProject={onCancelEditingProject}
                onSaveProjectName={onSaveProjectName}
                onDeleteProject={onDeleteProject}
                onSessionSelect={onSessionSelect}
                onDeleteSession={onDeleteSession}
                onForkSession={onForkSession}
                splitView={splitView}
                onLoadMoreSessions={onLoadMoreSessions}
                activeSessions={activeSessions}
                backgroundSessionIds={backgroundSessionIds}
                attentionSessionIds={attentionSessionIds}
                onNewSession={onNewSession}
                onStartEditingSession={onStartEditingSession}
                onCancelEditingSession={onCancelEditingSession}
                onSaveEditingSession={onSaveEditingSession}
                selectedSessionIds={selectedSessionIds}
                onSetSessionSelection={onSetSessionSelection}
                onToggleSessionSelected={onToggleSessionSelected}
                onCancelSessionSelection={onCancelSessionSelection}
                onDeleteSelectedSessions={onDeleteSelectedSessions}
                t={t}
              />
            );

            if (parentProjectId) {
              return (
                <div key={project.projectId} className="ml-3 border-l border-border/60 pl-1">
                  {item}
                </div>
              );
            }
            if (worktreeCount === 0) {
              return <Fragment key={project.projectId}>{item}</Fragment>;
            }
            const isFolded = !unfoldedRepoIds.has(project.projectId);
            return (
              <Fragment key={project.projectId}>
                {item}
                <button
                  type="button"
                  onClick={() => toggleRepoFold(project.projectId)}
                  aria-expanded={!isFolded}
                  className="ml-3 flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  {isFolded
                    ? <ChevronRight className="h-3 w-3" aria-hidden />
                    : <ChevronDown className="h-3 w-3" aria-hidden />}
                  {t('projects.worktreeCount', { count: worktreeCount, defaultValue: '{{count}} worktrees' })}
                </button>
              </Fragment>
            );
          })}
    </div>
  );
}
