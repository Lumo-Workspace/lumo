import { z } from 'zod'

/**
 * Payload for `POST /api/initiatives` — creating a team-level Initiative
 * (LUM-673).
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

const INITIATIVE_STATUSES = [
  'PROPOSED',
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const

/**
 * Payload for `PATCH /api/initiatives/[ref]` (LUM-821, `lumo initiative
 * update`). Every field optional, at least one required; `null` clears the
 * nullable ones. Dates are instants (the CLI sends local midnight).
 */
export const updateInitiativeSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(2000).optional(),
    description: z.string().max(20000).nullable().optional(),
    status: z.enum(INITIATIVE_STATUSES).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable().optional(),
    startDate: z.string().datetime().nullable().optional(),
    targetDate: z.string().datetime().nullable().optional(),
  })
  .refine(v => Object.keys(v).length > 0, {
    message: 'Provide at least one field to update',
  })

export type UpdateInitiativeInput = z.infer<typeof updateInitiativeSchema>

/** Payload for `POST /api/initiatives/[ref]/updates` — a progress post. */
export const createInitiativeUpdateSchema = z.object({
  body: z.string().trim().min(1, 'Body is required').max(5000),
  health: z.enum(['ON_TRACK', 'AT_RISK', 'OFF_TRACK']).optional(),
})

export type CreateInitiativeUpdateInput = z.infer<
  typeof createInitiativeUpdateSchema
>
