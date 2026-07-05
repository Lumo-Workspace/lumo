import { z } from 'zod'

/**
 * Payload for `POST /api/initiatives` — creating a team-level Initiative
 * directly (LUM-673), without a converter plan run.
 *
 * `name` is the only required field and must be non-blank (trimmed).
 * `assumptionNote` (赌注旁注 — the bet behind the initiative) is optional and
 * null-collapses when blank.
 */
export const createInitiativeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(2000, 'Name must be at most 2000 characters'),
  assumptionNote: z.string().trim().max(2000).nullable().optional(),
})

export type CreateInitiativeInput = z.infer<typeof createInitiativeSchema>
