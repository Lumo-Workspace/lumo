/**
 * LUM-907 PR2 — reading the workspace audit log: the OWNER-only list (web
 * settings page, `lumo audit list`) and its bounded CSV export.
 *
 * Isolation: every read is scoped to the caller's own workspace id, which
 * the route takes from the authenticated identity — never from the query.
 * Only OWNERs may read; the role is looked up from the caller's member row
 * so a CLI bearer (whose identity has no role) gets the same gate. A CSV
 * export writes an `audit_log.exported` event (PR3); a page read does not.
 */
import type { AuditActorType } from '@prisma/client'
import { logger } from '@/lib/logger'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  auditEventRepository,
  type AuditEventRow,
} from '@/lib/repositories/audit-event.repository'
import {
  AUDIT_EXPORT_BATCH,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_PAGE_DEFAULT,
  decodeAuditCursor,
  encodeAuditCursor,
  parseAuditDateBound,
  type AuditEventFilters,
  type AuditEventPage,
  type AuditEventView,
} from '@/lib/audit/query'
import { auditEventsToCsv } from '@/lib/audit/csv'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import type { AuditEventQuery } from '@/lib/validation/audit'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/** Who is asking: the member row the identity resolved to. */
export interface AuditViewer {
  workspaceId: string
  memberId: string
  clerkId: string
}

/** The audit log is visible to workspace OWNERs only. */
async function assertOwner(memberId: string): Promise<void> {
  const role = await miscRepository.findMemberRoleById(memberId)
  if (role !== 'OWNER') {
    throw httpError(403, 'Only workspace owners can view the audit log')
  }
}

type ActorFilter = { actorType?: AuditActorType; actorId?: string }

/**
 * Resolve `actor` to a filter: `me`, `system`, an email or display name of
 * a current member, a member id, or a raw auth user id (`user_…` — Clerk
 * ids and, since LUM-1070, Better Auth ids share the prefix; it also finds
 * former members). Unknown or ambiguous refs are 404 / 400.
 */
async function resolveActorFilter(
  viewer: AuditViewer,
  raw: string
): Promise<ActorFilter> {
  const ref = raw.trim()
  const lower = ref.toLowerCase()
  if (lower === 'me') return { actorType: 'MEMBER', actorId: viewer.clerkId }
  if (lower === 'system') return { actorType: 'SYSTEM' }
  if (ref.startsWith('user_')) return { actorId: ref }

  const members = await auditEventRepository.findWorkspaceMembers(
    viewer.workspaceId
  )
  const byId = members.find(m => m.id === ref)
  if (byId) return { actorType: 'MEMBER', actorId: byId.clerkId }

  const profiles = await lookupClerkProfiles(members.map(m => m.clerkId))
  const field = ref.includes('@') ? 'email' : 'name'
  const matches = members.filter(
    m => profiles.get(m.clerkId)?.[field]?.toLowerCase() === lower
  )
  if (matches.length === 0) {
    throw httpError(404, `No workspace member matches actor "${ref}"`)
  }
  if (matches.length > 1) {
    throw httpError(
      400,
      `Actor "${ref}" matches ${matches.length} members — use an email`
    )
  }
  return { actorType: 'MEMBER', actorId: matches[0]!.clerkId }
}

async function toFilters(
  viewer: AuditViewer,
  query: AuditEventQuery,
  now: Date
): Promise<AuditEventFilters> {
  const actor = query.actor ? await resolveActorFilter(viewer, query.actor) : {}
  return {
    action: query.action,
    ...actor,
    since: query.since
      ? (parseAuditDateBound(query.since, 'since', now) ?? undefined)
      : undefined,
    before: query.until
      ? (parseAuditDateBound(query.until, 'until', now) ?? undefined)
      : undefined,
    targetType: query.targetType,
    targetId: query.targetId,
  }
}

/** Rows → views, with member names / emails looked up in Clerk. */
async function toViews(rows: AuditEventRow[]): Promise<AuditEventView[]> {
  const clerkIds = [
    ...new Set(
      rows
        .filter(r => r.actorType === 'MEMBER' && r.actorId)
        .map(r => r.actorId as string)
    ),
  ]
  let profiles = new Map<
    string,
    { name: string | null; email: string | null }
  >()
  try {
    profiles = await lookupClerkProfiles(clerkIds)
  } catch (error) {
    // Names are a convenience; the ids are the record.
    logger.warn('[audit] actor profile lookup failed', {
      error: (error as Error)?.message ?? String(error),
    })
  }
  return rows.map(r => {
    const profile = r.actorId ? profiles.get(r.actorId) : undefined
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      actorType: r.actorType,
      actorId: r.actorId,
      actorMemberId: r.actorMemberId,
      actorName: profile?.name ?? null,
      actorEmail: profile?.email ?? null,
      source: r.source,
      targetType: r.targetType,
      targetId: r.targetId,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata ?? null,
    }
  })
}

/** One page of the caller's workspace audit log, newest first. OWNER only. */
export async function listAuditEvents(
  viewer: AuditViewer,
  query: AuditEventQuery,
  now: Date = new Date()
): Promise<AuditEventPage> {
  await assertOwner(viewer.memberId)
  const cursor = query.cursor ? decodeAuditCursor(query.cursor) : null
  if (query.cursor && !cursor) throw httpError(400, 'Invalid cursor')
  const filters = await toFilters(viewer, query, now)
  const limit = query.limit ?? AUDIT_PAGE_DEFAULT
  const rows = await auditEventRepository.listPage(
    viewer.workspaceId,
    filters,
    cursor,
    limit + 1
  )
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    events: await toViews(page),
    nextCursor:
      rows.length > limit && last
        ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  }
}

/**
 * The filtered audit log as CSV, newest first, at most
 * AUDIT_EXPORT_MAX_ROWS events (`truncated` = more matched). OWNER only.
 * `cursor` / `limit` are ignored: an export always starts at the newest.
 */
export async function exportAuditEventsCsv(
  viewer: AuditViewer,
  query: AuditEventQuery,
  now: Date = new Date(),
  audit?: AuditContext
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  await assertOwner(viewer.memberId)
  const filters = await toFilters(viewer, query, now)
  const rows: AuditEventRow[] = []
  let cursor = null as ReturnType<typeof decodeAuditCursor>
  let truncated = false
  while (rows.length < AUDIT_EXPORT_MAX_ROWS) {
    const want = Math.min(
      AUDIT_EXPORT_BATCH,
      AUDIT_EXPORT_MAX_ROWS - rows.length
    )
    const batch = await auditEventRepository.listPage(
      viewer.workspaceId,
      filters,
      cursor,
      want + 1
    )
    rows.push(...batch.slice(0, want))
    if (batch.length <= want) break
    if (rows.length >= AUDIT_EXPORT_MAX_ROWS) {
      truncated = true
      break
    }
    const last = rows[rows.length - 1]!
    cursor = { createdAt: last.createdAt, id: last.id }
  }
  const csv = auditEventsToCsv(await toViews(rows))
  // LUM-907 PR3: taking the log out of Lumo is itself audited (listing it is
  // not). The filters as given — never the exported rows.
  await recordAuditEvent({
    workspaceId: viewer.workspaceId,
    action: 'audit_log.exported',
    target: { type: 'audit_log', id: null },
    metadata: {
      rowCount: rows.length,
      truncated,
      filters: {
        action: query.action,
        actor: query.actor,
        since: query.since,
        until: query.until,
        targetType: query.targetType,
        targetId: query.targetId,
      },
    },
    context: audit,
  })
  return { csv, rowCount: rows.length, truncated }
}

export const auditQueryService = {
  list: listAuditEvents,
  exportCsv: exportAuditEventsCsv,
}
