import { z } from 'zod'
import { MemoryCategory } from '@prisma/client'

/**
 * Body for POST /api/{projects,tasks}/[id]/memories. `content` is left as
 * unknown here because its required shape depends on `category`; the route
 * validates it a second time with parseMemoryContent(category, content).
 */
export const createMemoryBodySchema = z.object({
  category: z.nativeEnum(MemoryCategory),
  content: z.unknown().refine(v => v !== undefined, { message: 'Required' }),
})

/**
 * Body for PATCH /api/memories/[id]. At least one of content / scope. `scope`
 * may only be 'PROJECT' (promote); demote is out of scope.
 */
export const patchMemoryBodySchema = z
  .object({
    content: z.unknown().optional(),
    scope: z.literal('PROJECT').optional(),
  })
  .refine(b => b.content !== undefined || b.scope !== undefined, {
    message: 'At least one of content or scope must be provided',
  })

export type CreateMemoryBody = z.infer<typeof createMemoryBodySchema>
export type PatchMemoryBody = z.infer<typeof patchMemoryBodySchema>
