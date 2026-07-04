import { z } from 'zod'

/**
 * Body for `POST /api/priorities` — a team member declares the current
 * priority. `statement` is a 1-3 sentence plain-text declaration; a blank
 * statement is rejected with 400 (the append is meaningless without a
 * referent). Priority is append-only, so there is no update/delete schema.
 */
export const declarePrioritySchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, 'Priority statement is required')
    .max(1000),
})

export type DeclarePriorityBody = z.infer<typeof declarePrioritySchema>
