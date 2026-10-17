/**
 * LUM-1093 — one paging contract for `list`-style commands.
 *
 * Every paged command takes `--limit <n>` (default {@link DEFAULT_PAGE_SIZE})
 * and `--cursor <c>`. The cursor is opaque to callers: copy it from the footer
 * or from `nextCursor` in `--json`. (Today it is the offset of the first row
 * of the next page; servers and the CLI both accept only that shape.)
 *
 * When a page does not hold the whole result, the output ends with a fixed,
 * parseable footer — agents rely on it to notice they did not see everything:
 *
 *   Showing 1-50 of 132.
 *   Next page: lumo task list --cursor 50
 *
 * LUM-1232 (conventions PG-1, decision Q5): the second line is data, not a
 * hint — it always prints, `--no-hints` does not touch it.
 *
 * A result that fits on the first page prints no footer, so short lists look
 * exactly as before. No colour here: the footer is read by agents as-is.
 */

import { shellQuote } from './confirmation'
import { sanitizeField } from './sanitize'

/** User-ruled default page size (LUM-1093 decision, 2026-10-13). */
/** The paging footer's second line (PG-1). */
export const NEXT_PAGE_PREFIX = 'Next page:'

export const DEFAULT_PAGE_SIZE = 50
/** Upper bound for `--limit` (the servers cap a page at the same size). */
export const MAX_PAGE_SIZE = 500

export interface PageArgs {
  limit: number
  offset: number
}

export type PageArgsResult =
  | ({ ok: true } & PageArgs)
  | { ok: false; error: string }

/** Validate `--limit` / `--cursor`; the error is ready to print after `Error: `. */
export function parsePageArgs(
  limit: string | undefined,
  cursor: string | undefined,
  defaultLimit: number = DEFAULT_PAGE_SIZE
): PageArgsResult {
  let n = defaultLimit
  if (limit !== undefined) {
    n = /^\d+$/.test(limit.trim()) ? Number(limit.trim()) : NaN
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) {
      return {
        ok: false,
        error: `invalid --limit "${sanitizeField(limit)}" (expected an integer 1-${MAX_PAGE_SIZE})`,
      }
    }
  }
  let offset = 0
  if (cursor !== undefined) {
    if (!/^\d{1,9}$/.test(cursor.trim())) {
      return {
        ok: false,
        error: `invalid --cursor "${sanitizeField(cursor)}" (copy it from the previous page's footer or nextCursor)`,
      }
    }
    offset = Number(cursor.trim())
  }
  return { ok: true, limit: n, offset }
}

export interface Page<T> {
  items: T[]
  /** Size of the whole (filtered) result, not just this page. */
  total: number
  /** Offset of the first item of this page. */
  offset: number
  /** Cursor for the next page, or null on the last page. */
  nextCursor: string | null
}

/** Cursor for the page after `[offset, offset + shown)` out of `total`. */
export function nextCursorFor(
  offset: number,
  shown: number,
  total: number
): string | null {
  return offset + shown < total ? String(offset + shown) : null
}

/** Slice an already-fetched list into one page (client-side paging). */
export function paginate<T>(all: T[], args: PageArgs): Page<T> {
  const items = all.slice(args.offset, args.offset + args.limit)
  return {
    items,
    total: all.length,
    offset: args.offset,
    nextCursor: nextCursorFor(args.offset, items.length, all.length),
  }
}

/** A flag of the command being re-printed: value-less when `true`. */
export type CommandFlag = [
  flag: string,
  value: string | string[] | boolean | undefined | null,
]

/**
 * `lumo <base> <flags…>` with every value shell-quoted (and sanitized), so
 * the footer command can be pasted or run as-is. Empty / false / undefined
 * flags are dropped; array values repeat the flag.
 */
export function buildCommand(base: string, flags: CommandFlag[]): string {
  const parts = [`lumo ${base}`]
  for (const [flag, value] of flags) {
    if (value === undefined || value === null || value === false) continue
    if (value === true) {
      parts.push(flag)
      continue
    }
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v === '') continue
      parts.push(`${flag} ${shellQuote(sanitizeField(v))}`)
    }
  }
  return parts.join(' ')
}

/**
 * The footer lines for a page, or `[]` when there is nothing to say (the page
 * is the whole result). `command` is the next-page command without `--cursor`.
 * `noun` names what the next page holds (default `next page`).
 */
export function pageFooter(
  page: Pick<Page<unknown>, 'total' | 'offset' | 'nextCursor'> & {
    shown: number
    /** 1-based position of the first shown row (default `offset + 1`). */
    first?: number
  },
  command: string,
  noun = 'next page'
): string[] {
  if (page.nextCursor === null && page.offset === 0) return []
  const first = page.first ?? page.offset + 1
  const lines = [
    page.shown === 0
      ? `Showing 0 of ${page.total}.`
      : `Showing ${first}-${first + page.shown - 1} of ${page.total}.`,
  ]
  if (page.nextCursor !== null) {
    lines.push(`${NEXT_PAGE_PREFIX} ${command} --cursor ${page.nextCursor}`)
  }
  void noun // kept for callers; one wording now (PG-1)
  return lines
}

/** `--json` envelope fields every paged command adds. */
export function pageJson(page: Pick<Page<unknown>, 'total' | 'nextCursor'>): {
  total: number
  nextCursor: string | null
} {
  return { total: page.total, nextCursor: page.nextCursor }
}
