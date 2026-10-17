/**
 * LUM-907 PR2: the audit log's query surface — the view shape the API, the
 * settings page and `lumo audit list` share, the filter vocabulary, keyset
 * cursors and date bounds. Pure: no Prisma, no HTTP.
 */
import type { AuditActorType, AuditSource } from '@prisma/client'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'

/** Events per page when the caller does not ask for a size. */
export const AUDIT_PAGE_DEFAULT = 50
/** Largest page a caller may ask for. */
export const AUDIT_PAGE_MAX = 200
/** Most events one CSV export carries; more = truncated (newest first). */
export const AUDIT_EXPORT_MAX_ROWS = 10_000
/** Rows read per round trip while building an export. */
export const AUDIT_EXPORT_BATCH = 1_000

/** One audit event as the API returns it. */
export interface AuditEventView {
  id: string
  createdAt: string
  action: string
  actorType: AuditActorType
  /** Clerk user id (MEMBER), agent Actor id (AGENT), null (SYSTEM). */
  actorId: string | null
  actorMemberId: string | null
  /** Resolved from Clerk at read time; null when unknown. */
  actorName: string | null
  actorEmail: string | null
  source: AuditSource
  targetType: string
  targetId: string | null
  /** LUM-1232: the target's human-readable ref (`LUM-X482` for a boundary
   *  crossing) when one exists; null otherwise — show `targetId` then. */
  targetRef: string | null
  ip: string | null
  userAgent: string | null
  metadata: unknown
}

export interface AuditEventPage {
  events: AuditEventView[]
  /** Pass back as `cursor` for the next (older) page; null = no more. */
  nextCursor: string | null
}

/** The resolved filters the repository understands. */
export interface AuditEventFilters {
  /** Exact action key, or an area (`invite`) matching `invite.*`. */
  action?: string | undefined
  actorType?: AuditActorType | undefined
  actorId?: string | undefined
  /** Inclusive lower bound. */
  since?: Date | undefined
  /** Exclusive upper bound. */
  before?: Date | undefined
  targetType?: string | undefined
  targetId?: string | undefined
}

/** The areas (`member`, `invite`, …) — the part of an action before the dot. */
export const AUDIT_ACTION_AREAS: readonly string[] = [
  ...new Set(AUDIT_ACTIONS.map(a => a.slice(0, a.indexOf('.')))),
]

/** True for an exact action key or an action area. */
export function isAuditActionFilter(value: string): boolean {
  return (
    (AUDIT_ACTIONS as readonly string[]).includes(value) ||
    AUDIT_ACTION_AREAS.includes(value)
  )
}

/** Keyset position: events strictly older than (createdAt, id). */
export interface AuditCursor {
  createdAt: Date
  id: string
}

export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.createdAt.toISOString(), cursor.id]),
    'utf8'
  ).toString('base64url')
}

/** The decoded cursor, or null when it is not one we issued. */
export function decodeAuditCursor(raw: string): AuditCursor | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    )
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [iso, id] = parsed as unknown[]
    if (typeof iso !== 'string' || typeof id !== 'string' || !id) return null
    const createdAt = new Date(iso)
    if (Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const RELATIVE_RE = /^(\d{1,4})d$/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/

/**
 * Parse a `since` / `until` bound: `7d` (that many days before `now`), a
 * date `2026-10-01` (UTC midnight) or an ISO date-time with an offset.
 * `until` is inclusive for the caller, so a date-only `until` covers that
 * whole UTC day and the result is always an EXCLUSIVE upper bound.
 * Returns null when the value is none of those.
 */
export function parseAuditDateBound(
  raw: string,
  kind: 'since' | 'until',
  now: Date
): Date | null {
  const value = raw.trim()
  const rel = value.match(RELATIVE_RE)
  if (rel) return new Date(now.getTime() - Number(rel[1]) * DAY_MS)
  if (DATE_ONLY_RE.test(value)) {
    const day = new Date(`${value}T00:00:00.000Z`)
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value)
      return null
    return kind === 'until' ? new Date(day.getTime() + DAY_MS) : day
  }
  if (DATETIME_RE.test(value)) {
    const at = new Date(value)
    if (Number.isNaN(at.getTime())) return null
    return kind === 'until' ? new Date(at.getTime() + 1) : at
  }
  return null
}
