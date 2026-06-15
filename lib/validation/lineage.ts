import { z } from 'zod'
import { LineageFragmentType } from '@prisma/client'

/** Body for POST /api/lineage/pulls — reported by the CLI when an agent pulls a fragment body on demand (LUM-500). */
export const recordPullBodySchema = z.object({
  sessionId: z.string().min(1),
  fragmentType: z.nativeEnum(LineageFragmentType),
  fragmentId: z.string().min(1),
})
