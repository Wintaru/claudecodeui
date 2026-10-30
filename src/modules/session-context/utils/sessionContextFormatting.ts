import type { TFunction } from 'i18next';

import type { PullRequestReview, SessionContext } from '@/shared/types';

/**
 * A `vscode://file` link. The URI's authority is `file`, so the path after it
 * must start with one slash: `/C:/repo/x.md` on Windows, `/home/x.md` elsewhere.
 */
export function toVsCodeUrl(filePath: string): string {
  const forward = filePath.replace(/\\/g, '/');
  // encodeURI keeps `#` and `?`, which would end the path early.
  const encoded = encodeURI(forward).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `vscode://file${forward.startsWith('/') ? '' : '/'}${encoded}`;
}

/** The push line's status: commits waiting, nothing to push, or no upstream yet. */
export function describePushState(git: NonNullable<SessionContext['git']>, t: TFunction): string {
  if (!git.hasUpstream) {
    return t('context.push.noUpstream', 'Not pushed yet');
  }
  const parts: string[] = [];
  if (git.ahead) {
    parts.push(t('context.push.ahead', { count: git.ahead, defaultValue: '{{count}} commits to push' }));
  }
  if (git.behind) {
    parts.push(t('context.push.behind', { count: git.behind, defaultValue: '{{count}} behind' }));
  }
  return parts.length > 0 ? parts.join(' · ') : t('context.push.upToDate', 'Nothing to push');
}

/** The checks in a few words: failed first, then still running, else passed. */
export function describeChecks(checks: NonNullable<PullRequestReview['checks']>, t: TFunction): string {
  if (checks.failedNames.length > 0) {
    return t('context.review.checksFailed', { count: checks.failedNames.length, defaultValue: '{{count}} checks failed' });
  }
  if (checks.pendingCount > 0) {
    return t('context.review.checksPending', { count: checks.pendingCount, defaultValue: '{{count}} checks running' });
  }
  return t('context.review.checksPassed', 'Checks passed');
}

/**
 * The collapsed bar's one line: branch, PR, and push state, each only when
 * known. The thread count and checks join once the review has loaded.
 */
export function describePaneSummary(context: SessionContext, t: TFunction, review: PullRequestReview | null = null): string {
  if (!context.folderExists) {
    return t('context.folderMissing', 'Folder removed');
  }
  const { git } = context;
  if (!git) {
    return t('context.notGit', 'Not a git repository');
  }
  const parts = [git.branch ?? t('context.detached', 'detached HEAD')];
  if (context.pullRequest) {
    parts.push(t('context.pullRequest', { number: context.pullRequest.number, defaultValue: 'PR #{{number}}' }));
  }
  if (review) {
    parts.push(t('context.review.openThreads', { count: review.threads.length, defaultValue: '{{count}} open threads' }));
    if (review.checks) {
      parts.push(describeChecks(review.checks, t));
    }
  }
  if (git.pushCommand) {
    parts.push(describePushState(git, t));
  }
  return parts.join(' · ');
}
