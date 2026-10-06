import { z } from 'zod'

/**
 * LUM-1003 — query of `GET /api/cron/backfill-pr-comment-author-association`.
 * Dry run is the DEFAULT: only an explicit `dryRun=0` writes.
 */
export const prCommentAuthorBackfillQuerySchema = z.object({
  dryRun: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform(v => !(v === '0' || v === 'false')),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  maxPrs: z.coerce.number().int().min(1).max(200).optional(),
})

export type PrCommentAuthorBackfillQuery = z.infer<
  typeof prCommentAuthorBackfillQuerySchema
>
