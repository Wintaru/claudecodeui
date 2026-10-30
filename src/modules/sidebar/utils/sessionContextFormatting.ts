import type { TFunction } from 'i18next';

import type { SessionContext } from '@/shared/types';

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
