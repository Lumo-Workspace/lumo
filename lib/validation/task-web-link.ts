import { z } from 'zod'

export const createWebLinkBodySchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine(u => {
      try {
        const p = new URL(u).protocol
        return p === 'http:' || p === 'https:'
      } catch {
        return false
      }
    }, 'Only http/https URLs are supported'),
  note: z.string().max(500).optional(),
})

export type CreateWebLinkBody = z.infer<typeof createWebLinkBodySchema>
