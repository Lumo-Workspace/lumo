import { z } from 'zod'
import { AUDIT_TARGET_TYPES } from '@/lib/audit/actions'
import {
  AUDIT_PAGE_MAX,
  isAuditActionFilter,
  parseAuditDateBound,
} from '@/lib/audit/query'

const DATE_HINT = 'use 7d, 2026-10-01 or an ISO date-time with an offset'

const bound = (kind: 'since' | 'until') =>
  z
    .string()
    .trim()
    .max(40)
    .refine(
      v => parseAuditDateBound(v, kind, new Date()) !== null,
      `Invalid ${kind} (${DATE_HINT})`
    )

/**
 * LUM-907 PR2: query-string filters shared by GET /api/workspaces/me/
 * audit-events and its CSV export. Empty strings count as absent, so a
 * form that submits every field unchanged still validates.
 */
export const auditEventQuerySchema = z.preprocess(
  raw =>
    raw && typeof raw === 'object'
      ? Object.fromEntries(
          Object.entries(raw as Record<string, unknown>).filter(
            ([, v]) => v !== ''
          )
        )
      : raw,
  z.object({
    action: z
      .string()
      .trim()
      .refine(
        isAuditActionFilter,
        'Unknown action (use an action key such as member.role_changed, or an area such as invite)'
      )
      .optional(),
    actor: z.string().trim().min(1).max(200).optional(),
    since: bound('since').optional(),
    until: bound('until').optional(),
    targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
    targetId: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).optional(),
  })
)

export type AuditEventQuery = z.infer<typeof auditEventQuerySchema>
