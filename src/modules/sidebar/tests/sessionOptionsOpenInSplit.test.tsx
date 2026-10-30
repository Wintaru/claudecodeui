import assert from 'node:assert/strict';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, test, vi } from 'vitest';

import type { SidebarSplitViewActions } from '@/shared/types';

/**
 * "Open in split" shows a session beside the open conversation. It is not
 * offered for a session already on screen, and with three conversations open
 * it stays in the menu, disabled, so no pane closes without the user.
 */

vi.mock('@/shared/hooks/useProviderCapabilities', () => ({
  useSessionForkingProviders: () => new Set<string>(),
}));

const { default: SessionOptions } = await import('@/modules/sidebar/SessionOptions');

const t = ((key: string) => key) as unknown as TFunction;
const noop = () => {};

const splitView = (overrides: Partial<SidebarSplitViewActions> = {}): SidebarSplitViewActions => ({
  openSessionInSplit: vi.fn(),
  splitSessionIds: new Set<string>(),
  maxPanes: 3,
  isSplitFull: false,
  ...overrides,
});

const openMenu = (props: { splitView?: SidebarSplitViewActions; isSelected?: boolean }) => {
  render(
    <SessionOptions
      sessionId="session-1"
      sessionName="Trillian"
      provider="claude"
      projectId="project-1"
      isProcessing={false}
      isEditing={false}
      renameDraft=""
      onRenameDraftChange={noop}
      onStartEditingSession={noop}
      onCancelEditingSession={noop}
      onSaveEditingSession={noop}
      onDeleteSession={noop}
      t={t}
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Session options for Trillian' }));
};

const findItem = () => screen.queryByText('Open in split')?.closest('button') ?? null;

afterEach(() => {
  cleanup();
});

test('opens the session in a split pane', () => {
  const actions = splitView();
  openMenu({ splitView: actions });

  const item = findItem();
  assert.ok(item, 'expected the Open in split item');
  fireEvent.click(item);

  assert.deepEqual((actions.openSessionInSplit as ReturnType<typeof vi.fn>).mock.calls, [['session-1']]);
});

test('is not offered for the main pane, a split pane, or at phone width', () => {
  openMenu({ splitView: splitView(), isSelected: true });
  assert.equal(findItem(), null);
  cleanup();

  openMenu({ splitView: splitView({ splitSessionIds: new Set(['session-1']) }) });
  assert.equal(findItem(), null);
  cleanup();

  openMenu({});
  assert.equal(findItem(), null);
});

test('is disabled with three conversations open', () => {
  const actions = splitView({ isSplitFull: true });
  openMenu({ splitView: actions });

  const item = findItem();
  assert.ok(item);
  assert.equal(item.disabled, true);
  assert.ok(screen.getByText('Close a pane first (3 open).'));
});
