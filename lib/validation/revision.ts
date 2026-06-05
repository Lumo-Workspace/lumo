import { z } from 'zod'

export const createManualRevisionSchema = z.object({
  label: z.string().trim().min(1, 'label is required').max(200),
})

export type CreateManualRevisionInput = z.infer<typeof createManualRevisionSchema>
