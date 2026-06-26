import { z } from 'zod'
import { MANUAL_OUTCOME_KINDS } from '@/lib/services/outcome-well.service'

/**
 * Body for `POST /api/tasks/[id]/outcome-signals` — a human records a post-hoc
 * rejection of the delivery. `note` is REQUIRED: the well is a falsifier, and a
 * rejection with no observed referent is just an assertion. `occurredAt` is the
 * real-world time the event happened (optional; defaults to detection time).
 */
export const recordOutcomeSignalSchema = z.object({
  kind: z.enum(MANUAL_OUTCOME_KINDS),
  note: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime().optional(),
})

export type RecordOutcomeSignalBody = z.infer<typeof recordOutcomeSignalSchema>
