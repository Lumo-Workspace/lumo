/**
 * LUM-907 PR2: the audit log CSV export. Every cell is quoted (RFC 4180,
 * CRLF rows) and neutralised against spreadsheet formula injection: a cell
 * that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a
 * leading `'` so Excel / Sheets / LibreOffice show it as text instead of
 * evaluating it (OWASP "CSV injection"). Audit cells carry user-controlled
 * text — User-Agents, invitee emails, setting values — so this is not
 * optional.
 */
import type { AuditEventView } from '@/lib/audit/query'

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/

/** Neutralise a formula-looking value and quote it as one CSV cell. */
export function csvCell(value: unknown): string {
  let text: string
  if (value === null || value === undefined) text = ''
  else if (typeof value === 'string') text = value
  else if (typeof value === 'number' || typeof value === 'boolean')
    text = String(value)
  else text = JSON.stringify(value)
  if (FORMULA_PREFIX_RE.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export const AUDIT_CSV_COLUMNS = [
  'created_at',
  'action',
  'actor_type',
  'actor_id',
  'actor_member_id',
  'actor_name',
  'actor_email',
  'source',
  'target_type',
  'target_id',
  'ip',
  'user_agent',
  'metadata',
] as const

/** The whole CSV document: a header row, then one row per event. */
export function auditEventsToCsv(events: readonly AuditEventView[]): string {
  const rows = [AUDIT_CSV_COLUMNS.map(csvCell).join(',')]
  for (const e of events) {
    rows.push(
      [
        e.createdAt,
        e.action,
        e.actorType,
        e.actorId,
        e.actorMemberId,
        e.actorName,
        e.actorEmail,
        e.source,
        e.targetType,
        e.targetId,
        e.ip,
        e.userAgent,
        e.metadata ?? null,
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return rows.join('\r\n') + '\r\n'
}
