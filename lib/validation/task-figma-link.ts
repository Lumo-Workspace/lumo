import { z } from 'zod'

export const addFigmaLinkSchema = z.object({
  url: z.string().url(),
})
