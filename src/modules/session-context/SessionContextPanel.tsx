import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, GitBranch, MessageSquare, RefreshCw } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { Project, ProjectSession, PullRequestReview, SessionContext, SessionContextNoteKind, SessionContextTarget } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';
import { api, ApiRequestError, readApiJson } from '@/shared/api';
import { usePullRequestReview } from '@/modules/session-context/hooks/usePullRequestReview';
import { useSessionContext } from '@/modules/session-context/hooks/useSessionContext';
import { describeChecks, describePaneSummary, describePushState, toVsCodeUrl } from '@/modules/session-context/utils/sessionContextFormatting';

const COPIED_FEEDBACK_MS = 1500;
/** Expanded, the panel takes this share of its pane; the chat keeps the rest. */
const EXPANDED_HEIGHT_CLASS = 'h-[40%]';

const NOTE_KIND_LABELS: Record<SessionContextNoteKind, [key: string, fallback: string]> = {
  checkout: ['context.notes.checkout', 'Notes'],
  prBody: ['context.notes.prBody', 'PR body'],
  handoff: ['context.notes.handoff', 'Hand-off'],
  designDoc: ['context.notes.designDoc', 'Design doc'],
  walkthrough: ['context.notes.walkthrough', 'Walkthrough'],
};

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
  const [isOpen, setIsOpen] = useState(true);
  return (
    <section className="space-y-1">
      <h4>
        <button
          type="button"
          onClick={() => setIsOpen((previous) => !previous)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-1 rounded px-1 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
        >
          {isOpen
            ? <ChevronDown className="h-3 w-3 flex-shrink-0" aria-hidden />
            : <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden />}
          {title}
        </button>
      </h4>
      {isOpen && children}
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

function EditorRow({ path, onOpen, children }: { path: string; onOpen: (path: string) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(path)}
      title={path}
      className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent/60"
    >
      {children}
    </button>
  );
}

type ReviewThread = PullRequestReview['threads'][number];

function ReviewThreadRow({ thread, t }: { thread: ReviewThread; t: TFunction }) {
  const location = thread.line ? `${thread.path}:${thread.line}` : thread.path;
  return (
    <a
      href={thread.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md bg-muted/40 px-1.5 py-1 transition-colors hover:bg-accent/60"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="min-w-0 truncate font-mono text-foreground" title={location}>{location}</span>
        {thread.isOutdated && (
          <span className="flex-shrink-0 text-[10px] text-muted-foreground">{t('context.review.outdated', 'outdated')}</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="truncate">{thread.author}</span>
        {thread.isBot && (
          <span className="flex-shrink-0 rounded border border-border px-1 uppercase">{t('context.review.bot', 'bot')}</span>
        )}
        {thread.replyCount > 0 && (
          <span className="flex flex-shrink-0 items-center gap-0.5">
            <MessageSquare className="h-2.5 w-2.5" aria-hidden />
            {t('context.review.replies', { count: thread.replyCount, defaultValue: '{{count}} replies' })}
          </span>
        )}
      </span>
      <span className="mt-0.5 line-clamp-3 whitespace-pre-line text-[11px] text-foreground/90">{thread.body}</span>
    </a>
  );
}

type ReviewState = { review: PullRequestReview | null; isLoading: boolean; hasError: boolean };

function ReviewBody({ review, isLoading, hasError, t }: ReviewState & { t: TFunction }) {
  if (!review) {
    return (
      <p className="px-1 text-[11px] text-muted-foreground">
        {hasError
          ? t('context.review.loadFailed', 'Could not load review threads.')
          : isLoading ? t('context.loading', 'Loading…') : null}
      </p>
    );
  }
  const { checks } = review;
  return (
    <div className="space-y-1">
      {hasError && (
        <p className="px-1 text-[11px] text-amber-700 dark:text-amber-300" role="status">
          {t('context.refreshFailed', 'Refresh failed. This may be out of date.')}
        </p>
      )}
      {checks && (
        <p className="px-1 text-[11px] text-foreground">
          {describeChecks(checks, t)}
          {checks.failedNames.length > 0 && (
            <span className="text-muted-foreground">: {checks.failedNames.join(', ')}</span>
          )}
        </p>
      )}
      {review.threads.length === 0 ? (
        <p className="px-1 text-[11px] text-muted-foreground">{t('context.review.noThreads', 'No open threads')}</p>
      ) : (
        review.threads.map((thread) => <ReviewThreadRow key={thread.url} thread={thread} t={t} />)
      )}
      {review.hasMoreThreads && (
        <p className="px-1 text-[10px] text-muted-foreground">{t('context.review.firstPage', 'Only the first page of threads was read.')}</p>
      )}
    </div>
  );
}

type ContextBodyProps = {
  context: SessionContext;
  reviewState: ReviewState;
  onOpenInEditor: (path: string) => void;
  t: TFunction;
};

function ContextBody({ context, reviewState, onOpenInEditor, t }: ContextBodyProps) {
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

      {context.pullRequest && (
        <Section title={t('context.review.title', 'Review')}>
          <ReviewBody {...reviewState} t={t} />
        </Section>
      )}

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
          <EditorRow path={context.folderPath} onOpen={onOpenInEditor}>
            <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('context.openInVsCode', 'Open in VS Code')}</span>
          </EditorRow>
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
              <EditorRow key={note.path} path={note.path} onOpen={onOpenInEditor}>
                <FileText className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-shrink-0 text-muted-foreground">{t(key, fallback)}</span>
                <span className="truncate">{note.name}</span>
              </EditorRow>
            );
          })}
        </Section>
      )}

      {otherWorktrees.length > 0 && (
        <Section title={t('context.worktrees', 'Other worktrees')}>
          {otherWorktrees.map((worktree) => (
            <EditorRow key={worktree.path} path={worktree.path} onOpen={onOpenInEditor}>
              <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{worktree.branch ?? worktree.path}</span>
            </EditorRow>
          ))}
        </Section>
      )}

    </div>
  );
}

/** The Push and Where sections' shape, shown while the pane's context loads. */
function ContextSkeleton({ label }: { label: string }) {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label={label}>
      <div className="space-y-1">
        <div className="mx-1 h-2.5 w-10 rounded bg-muted" />
        <div className="h-10 rounded-md bg-muted/60" />
      </div>
      <div className="space-y-1.5">
        <div className="mx-1 h-2.5 w-12 rounded bg-muted" />
        <div className="mx-1 h-3 w-5/6 rounded bg-muted/60" />
        <div className="mx-1 h-3 w-2/3 rounded bg-muted/60" />
        <div className="mx-1 h-3 w-1/2 rounded bg-muted/60" />
      </div>
      <div className="space-y-1.5">
        <div className="mx-1 h-2.5 w-14 rounded bg-muted" />
        <div className="mx-1 h-3 w-1/3 rounded bg-muted/60" />
        <div className="mx-1 h-3 w-1/4 rounded bg-muted/60" />
      </div>
    </div>
  );
}

type SessionContextPanelProps = {
  project: Project | null;
  /** Null while a new chat has no session yet; the panel still shows the folder's facts. */
  session: ProjectSession | null;
};

/**
 * Used by the project-workspace module: ChatPaneFrame renders one at the
 * bottom of every chat pane, for that pane's own conversation. Collapsed, it
 * is a one-line summary, so a short pane keeps its room for the chat.
 */
export default function SessionContextPanel({ project, session }: SessionContextPanelProps) {
  const { t } = useTranslation('sidebar');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const target = useMemo<SessionContextTarget | null>(() => (project ? { project, session } : null), [project, session]);
  const { context, isLoading, hasError, refresh } = useSessionContext(target);
  const projectId = project?.projectId ?? null;
  const {
    review,
    isLoading: isReviewLoading,
    hasError: hasReviewError,
    refresh: refreshReview,
  } = usePullRequestReview(projectId, context?.pullRequest?.number ?? null, !isCollapsed);

  const toggleCollapsed = useCallback(() => setIsCollapsed((previous) => !previous), []);
  const refreshAll = useCallback(() => {
    refresh();
    refreshReview();
  }, [refresh, refreshReview]);

  const handleOpenInEditor = useCallback((targetPath: string) => {
    if (!projectId) {
      return;
    }
    // The server starts `code`, which opens the folder in its own window. The
    // vscode:// link is the fallback; it opens in whichever window was last active.
    void api.openInEditor(projectId, targetPath)
      .then((response) => readApiJson(response))
      .catch((error: unknown) => {
        // A refused or missing path has no use for the link; only "VS Code did not start" or no answer does.
        const canFallBack = !(error instanceof ApiRequestError) || error.code === 'EDITOR_LAUNCH_FAILED';
        console.warn(`[session-context] open in VS Code failed${canFallBack ? ', using the vscode:// link' : ''}:`, error);
        if (canFallBack) {
          window.location.href = toVsCodeUrl(targetPath);
        }
      });
  }, [projectId]);

  if (!target) {
    return null;
  }

  const summary = context ? describePaneSummary(context, t, review) : t('context.loading', 'Loading…');

  return (
    <div className={`hidden min-h-0 flex-shrink-0 flex-col border-t border-border md:flex ${isCollapsed ? '' : EXPANDED_HEIGHT_CLASS}`}>
      <div className="flex items-center gap-1 px-1.5 py-0.5">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!isCollapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent/60"
        >
          {isCollapsed
            ? <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
            : <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />}
          <span className="text-xs font-medium text-foreground">{t('context.title', 'Context')}</span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={summary}>
            {summary}
          </span>
        </button>
        {!isCollapsed && (
          <button
            type="button"
            onClick={refreshAll}
            aria-label={t('context.refresh', 'Refresh context')}
            title={t('context.refresh', 'Refresh context')}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading || isReviewLoading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        )}
      </div>
      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 pt-1">
          {context && hasError && (
            <p className="mb-2 px-1 text-[11px] text-amber-700 dark:text-amber-300" role="status">
              {t('context.refreshFailed', 'Refresh failed. This may be out of date.')}
            </p>
          )}
          {context ? (
            <ContextBody
              context={context}
              reviewState={{ review, isLoading: isReviewLoading, hasError: hasReviewError }}
              onOpenInEditor={handleOpenInEditor}
              t={t}
            />
          ) : hasError ? (
            <p className="px-1 text-[11px] text-muted-foreground">{t('context.loadFailed', 'Could not load the context.')}</p>
          ) : (
            <ContextSkeleton label={t('context.loading', 'Loading…')} />
          )}
        </div>
      )}
    </div>
  );
}
