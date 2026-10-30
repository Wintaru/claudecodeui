import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, GitBranch, RefreshCw } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { SessionContext, SessionContextNoteKind, SidebarContextTarget } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';
import { useSessionContext } from '@/modules/sidebar/hooks/useSessionContext';
import { describePushState, toVsCodeUrl } from '@/modules/sidebar/utils/sessionContextFormatting';

const COLLAPSED_STORAGE_KEY = 'cloudcli-context-panel-collapsed';
const COPIED_FEEDBACK_MS = 1500;

const NOTE_KIND_LABELS: Record<SessionContextNoteKind, [key: string, fallback: string]> = {
  checkout: ['context.notes.checkout', 'Notes'],
  prBody: ['context.notes.prBody', 'PR body'],
  handoff: ['context.notes.handoff', 'Hand-off'],
  designDoc: ['context.notes.designDoc', 'Design doc'],
  walkthrough: ['context.notes.walkthrough', 'Walkthrough'],
};

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(isCollapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(isCollapsed));
  } catch {
    // Storage unavailable: the panel still collapses for this page load.
  }
}

function CopyButton({ text, label, t }: { text: string; label: string; t: TFunction }) {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isCopied) {
      return undefined;
    }
    const timer = window.setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    setIsCopied(await copyTextToClipboard(text));
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={label}
      title={isCopied ? t('context.copied', 'Copied') : label}
      className="flex h-6 flex-shrink-0 items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      {isCopied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {isCopied && <span>{t('context.copied', 'Copied')}</span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h4 className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">{title}</h4>
      {children}
    </section>
  );
}

function CommandRow({ command, caption, copyLabel, t }: { command: string; caption?: string; copyLabel: string; t: TFunction }) {
  const firstLine = command.split('\n')[0];
  const extraLines = command.split('\n').length - 1;
  return (
    <div className="flex items-start gap-1 rounded-md bg-muted/40 px-1.5 py-1">
      <div className="min-w-0 flex-1">
        <code className="block truncate font-mono text-[11px] text-foreground" title={command}>{firstLine}</code>
        {(caption || extraLines > 0) && (
          <span className="block text-[10px] text-muted-foreground">
            {[caption, extraLines > 0 ? t('context.moreLines', { count: extraLines, defaultValue: '+{{count}} lines' }) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </div>
      <CopyButton text={command} label={copyLabel} t={t} />
    </div>
  );
}

function LinkRow({ href, children, title }: { href: string; children: ReactNode; title?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent/60"
    >
      {children}
    </a>
  );
}

function ContextBody({ context, t }: { context: SessionContext; t: TFunction }) {
  const { git } = context;
  const otherWorktrees = context.worktrees.filter((worktree) => !worktree.isCurrent);

  return (
    <div className="space-y-3">
      <Section title={t('context.push.title', 'Push')}>
        {!context.folderExists ? (
          <p className="px-1 text-[11px] text-muted-foreground">{t('context.folderMissing', 'Folder removed')}</p>
        ) : git?.pushCommand ? (
          <CommandRow
            command={git.pushCommand}
            caption={describePushState(git, t)}
            copyLabel={t('context.push.copy', 'Copy push command')}
            t={t}
          />
        ) : (
          <p className="px-1 text-[11px] text-muted-foreground">
            {git ? t('context.push.unavailable', 'No branch or remote to push') : t('context.notGit', 'Not a git repository')}
          </p>
        )}
      </Section>

      {context.lastReply && context.lastReply.blocks.length > 0 && (
        <Section title={t('context.lastReply', 'From the last reply')}>
          {context.lastReply.blocks.map((block, index) => (
            <CommandRow
              key={`${index}-${block.code.length}`}
              command={block.code}
              caption={block.language ?? undefined}
              copyLabel={t('context.copyBlock', 'Copy block')}
              t={t}
            />
          ))}
        </Section>
      )}

      <Section title={t('context.where', 'Where')}>
        <div className="flex items-center gap-1 px-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={context.folderPath}>
            {context.folderPath}
          </span>
          <CopyButton text={context.folderPath} label={t('context.copyPath', 'Copy folder path')} t={t} />
        </div>
        {git && (
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-foreground">
            <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{git.branch ?? t('context.detached', 'detached HEAD')}</span>
            <span className="flex-shrink-0 text-muted-foreground">
              · {t('context.changed', { count: git.changedFileCount, defaultValue: '{{count}} changed' })}
              {git.stagedFileCount > 0 && ` · ${t('context.staged', { count: git.stagedFileCount, defaultValue: '{{count}} staged' })}`}
            </span>
          </div>
        )}
        {context.folderExists && (
          <LinkRow href={toVsCodeUrl(context.folderPath)}>
            <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('context.openInVsCode', 'Open in VS Code')}</span>
          </LinkRow>
        )}
      </Section>

      {(context.issue?.url || context.pullRequest || context.compareUrl) && (
        <Section title={t('context.github', 'GitHub')}>
          {context.issue?.url && (
            <LinkRow href={context.issue.url}>
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('context.issue', { number: context.issue.number, defaultValue: 'Issue #{{number}}' })}</span>
            </LinkRow>
          )}
          {context.pullRequest ? (
            <LinkRow href={context.pullRequest.url}>
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('context.pullRequest', { number: context.pullRequest.number, defaultValue: 'PR #{{number}}' })}</span>
              <span className="text-[10px] lowercase text-muted-foreground">{context.pullRequest.state}</span>
            </LinkRow>
          ) : context.compareUrl && (
            <LinkRow href={context.compareUrl}>
              <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span>{t('context.startPullRequest', 'Start a PR')}</span>
            </LinkRow>
          )}
        </Section>
      )}

      {context.notes.length > 0 && (
        <Section title={t('context.notes.title', 'Notes')}>
          {context.notes.map((note) => {
            const [key, fallback] = NOTE_KIND_LABELS[note.kind];
            return (
              <LinkRow key={note.path} href={toVsCodeUrl(note.path)} title={note.path}>
                <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-shrink-0 text-muted-foreground">{t(key, fallback)}</span>
                <span className="truncate">{note.name}</span>
              </LinkRow>
            );
          })}
        </Section>
      )}

      {otherWorktrees.length > 0 && (
        <Section title={t('context.worktrees', 'Other worktrees')}>
          {otherWorktrees.map((worktree) => (
            <LinkRow key={worktree.path} href={toVsCodeUrl(worktree.path)} title={worktree.path}>
              <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{worktree.branch ?? worktree.path}</span>
            </LinkRow>
          ))}
        </Section>
      )}

    </div>
  );
}

type SidebarContextPanelProps = {
  target: SidebarContextTarget | null;
  t: TFunction;
};

/** Rendered by SidebarContent between the list and the footer: what Josh needs at hand for the focused conversation. */
export default function SidebarContextPanel({ target, t }: SidebarContextPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(readCollapsed);
  const { context, isLoading, hasError, refresh } = useSessionContext(isCollapsed ? null : target);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((previous) => {
      writeCollapsed(!previous);
      return !previous;
    });
  }, []);

  if (!target) {
    return null;
  }

  const projectName = target.project.displayName || target.project.path;
  const branch = context?.git?.branch;

  return (
    <div className="hidden max-h-[50%] min-h-0 flex-shrink-0 flex-col md:flex">
      <div className="nav-divider" />
      <div className="flex items-center gap-1 px-2 pt-1.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent/60"
        >
          {isCollapsed
            ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
            : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />}
          <span className="text-xs font-medium text-foreground">{t('context.title', 'Context')}</span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={projectName}>
            {projectName}{branch ? ` · ${branch}` : ''}
          </span>
        </button>
        {!isCollapsed && (
          <button
            type="button"
            onClick={refresh}
            aria-label={t('context.refresh', 'Refresh context')}
            title={t('context.refresh', 'Refresh context')}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        )}
      </div>
      {!isCollapsed && (
        <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
          {context && hasError && (
            <p className="mb-2 px-1 text-[11px] text-amber-700 dark:text-amber-300" role="status">
              {t('context.refreshFailed', 'Refresh failed. This may be out of date.')}
            </p>
          )}
          {context ? (
            <ContextBody context={context} t={t} />
          ) : hasError ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t('context.loadFailed', 'Could not load the context.')}</p>
          ) : (
            <p className="px-1 text-[11px] text-muted-foreground">{t('context.loading', 'Loading…')}</p>
          )}
        </div>
      )}
    </div>
  );
}
