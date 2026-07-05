import { z } from 'zod'

/**
 * Payload for `POST /api/ideas` — capturing a team-level idea into the pool.
 *
 * `statement` is the only required field and must be non-blank (trimmed).
 * The `source*` fields are provenance captured opportunistically by the CLI
 * (`lumo idea`): the origin context, the Claude Code session id, and the task
 * the session was bound to at capture time. All are soft pointers (no FK) and
 * optional — capture must still succeed with none of them present.
 */
export const captureIdeaSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, 'Idea statement is required')
    .max(2000, 'Idea statement must be at most 2000 characters'),
  sourceContext: z.string().trim().max(2000).nullable().optional(),
  sourceSessionId: z.string().trim().max(200).nullable().optional(),
  sourceTaskId: z.string().trim().max(200).nullable().optional(),
})

export type CaptureIdeaInput = z.infer<typeof captureIdeaSchema>

/**
 * Payload for `PATCH /api/ideas/[id]` — editing a captured idea from the detail
 * slide-over (LUM-683). Only the `statement` is editable here: it carries the
 * same non-blank/≤2000 rule as capture. The 4-state status lifecycle and its
 * mutation belong to the sibling task (679); this task edits text only.
 */
export const updateIdeaSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(1, 'Idea statement is required')
    .max(2000, 'Idea statement must be at most 2000 characters'),
})

export type UpdateIdeaInput = z.infer<typeof updateIdeaSchema>
