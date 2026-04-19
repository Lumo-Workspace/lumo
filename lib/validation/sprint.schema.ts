import { z } from 'zod'

export const createSprintSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(v => !v.startDate || !v.endDate || v.endDate > v.startDate, {
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

export const cadenceSchema = z.object({
  cadenceDays: z.number().int().min(1).max(90).nullable().optional(),
  autoPrepare: z.boolean().optional(),
})

export type CreateSprintInput = z.infer<typeof createSprintSchema>
export type UpdateSprintInput = z.infer<typeof updateSprintSchema>
export type CloseSprintInput = z.infer<typeof closeSprintSchema>
export type AddTaskToSprintInput = z.infer<typeof addTaskToSprintSchema>
export type CadenceInput = z.infer<typeof cadenceSchema>
export type SprintCloseDecisions = z.infer<
  typeof closeSprintSchema
>['decisions']
