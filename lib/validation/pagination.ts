import { z } from 'zod'

/**
 * LUM-1093 — offset paging for list endpoints the CLI pages through
 * (`--limit` / `--cursor`). The cursor is opaque to clients: it is echoed
 * back from a previous response's `nextCursor` (today the offset of the next
 * page's first row). Routes only switch to the paged shape when one of the
 * two params is present, so existing web callers keep their full lists.
 */
export const MAX_PAGE_LIMIT = 500
export const DEFAULT_PAGE_LIMIT = 50

export const pageQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .default(DEFAULT_PAGE_LIMIT),
  cursor: z
    .string()
    .regex(/^\d{1,9}$/, 'cursor must come from a previous nextCursor')
    .optional(),
})

export interface PageRequest {
  offset: number
  limit: number
}

/**
 * The page a request asks for, or `null` when it sent neither `limit` nor
 * `cursor` (the legacy unpaged shape).
 */
export function readPageParams(
  searchParams: URLSearchParams
): { ok: true; page: PageRequest | null } | { ok: false; error: z.ZodError } {
  const limit = searchParams.get('limit')
  const cursor = searchParams.get('cursor')
  if (limit === null && cursor === null) return { ok: true, page: null }
  const parsed = pageQuerySchema.safeParse({
    ...(limit !== null ? { limit } : {}),
    ...(cursor !== null ? { cursor } : {}),
  })
  if (!parsed.success) return { ok: false, error: parsed.error }
  return {
    ok: true,
    page: {
      limit: parsed.data.limit,
      offset: parsed.data.cursor ? Number(parsed.data.cursor) : 0,
    },
  }
}

/** `nextCursor` for a page of `shown` rows starting at `offset`. */
export function nextPageCursor(
  page: PageRequest,
  shown: number,
  total: number
): string | null {
  return page.offset + shown < total ? String(page.offset + shown) : null
}
