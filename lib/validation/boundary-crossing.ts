import { z } from 'zod'

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/disposition (LUM-435).
 * Strict — a smuggled extra field is a 400, not a silent pass. The note is
 * optional: dispositioning a CONFIRMED crossing with no note must succeed.
 */
export const dispositionBoundaryCrossingSchema = z
  .object({
    crossingId: z.string().min(1),
    disposition: z.enum(['FALSE_POSITIVE', 'CONFIRMED']),
    dispositionNote: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()

export type DispositionBoundaryCrossingInput = z.infer<
  typeof dispositionBoundaryCrossingSchema
>

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/[crossingId]/remediation
 * (LUM-435). The crossing id is a path param; the body carries nothing required.
 */
export const spawnRemediationSchema = z.object({}).strict()
