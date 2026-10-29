import { z } from 'zod'

/** LUM-1334: PATCH /api/workspaces/me/done-requirements — at least one switch. */
export const updateDoneRequirementsSchema = z
  .object({
    testCase: z.boolean().optional(),
    review: z.boolean().optional(),
  })
  .strict()
  .refine(v => v.testCase !== undefined || v.review !== undefined, {
    message: 'Send testCase and/or review',
  })

export type DoneRequirementsUpdate = z.infer<
  typeof updateDoneRequirementsSchema
>
