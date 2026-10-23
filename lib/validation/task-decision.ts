import { z } from 'zod'

/** LUM-1303: a decision's text — inline Markdown, one line. */
const textSchema = z
  .string()
  .trim()
  .min(1, 'Decision text is required')
  .max(2_000, 'Decision must be at most 2,000 characters')

/** The optional "why"; empty clears it. */
const rationaleSchema = z
  .string()
  .trim()
  .max(4_000, 'Rationale must be at most 4,000 characters')
  .nullable()

/** POST body: web form and `lumo task decide <id> "<text>" [--why …]`. */
export const createTaskDecisionSchema = z.object({
  text: textSchema,
  rationale: rationaleSchema.optional(),
})

export const updateTaskDecisionSchema = z
  .object({
    text: textSchema.optional(),
    rationale: rationaleSchema.optional(),
  })
  .refine(v => Object.keys(v).length > 0, 'Provide at least one field')

export type CreateTaskDecisionInput = z.infer<typeof createTaskDecisionSchema>
export type UpdateTaskDecisionInput = z.infer<typeof updateTaskDecisionSchema>
