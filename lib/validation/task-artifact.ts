import { z } from 'zod'

export const createArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    content: z.string().min(1).max(1_000_000),
    source: z.string().trim().min(1).max(64),
  })
  .strict()

export type CreateArtifactBody = z.infer<typeof createArtifactBodySchema>

/**
 * Patch body for editing an artifact's metadata. Content is intentionally
 * immutable here — to change the body, remove and re-add the artifact.
 * At least one field must be present.
 */
export const updateArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    source: z.string().trim().min(1).max(64),
  })
  .partial()
  .strict()
  .refine(obj => Object.keys(obj).length > 0, {
    message: 'At least one field (kind, title, or source) must be provided',
  })

export type UpdateArtifactBody = z.infer<typeof updateArtifactBodySchema>
