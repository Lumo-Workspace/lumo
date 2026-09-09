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
