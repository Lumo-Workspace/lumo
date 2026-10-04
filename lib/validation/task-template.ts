import { z } from 'zod'

/** LUM-970: a template key — lowercase slug, what `--template <key>` takes. */
export const taskTemplateKeySchema = z
  .string()
  .trim()
  .min(1, 'Key is required')
  .max(40, 'Key must be at most 40 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Key must be lowercase letters, digits and single hyphens (e.g. bug-report)'
  )

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name must be at most 80 characters')

/** Markdown body. Bounded well under the description cap — it is a skeleton. */
const contentSchema = z
  .string()
  .max(20_000, 'Template must be at most 20,000 characters')
  .refine(v => v.trim().length > 0, 'Template content is required')

export const createTaskTemplateSchema = z.object({
  key: taskTemplateKeySchema,
  name: nameSchema,
  content: contentSchema,
})

export const updateTaskTemplateSchema = z
  .object({
    key: taskTemplateKeySchema.optional(),
    name: nameSchema.optional(),
    content: contentSchema.optional(),
  })
  .refine(v => Object.keys(v).length > 0, 'Provide at least one field')

/** `lumo task decide <id> "<text>"` body. */
export const taskDecisionSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Decision text is required')
    .max(2_000, 'Decision must be at most 2,000 characters'),
})

export type CreateTaskTemplateInput = z.infer<typeof createTaskTemplateSchema>
export type UpdateTaskTemplateInput = z.infer<typeof updateTaskTemplateSchema>
