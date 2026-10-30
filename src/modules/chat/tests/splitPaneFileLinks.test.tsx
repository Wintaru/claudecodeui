import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';

/**
 * File links open in the workspace editor, which serves the main pane's
 * project only. In a split pane of another project the same relative path
 * names a different file, so the link is shown as text and opens nothing.
 */

const openFileInEditor = vi.fn();
const openDirectory = vi.fn();

vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({ openFileInEditor, openDirectory }),
}));

const { Markdown } = await import('@/modules/chat/transcript/Markdown');

const clickReference = (canOpenFiles: boolean) => {
  openFileInEditor.mockReset();
  render(
    <MarkdownWorkspaceContext.Provider value={{ projectId: 'project-b', canOpenFiles }}>
      <Markdown>{'See [src/foo.ts](src/foo.ts).'}</Markdown>
    </MarkdownWorkspaceContext.Provider>,
  );
  const link = screen.getAllByText('src/foo.ts').at(-1);
  assert.ok(link);
  fireEvent.click(link);
  return link;
};

test('a pane of the main project opens the file', () => {
  const link = clickReference(true);

  assert.equal(link.tagName, 'A');
  assert.deepEqual(openFileInEditor.mock.calls, [['src/foo.ts', null]]);
});

test('a pane of another project shows the path but opens nothing', () => {
  const link = clickReference(false);

  assert.equal(link.tagName, 'SPAN');
  assert.equal(openFileInEditor.mock.calls.length, 0);
});
