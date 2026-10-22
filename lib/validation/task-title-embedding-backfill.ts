import { z } from 'zod'

/** LUM-1286: `?dryRun=1` only counts; the scheduled call (no query) writes. */
export const taskTitleEmbeddingBackfillQuerySchema = z.object({
  dryRun: z
    .enum(['0', '1'])
    .optional()
    .transform(v => v === '1'),
})
