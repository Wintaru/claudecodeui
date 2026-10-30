import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import type { NavigateFunction } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

import { MAX_SPLIT_PANES, useSplitPanes } from '@/modules/project-workspace/hooks/useSplitPanes';

/**
 * The address names the main pane; the split list holds the other panes, never
 * the main session, at most three, and survives a page reload.
 */

const STORAGE_KEY = 'cloudcli-split-panes';

const renderSplitPanes = (mainSessionId: string | null, isMobile = false) => {
  const navigate = vi.fn() as unknown as NavigateFunction & ReturnType<typeof vi.fn>;
  const rendered = renderHook(
    (props: { mainSessionId: string | null; isMobile: boolean }) => useSplitPanes({ ...props, navigate }),
    { initialProps: { mainSessionId, isMobile } },
  );
  return { ...rendered, navigate };
};

beforeEach(() => {
  localStorage.clear();
});

test('opens a session beside the main pane and stores it', () => {
  const { result } = renderSplitPanes('main');

  act(() => result.current.openSessionInSplit('other'));

  assert.deepEqual(result.current.splitSessionIds, ['other']);
  assert.equal(localStorage.getItem(STORAGE_KEY), JSON.stringify(['other']));
});

test('never shows a session twice', () => {
  const { result } = renderSplitPanes('main');

  act(() => result.current.openSessionInSplit('main'));
  act(() => result.current.openSessionInSplit('other'));
  act(() => result.current.openSessionInSplit('other'));

  assert.deepEqual(result.current.splitSessionIds, ['other']);
});

test('holds at most three split panes', () => {
  const { result } = renderSplitPanes('main');

  for (const id of ['a', 'b', 'c', 'd']) {
    act(() => result.current.openSessionInSplit(id));
  }

  assert.equal(result.current.splitSessionIds.length, MAX_SPLIT_PANES);
  assert.deepEqual(result.current.splitSessionIds, ['a', 'b', 'c']);
  assert.equal(result.current.isSplitFull, true);
});

test('with no main pane, opening in split opens the main pane', () => {
  const { result, navigate } = renderSplitPanes(null);

  act(() => result.current.openSessionInSplit('other'));

  assert.deepEqual(navigate.mock.calls, [['/session/other']]);
  assert.deepEqual(result.current.splitSessionIds, []);
});

test('a split session selected as the main pane leaves the split list', () => {
  const { result, rerender } = renderSplitPanes('main');
  act(() => result.current.openSessionInSplit('other'));

  rerender({ mainSessionId: 'other', isMobile: false });

  assert.deepEqual(result.current.splitSessionIds, []);
});

test('closing the main pane promotes the first split pane', () => {
  const { result, navigate } = renderSplitPanes('main');
  act(() => result.current.openSessionInSplit('first'));
  act(() => result.current.openSessionInSplit('second'));

  act(() => result.current.closeMainPane());

  assert.deepEqual(navigate.mock.calls, [['/session/first']]);
});

test('a fork replaces the pane it came from', () => {
  const { result } = renderSplitPanes('main');
  act(() => result.current.openSessionInSplit('a'));
  act(() => result.current.openSessionInSplit('b'));

  act(() => result.current.replaceSplitPane('a', 'fork-of-a'));

  assert.deepEqual(result.current.splitSessionIds, ['fork-of-a', 'b']);
});

test('restores stored panes and ignores bad storage', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'a', 7, 'b', 'c', 'd']));
  assert.deepEqual(renderSplitPanes('main').result.current.splitSessionIds, ['a', 'b', 'c']);

  localStorage.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(renderSplitPanes('main').result.current.splitSessionIds, []);
});

test('a phone-width screen shows no split panes but keeps them stored', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(['a']));
  const { result } = renderSplitPanes('main', true);

  assert.deepEqual(result.current.splitSessionIds, []);
  assert.equal(localStorage.getItem(STORAGE_KEY), JSON.stringify(['a']));
});
