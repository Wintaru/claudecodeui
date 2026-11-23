import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { test, vi } from 'vitest';

import type { Project, SidebarProjectListProps } from '@/shared/types';

/**
 * A click on a project's header only opens or closes its list. Switching the
 * workspace to the project would close the conversation in the main pane, so
 * that happens only when a conversation of the project is opened or started.
 */

const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const noop = () => {};

const PROJECT = { projectId: 'project-1', name: 'project-1', displayName: 'project one', fullPath: '/tmp/project-1', sessions: [] } as unknown as Project;
const OTHER_PROJECT = { projectId: 'project-2', name: 'project-2', displayName: 'project two', fullPath: '/tmp/project-2', sessions: [] } as unknown as Project;

test('a header click toggles the project without selecting it', () => {
  const onToggleProject = vi.fn();
  const onProjectSelect = vi.fn();

  render(
    React.createElement(SidebarProjectItem, {
      project: PROJECT,
      selectedProject: OTHER_PROJECT,
      selectedSession: null,
      isExpanded: false,
      isDeleting: false,
      isStarred: false,
      isEditing: false,
      renameDraft: '',
      sessions: [],
      initialSessionsLoaded: true,
      isLoadingMoreSessions: false,
      currentTime: new Date('2026-08-21T10:00:00.000Z'),
      sessionRenameId: null,
      sessionRenameDraft: '',
      tasksEnabled: false,
      mcpServerStatus: null,
      onRenameDraftChange: noop,
      onToggleProject,
      onProjectSelect,
      onToggleStarProject: noop,
      onStartEditingProject: noop,
      onCancelEditingProject: noop,
      onSaveProjectName: noop,
      onDeleteProject: noop,
      onSessionSelect: noop,
      onDeleteSession: noop,
      onLoadMoreSessions: noop,
      activeSessions: new Set<string>(),
      backgroundSessionIds: new Set<string>(),
      attentionSessionIds: new Set<string>(),
      onNewSession: noop,
      onStartEditingSession: noop,
      onCancelEditingSession: noop,
      onSaveEditingSession: noop,
      selectedSessionIds: null,
      onSetSessionSelection: noop,
      onToggleSessionSelected: noop,
      onCancelSessionSelection: noop,
      onDeleteSelectedSessions: noop,
      t,
    }),
  );

  fireEvent.click(screen.getByText('project one'));

  assert.deepEqual(onToggleProject.mock.calls, [['project-1']]);
  assert.equal(onProjectSelect.mock.calls.length, 0);
});
