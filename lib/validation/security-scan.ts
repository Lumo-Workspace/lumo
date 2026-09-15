import { z } from 'zod'

/**
 * Body for POST /api/tasks/[id]/security-findings/[findingId]/disposition
 * (LUM-732). Strict — an extra field is a 400. The note is optional.
 */
export const dispositionSecurityFindingSchema = z
  .object({
    disposition: z.enum(['FALSE_POSITIVE', 'ACCEPTED_RISK']),
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
 * LUM-750 — the CLI disposition handshake for security findings, isomorphic
 * to the LUM-769 boundary-crossing schemas.
 *
 * Body for POST /api/tasks/[id]/security-findings/[findingId]/disposition/receipt
 * — the read step. Names the ruling the envelope is shown for; `acknowledge`
 * carries the stage-1 receipt on the `--confirm-read` step. Nothing is written.
 */
export const findingReadReceiptRequestSchema = z
  .object({
    disposition: z.enum(['FALSE_POSITIVE', 'ACCEPTED_RISK']),
    acknowledge: z.string().min(1).max(512).optional(),
  })
  .strict()

/**
 * Body for POST /api/tasks/[id]/security-findings/[findingId]/disposition/cli
 * (LUM-750) — the bearer-only write. Strict: only the two clearing values, and
 * the STAGE-2 receipt is required (missing = 400 before any read; a stage-1
 * token = 409 "confirm read first").
 */
export const cliDispositionSecurityFindingSchema = z
  .object({
    disposition: z.enum(['FALSE_POSITIVE', 'ACCEPTED_RISK']),
    note: z.string().trim().min(1).max(2000).optional(),
    receipt: z.string().min(1).max(512),
  })
  .strict()

export type CliDispositionSecurityFindingInput = z.infer<
  typeof cliDispositionSecurityFindingSchema
>

/**
 * Body for POST /api/tasks/[id]/security-findings/bulk-disposition/receipt
 * (LUM-750) — the read step of the bulk (`--all-suggested-fp`) handshake. The
 * ruling is fixed (FALSE_POSITIVE over the suggested rows), so only the
 * optional acknowledgement travels.
 */
export const bulkFindingReadReceiptRequestSchema = z
  .object({
    acknowledge: z.string().min(1).max(512).optional(),
  })
  .strict()

/**
 * Body for POST /api/tasks/[id]/security-findings/bulk-disposition/cli
 * (LUM-750) — the bearer-only bulk write: the same spelled-out intent as the
 * web bulk route plus the stage-2 receipt bound to the suggested set.
 */
export const cliBulkDispositionSecurityFindingsSchema = z
  .object({
    disposition: z.literal('FALSE_POSITIVE'),
    scope: z.literal('SUGGESTED'),
    receipt: z.string().min(1).max(512),
  })
  .strict()
