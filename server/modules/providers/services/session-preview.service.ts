import fsp from 'node:fs/promises';

import type { NormalizedMessage } from '@/shared/types.js';

/**
 * The last thing the user said and the last thing the assistant said in one
 * conversation, shortened for a sidebar row.
 */
export type SessionPreview = {
  lastPrompt: string | null;
  lastReply: string | null;
};

type CacheEntry = {
  transcriptPath: string;
  mtimeMs: number;
  size: number;
  preview: SessionPreview;
};

type GetPreviewArgs = {
  sessionId: string;
  /** The JSONL transcript to read, or null for a provider whose messages live elsewhere. */
  transcriptPath: string | null | undefined;
  /** Turns one raw transcript row into the messages the chat shows as said by the user or the assistant. */
  normalize: (raw: unknown) => NormalizedMessage[];
};

/**
 * A preview reads only the end of the transcript. Tool results can make one
 * row larger than the first window, so the window doubles until both texts
 * are found or the cap is reached.
 */
const INITIAL_TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 300;
/** The previews are short strings, so the cap is on entries and not on bytes. */
const MAX_CACHE_ENTRIES = 200;

const EMPTY_PREVIEW: SessionPreview = { lastPrompt: null, lastReply: null };

/** Collapses Markdown markers and whitespace so the text reads as one line of prose. */
function toPreviewText(content: string): string {
  const flattened = content
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*{1,3}|`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flattened.length > MAX_PREVIEW_CHARS
    ? `${flattened.slice(0, MAX_PREVIEW_CHARS - 1).trimEnd()}…`
    : flattened;
}

async function readTail(transcriptPath: string, size: number, tailBytes: number): Promise<string> {
  const start = Math.max(0, size - tailBytes);
  const handle = await fsp.open(transcriptPath, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    // A window that starts mid-file starts mid-row; drop that partial row.
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } finally {
    await handle.close();
  }
}

function findPreview(tail: string, normalize: GetPreviewArgs['normalize']): SessionPreview {
  let lastPrompt: string | null = null;
  let lastReply: string | null = null;
  const lines = tail.split('\n');

  for (let index = lines.length - 1; index >= 0 && (lastPrompt === null || lastReply === null); index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    let messages: NormalizedMessage[];
    try {
      messages = normalize(JSON.parse(line));
    } catch {
      // The last row can be half-written while the CLI streams into the file,
      // and one odd row must not cost the whole preview.
      continue;
    }
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex];
      const text = message.kind === 'text' && message.content ? toPreviewText(message.content) : '';
      if (!text) {
        continue;
      }
      if (message.role === 'assistant' && lastReply === null) {
        lastReply = text;
      } else if (message.role === 'user' && lastPrompt === null) {
        lastPrompt = text;
      }
    }
  }

  return { lastPrompt, lastReply };
}

/**
 * Reads conversation previews for the Conversations list.
 *
 * Each entry is validated with one `stat` against the transcript's path,
 * mtime and size, so a list reload reads only the transcripts that changed.
 * It reads the end of the file, not the whole transcript, and it keeps its
 * own entries so a list of 40 rows cannot evict the full histories that the
 * open chats hold in the history cache.
 */
export function createSessionPreviewCache(maxEntries = MAX_CACHE_ENTRIES) {
  const entries = new Map<string, CacheEntry>();

  return {
    async getPreview({ sessionId, transcriptPath, normalize }: GetPreviewArgs): Promise<SessionPreview> {
      if (!transcriptPath) {
        return EMPTY_PREVIEW;
      }

      let stat;
      try {
        stat = await fsp.stat(transcriptPath);
      } catch {
        entries.delete(sessionId);
        return EMPTY_PREVIEW;
      }

      const cached = entries.get(sessionId);
      if (
        cached
        && cached.transcriptPath === transcriptPath
        && cached.mtimeMs === stat.mtimeMs
        && cached.size === stat.size
      ) {
        entries.delete(sessionId);
        entries.set(sessionId, cached);
        return cached.preview;
      }

      let preview = EMPTY_PREVIEW;
      try {
        for (let tailBytes = INITIAL_TAIL_BYTES; ; tailBytes *= 2) {
          preview = findPreview(await readTail(transcriptPath, stat.size, tailBytes), normalize);
          const isComplete = preview.lastPrompt !== null && preview.lastReply !== null;
          if (isComplete || tailBytes >= stat.size || tailBytes >= MAX_TAIL_BYTES) {
            break;
          }
        }
      } catch (error) {
        console.warn(`[session-preview] Could not read ${transcriptPath}:`, error instanceof Error ? error.message : error);
        return EMPTY_PREVIEW;
      }

      entries.delete(sessionId);
      entries.set(sessionId, { transcriptPath, mtimeMs: stat.mtimeMs, size: stat.size, preview });
      if (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) {
          entries.delete(oldestKey);
        }
      }
      return preview;
    },
  };
}

export const sessionPreviewCache = createSessionPreviewCache();
