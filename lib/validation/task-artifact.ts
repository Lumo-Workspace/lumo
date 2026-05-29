import { z } from 'zod'

export const createArtifactBodySchema = z
  .object({
    kind: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(256),
    content: z.string().min(1).max(1_000_000),
    source: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

export type CreateArtifactBody = z.infer<typeof createArtifactBodySchema>
