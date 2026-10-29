import { z } from 'zod'

// ─── Codeup (LUM-1315) ─────────────────────────────────────────────────────

export const connectCodeupSchema = z.object({
  organizationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid Codeup organization ID'),
  accessToken: z.string().trim().min(8).max(512),
})

export type ConnectCodeupInput = z.infer<typeof connectCodeupSchema>

export const updateCodeupRepositoriesSchema = z.object({
  repositoryIds: z.array(z.number().int().positive()).max(200),
})

export type UpdateCodeupRepositoriesInput = z.infer<
  typeof updateCodeupRepositoriesSchema
>
