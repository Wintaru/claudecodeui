import path from 'node:path';

export type GitHubRepo = { owner: string; name: string };

export type PushTarget = {
  folderPath: string;
  branch: string | null;
  hasUpstream: boolean;
  remoteName: string | null;
};

export type ReplyCodeBlock = { language: string | null; code: string };

/** Fenced blocks whose content is a picture, not something to paste into a shell or form. */
const NON_COPYABLE_LANGUAGES = new Set(['mermaid']);

/** Note files that Trillian writes into a checkout for Josh to act on. */
const CHECKOUT_NOTE_PATTERN = /-(HANDOFF|CHECKLIST|PROPOSAL|BRIEF)\.md$/i;

/** Characters that need no quoting in bash or PowerShell. */
const PLAIN_ARGUMENT = /^[\w.:/\\@+=-]+$/;

/**
 * Single quotes are literal in both bash and PowerShell, so `$`, `;` or a
 * backtick in a branch name or folder cannot run anything when pasted. The two
 * shells escape a single quote in different ways, so such a value gets null.
 */
const quoteArgument = (value: string): string | null => {
  if (PLAIN_ARGUMENT.test(value)) {
    return value;
  }
  return value.includes("'") ? null : `'${value}'`;
};

/**
 * The push Josh runs in his own shell. Trillian cuts branches with
 * `--no-track`, so a branch with no upstream needs `-u <remote> <branch>`
 * on its first push; a plain `git push` would fail there.
 */
export function buildPushCommand(target: PushTarget): string | null {
  if (!target.branch) {
    return null;
  }
  const parts = [target.folderPath, ...(target.hasUpstream ? [] : [target.remoteName ?? 'origin', target.branch])]
    .map(quoteArgument);
  if (parts.some((part) => part === null)) {
    return null;
  }
  const [folder, remote, branch] = parts;
  return target.hasUpstream ? `git -C ${folder} push` : `git -C ${folder} push -u ${remote} ${branch}`;
}

/**
 * The issue a checkout works on: the leading number of the branch after any
 * `prefix/` segments, else the first all-digit segment of the folder name.
 */
export function parseIssueNumber(branch: string | null, folderPath: string): number | null {
  const branchLeaf = branch?.split('/').pop() ?? '';
  const branchMatch = /^(\d+)(?:-|$)/.exec(branchLeaf);
  if (branchMatch) {
    return Number(branchMatch[1]);
  }
  const folderSegment = path.basename(folderPath).split('-').find((segment) => /^\d+$/.test(segment));
  return folderSegment ? Number(folderSegment) : null;
}

/** Reads `owner/name` from an HTTPS or SSH GitHub remote URL. */
export function parseGitHubRepo(remoteUrl: string): GitHubRepo | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

/** Fenced code blocks of one reply, in reply order, without diagram blocks. */
export function extractCodeBlocks(markdown: string): ReplyCodeBlock[] {
  const blocks: ReplyCodeBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let open: { fence: string; language: string | null; body: string[] } | null = null;

  for (const line of lines) {
    if (!open) {
      const start = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/.exec(line);
      if (start) {
        open = { fence: start[1], language: start[2] ? start[2].toLowerCase() : null, body: [] };
      }
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith(open.fence) && trimmed.slice(open.fence.length).trim() === '' && trimmed[0] === open.fence[0]) {
      const code = open.body.join('\n');
      if (code.trim() && !(open.language && NON_COPYABLE_LANGUAGES.has(open.language))) {
        blocks.push({ language: open.language, code });
      }
      open = null;
      continue;
    }
    open.body.push(line);
  }

  return blocks;
}

export function isCheckoutNoteFile(fileName: string): boolean {
  return CHECKOUT_NOTE_PATTERN.test(fileName);
}

/**
 * Whether a design doc or walkthrough file belongs to this checkout: it names
 * the repo and the issue (`Ocuvera-884-…`), or, for a branch with no issue
 * number, the branch's last segment (`claudecodeui-1-split-view-…`).
 */
export function matchesCheckoutDoc(
  fileName: string,
  match: { repoName: string | null; issueNumber: number | null; branchSlug: string | null },
): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.md')) {
    return false;
  }
  const repoPrefix = match.repoName ? `${match.repoName.toLowerCase()}-` : '';
  if (match.issueNumber !== null) {
    return lower.startsWith(`${repoPrefix}${match.issueNumber}-`);
  }
  if (!match.branchSlug || match.branchSlug.length < 3) {
    return false;
  }
  return lower.startsWith(repoPrefix) && lower.includes(match.branchSlug.toLowerCase());
}
