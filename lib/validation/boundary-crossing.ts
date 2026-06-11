import { z } from 'zod'

/**
 * Body for POST /api/tasks/[id]/boundary-crossings/acknowledge (LUM-426).
 * Strict — a smuggled extra field is a 400, not a silent pass.
 */
export const acknowledgeBoundaryCrossingSchema = z
  .object({
    crossingId: z.string().min(1),
  })
  .strict()

export type AcknowledgeBoundaryCrossingInput = z.infer<
  typeof acknowledgeBoundaryCrossingSchema
>
