import { z } from 'zod'

export const extractTasksSchema = z.object({
  content: z
    .string()
    .min(1, 'Content cannot be empty')
    .max(1_048_576, 'Content exceeds 1MB limit'),
  selector: z.discriminatedUnion('type', [
    z.object({ type: z.literal('marked') }),
    z.object({ type: z.literal('all_unchecked') }),
  ]),
})

export type ExtractTasksInput = z.infer<typeof extractTasksSchema>
