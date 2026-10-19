import { z } from 'zod'
export const reviewActionSchema = z
  .object({
    action: z.enum(['pause', 'resume', 'incremental', 'full']),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()

/**
 * Body for POST /api/tasks/[id]/security-findings/[findingId]/disposition
 * (LUM-732). Strict — an extra field is a 400. The note is optional.
 *
 * LUM-1128 follow-up: `OPEN` reverts a ruling (the panel's "Reopen") — the
 * route accepts it from a web (Clerk) session only, like a crossing's OPEN
 * revert; the note is ignored for it.
 */
export const dispositionSecurityFindingSchema = z
  .object({
    disposition: z.enum(['FALSE_POSITIVE', 'ACCEPTED_RISK', 'OPEN']),
    note: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()

export type DispositionSecurityFindingInput = z.infer<
  typeof dispositionSecurityFindingSchema
>

/**
 * Body for POST /api/tasks/[id]/security-findings/bulk-disposition
 * (LUM-740). The only bulk operation is "confirm every LLM-suggested false
 * positive on the task" — spelled out in full so the intent is on the wire.
 */
export const bulkDispositionSecurityFindingsSchema = z
  .object({
    disposition: z.literal('FALSE_POSITIVE'),
    scope: z.literal('SUGGESTED'),
  })
  .strict()

export type BulkDispositionSecurityFindingsInput = z.infer<
  typeof bulkDispositionSecurityFindingsSchema
>

/**
 * Query for GET /api/pull-requests/[number]/scans (LUM-788, `lumo pr show`).
 * `number` is the path segment; `repo` narrows a number that exists in
 * several repos; `all` reads every head's scan instead of the latest.
 */
export const pullRequestScanReadoutQuerySchema = z.object({
  number: z.coerce.number().int().positive(),
  repo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be owner/repo')
    .optional(),
  all: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform(v => v === '1' || v === 'true'),
})

/**
 * LUM-1189 — `GET /api/tasks/[id]/security-scans` query. `view=readout`
 * asks for the CLI read-out (a bearer caller always gets it); `all` reads
 * every head's scan per PR instead of the latest.
 */
export const taskSecurityScansQuerySchema = z.object({
  view: z.enum(['panel', 'readout']).optional(),
  all: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform(v => v === '1' || v === 'true'),
})

export type PullRequestScanReadoutQuery = z.infer<
  typeof pullRequestScanReadoutQuerySchema
>

/**
 * Path params of GET /api/tasks/[id]/security-findings/[findingId]/
 * reward-hack-evidence (LUM-1234). Ids only — the finding is looked up and
 * every access check runs in the service.
 */
export const rewardHackEvidenceParamsSchema = z.object({
  id: z.string().trim().min(1).max(64),
  findingId: z.string().trim().min(1).max(64),
})
