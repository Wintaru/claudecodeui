import type { ProjectSortOrder } from '@/shared/types';
import { readUserPreference } from '@/shared/userSettings';

export const readProjectSortOrder = (): ProjectSortOrder => (
  readUserPreference<ProjectSortOrder>('projectSortOrder', 'name') === 'date' ? 'date' : 'name'
);

const LEGACY_STARRED_PROJECTS_STORAGE_KEY = 'starredProjects';

/**
 * Reads legacy project stars from localStorage (used only for one-time migration to backend).
 */
export const readLegacyStarredProjectIds = (): string[] => {
  try {
    const saved = localStorage.getItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  } catch {
    return [];
  }
};

const UNFOLDED_WORKTREE_REPOS_STORAGE_KEY = 'cloudcli-unfolded-worktree-repos';

/** The repos whose worktree rows the user opened, by project id. Every other repo starts folded. */
export const readUnfoldedWorktreeRepoIds = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(UNFOLDED_WORKTREE_REPOS_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

export const writeUnfoldedWorktreeRepoIds = (projectIds: ReadonlySet<string>): void => {
  try {
    localStorage.setItem(UNFOLDED_WORKTREE_REPOS_STORAGE_KEY, JSON.stringify([...projectIds]));
  } catch {
    // Storage unavailable: the fold still works for this page load.
  }
};

/**
 * Clears the legacy localStorage stars key after migration to backend completes.
 */
export const clearLegacyStarredProjectIds = () => {
  try {
    localStorage.removeItem(LEGACY_STARRED_PROJECTS_STORAGE_KEY);
  } catch {
    // Keep UI responsive even if storage is unavailable.
  }
};
