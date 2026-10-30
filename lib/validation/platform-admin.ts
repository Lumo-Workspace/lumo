import { z } from 'zod'

/** LUM-1344: query schemas for the platform admin read API. */

const limitSchema = z.coerce.number().int().min(1).max(100).default(50)

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform(v => (v ? v : undefined))

export const adminListQuerySchema = z.object({
  q: optionalText,
  cursor: optionalText,
  limit: limitSchema,
})

export const adminUsageQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .optional(),
})

export const adminAuditQuerySchema = z.object({
  adminUserId: optionalText,
  targetType: z
    .enum(['workspace', 'user', 'waitlist', 'usage', 'audit'])
    .optional(),
  targetId: optionalText,
  cursor: optionalText,
  limit: limitSchema,
})

export type AdminListQuery = z.infer<typeof adminListQuerySchema>
export type AdminUsageQuery = z.infer<typeof adminUsageQuerySchema>
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>
