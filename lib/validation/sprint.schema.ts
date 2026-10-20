import { z } from 'zod'

export const createSprintSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine(v => v.endDate > v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })

export const updateSprintSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(v => !v.startDate || !v.endDate || v.endDate > v.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })

export const closeSprintSchema = z.object({
  decisions: z.record(
    z.string().min(1),
    z.enum(['moveToNext', 'backToBacklog'])
  ),
})

export const addTaskToSprintSchema = z.object({
  taskId: z.string().min(1),
})

// Cadence config bounds. Duration is restricted to 1/2/3/4 weeks; cooldown
// is either "No cooldown" (0) or "1 week" (7) — keeping both in 7-day
// increments lets startDate stay locked on `startWeekday` sprint after
// sprint. Weekday is 0-6, autoCreate 0-4. Unknown/out-of-range values
// return 400 at the API.
export const SPRINT_DURATION_DAYS = [7, 14, 21, 28] as const
export const SPRINT_COOLDOWN_DAYS = [0, 7] as const

export const cadenceSchema = z.object({
  enabled: z.boolean(),
  durationDays: z
    .number()
    .int()
    .refine(
      (v): v is (typeof SPRINT_DURATION_DAYS)[number] =>
        (SPRINT_DURATION_DAYS as readonly number[]).includes(v),
      { message: 'durationDays must be one of 7, 14, 21, 28' }
    )
    .optional(),
  cooldownDays: z
    .number()
    .int()
    .refine(
      (v): v is (typeof SPRINT_COOLDOWN_DAYS)[number] =>
        (SPRINT_COOLDOWN_DAYS as readonly number[]).includes(v),
      { message: 'cooldownDays must be 0 or 7' }
    )
    .optional(),
  startWeekday: z.number().int().min(0).max(6).optional(),
  autoCreate: z.number().int().min(0).max(4).optional(),
  autoAddCompleted: z.boolean().optional(),
})

export type CreateSprintInput = z.infer<typeof createSprintSchema>
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>
export type CloseSprintInput = z.infer<typeof closeSprintSchema>
export type AddTaskToSprintInput = z.infer<typeof addTaskToSprintSchema>
export type CadenceInput = z.infer<typeof cadenceSchema>
export type SprintCloseDecisions = z.infer<
  typeof closeSprintSchema
>['decisions']

/** LUM-1278: `GET /api/sprints/[sprintId]/attention?scope=team|mine`. */
export const sprintAttentionQuerySchema = z.object({
  scope: z.enum(['team', 'mine']).default('team'),
})
