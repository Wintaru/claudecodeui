import type { GitCommandRunner } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { parseGitHubRepo, type GitHubRepo } from '@/modules/session-context/session-context.helpers.js';

export type ReviewThread = {
  path: string;
  line: number | null;
  isOutdated: boolean;
  url: string;
  author: string;
  isBot: boolean;
  body: string;
  /** Comments after the first one. */
  replyCount: number;
};

export type PullRequestChecks = { total: number; failedNames: string[]; pendingCount: number };

export type PullRequestReview = {
  /** Unresolved threads only, oldest first. */
  threads: ReviewThread[];
  /** True when the PR has more threads than one page holds, so some open ones may be missing. */
  hasMoreThreads: boolean;
  /** Null when the head commit has no checks. */
  checks: PullRequestChecks | null;
};

export type PullRequestReviewDependencies = {
  runGit: GitCommandRunner;
  /** `gh api graphql`; resolves the raw JSON, or null when gh is missing, slow, or fails. */
  runGraphQl: (query: string, variables: { owner: string; name: string; number: number }, cwd: string) => Promise<string | null>;
};

export type ReadPullRequestReviewInput = { folderPath: string; pullRequestNumber: number };

const THREAD_PAGE_SIZE = 100;
const CHECK_PAGE_SIZE = 100;
/** A long first comment is cut here; the panel shows only its start and links to the thread. */
const MAX_BODY_LENGTH = 1000;

export const REVIEW_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${THREAD_PAGE_SIZE}) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: 1) {
            totalCount
            nodes { author { login __typename } body url }
          }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: ${CHECK_PAGE_SIZE}) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const FAILED_STATES = new Set(['FAILURE', 'ERROR']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED']);

type RawComment = { author?: { login?: string; __typename?: string } | null; body?: string; url?: string };
type RawThread = {
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string;
  line?: number | null;
  originalLine?: number | null;
  comments?: { totalCount?: number; nodes?: RawComment[] };
};
type RawCheck = { __typename?: string; name?: string; status?: string; conclusion?: string | null; context?: string; state?: string };
type RawReview = {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: { pageInfo?: { hasNextPage?: boolean }; nodes?: RawThread[] };
        commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { contexts?: { nodes?: RawCheck[] } } | null } }> };
      } | null;
    } | null;
  };
};

function toThread(raw: RawThread): ReviewThread | null {
  const first = raw.comments?.nodes?.[0];
  if (raw.isResolved || !first?.url) {
    return null;
  }
  const login = first.author?.login ?? 'ghost';
  const body = first.body ?? '';
  return {
    path: raw.path ?? '',
    // An outdated thread has no current line, only the line it was written on.
    line: raw.line ?? raw.originalLine ?? null,
    isOutdated: Boolean(raw.isOutdated),
    url: first.url,
    author: login,
    isBot: first.author?.__typename === 'Bot' || login.endsWith('[bot]'),
    body: body.length > MAX_BODY_LENGTH ? `${body.slice(0, MAX_BODY_LENGTH)}…` : body,
    replyCount: Math.max(0, (raw.comments?.totalCount ?? 1) - 1),
  };
}

function toChecks(rawChecks: RawCheck[] | undefined): PullRequestChecks | null {
  if (!rawChecks || rawChecks.length === 0) {
    return null;
  }
  const failedNames: string[] = [];
  let pendingCount = 0;
  for (const check of rawChecks) {
    if (check.__typename === 'CheckRun') {
      if (check.status !== 'COMPLETED') {
        pendingCount += 1;
      } else if (check.conclusion && FAILED_CONCLUSIONS.has(check.conclusion)) {
        failedNames.push(check.name ?? 'check');
      }
    } else if (check.state && PENDING_STATES.has(check.state)) {
      pendingCount += 1;
    } else if (check.state && FAILED_STATES.has(check.state)) {
      failedNames.push(check.context ?? 'status');
    }
  }
  return { total: rawChecks.length, failedNames, pendingCount };
}

/** Turns `gh api graphql` output into the panel's review data; throws when the PR is not in it. */
export function parsePullRequestReview(output: string): PullRequestReview {
  const pullRequest = (JSON.parse(output) as RawReview).data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new AppError('Pull request not found', { code: 'PULL_REQUEST_NOT_FOUND', statusCode: 404 });
  }
  const threads = (pullRequest.reviewThreads?.nodes ?? [])
    .map(toThread)
    .filter((thread): thread is ReviewThread => thread !== null);
  return {
    threads,
    hasMoreThreads: Boolean(pullRequest.reviewThreads?.pageInfo?.hasNextPage),
    checks: toChecks(pullRequest.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
  };
}

async function readRepo(folderPath: string, runGit: GitCommandRunner): Promise<GitHubRepo> {
  let remoteUrl = '';
  try {
    remoteUrl = (await runGit(['remote', 'get-url', 'origin'], folderPath)).stdout.trim();
  } catch {
    // No origin: handled below like a remote that is not on GitHub.
  }
  const repo = remoteUrl ? parseGitHubRepo(remoteUrl) : null;
  if (!repo) {
    throw new AppError('The checkout has no GitHub origin', { code: 'REPO_NOT_GITHUB', statusCode: 404 });
  }
  return repo;
}

/**
 * Reads a PR's open review threads and its head commit's checks. The repo
 * comes from the checkout's own origin, so a request can only name a PR
 * number, never another repository.
 */
export async function readPullRequestReview(
  { folderPath, pullRequestNumber }: ReadPullRequestReviewInput,
  deps: PullRequestReviewDependencies,
): Promise<PullRequestReview> {
  const repo = await readRepo(folderPath, deps.runGit);
  const output = await deps.runGraphQl(REVIEW_QUERY, { owner: repo.owner, name: repo.name, number: pullRequestNumber }, folderPath);
  if (output === null) {
    throw new AppError('Could not read the review threads from GitHub', { code: 'GITHUB_REQUEST_FAILED', statusCode: 502 });
  }
  return parsePullRequestReview(output);
}
