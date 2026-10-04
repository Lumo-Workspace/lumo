/**
 * LUM-907 — the workspace audit log's single write entry point.
 *
 * Transaction strategy: a sensitive service method calls `recordAuditEvent`
 * AFTER its own write has committed. A main operation that throws or rolls
 * back therefore never leaves an audit row behind, and an audit write that
 * fails never blocks or rolls back the main operation — it is logged at
 * error level (`[audit] write failed`) instead. Writing inside the business
 * transaction would give the opposite trade-off (a failed audit insert aborts
 * the Postgres transaction, i.e. blocks the operation), which the brief rules
 * out. The residual gap — operation committed, audit insert failed — is
 * visible in the logs.
 *
 * Privacy: IP and User-Agent are recorded (user ruling 2026-10-04). The IP is
 * validated (anything that is not an IPv4/IPv6 address is dropped); the
 * User-Agent and every string in `metadata` go through the credential
 * registry before they are stored. `metadata` never carries content bodies —
 * callers pass ids, field names and setting values only — and is capped.
 */
import { isIP } from 'node:net'
import type { AuditActorType, AuditSource, Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { redactJsonForStorage } from '@/lib/validation/hook-payload'
import {
  AUDIT_RETENTION_DAYS,
  type AuditAction,
  type AuditTargetType,
} from '@/lib/audit/actions'
import { auditEventRepository } from '@/lib/repositories/audit-event.repository'

export const AUDIT_USER_AGENT_MAX_CHARS = 512
export const AUDIT_IP_MAX_CHARS = 45
export const AUDIT_METADATA_MAX_CHARS = 4096
export const AUDIT_PRUNE_BATCH_SIZE = 5000
export const AUDIT_PRUNE_MAX_BATCHES = 40

const DAY_MS = 24 * 60 * 60 * 1000

export type AuditActor =
  | { type: 'MEMBER'; clerkId?: string | null; memberId?: string | null }
  | { type: 'AGENT'; actorId: string }
  | { type: 'SYSTEM' }

/** Who did it and where the request came from — built by the HTTP layer. */
export interface AuditContext {
  actor: AuditActor
  source: AuditSource
  ip?: string | null
  userAgent?: string | null
}

/** For cron / background callers that act on nobody's behalf. */
export const SYSTEM_AUDIT_CONTEXT: AuditContext = {
  actor: { type: 'SYSTEM' },
  source: 'SYSTEM',
}

export interface RecordAuditEventInput {
  workspaceId: string
  action: AuditAction
  target: { type: AuditTargetType; id?: string | null }
  /** Ids, field names and setting values only — never content bodies. */
  metadata?: Record<string, unknown>
  /** Missing = recorded as a SYSTEM event (and warned about). */
  context?: AuditContext | undefined
}

/** A validated client IP, or null. Takes the first hop of a forwarded list. */
export function normalizeAuditIp(
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  let ip = raw.split(',')[0]!.trim()
  // `[::1]:443` / `[::1]` → `::1`; `1.2.3.4:80` → `1.2.3.4`.
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/)
  if (bracketed) ip = bracketed[1]!
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.split(':')[0]!
  if (ip.length > AUDIT_IP_MAX_CHARS || isIP(ip) === 0) return null
  return ip
}

/** Credential-redacted, control-character-free, truncated User-Agent. */
export function normalizeAuditUserAgent(
  raw: string | null | undefined
): string | null {
  if (!raw) return null
  const clean = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  if (!clean) return null
  const redacted = redactForStorage(clean).text
  return redacted.length > AUDIT_USER_AGENT_MAX_CHARS
    ? redacted.slice(0, AUDIT_USER_AGENT_MAX_CHARS)
    : redacted
}

/** Credential-redacted metadata, replaced by a stub when over the cap. */
export function normalizeAuditMetadata(
  metadata: Record<string, unknown> | undefined
): Prisma.InputJsonValue | undefined {
  if (!metadata || Object.keys(metadata).length === 0) return undefined
  // Drops `undefined` and turns Dates into ISO strings, as JSON would.
  const plain = JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>
  const redacted = redactJsonForStorage(plain).value as Prisma.InputJsonObject
  if (JSON.stringify(redacted).length <= AUDIT_METADATA_MAX_CHARS) {
    return redacted
  }
  return { truncated: true, keys: Object.keys(plain).slice(0, 50) }
}

async function resolveActor(actor: AuditActor): Promise<{
  actorType: AuditActorType
  actorId: string | null
  actorMemberId: string | null
}> {
  if (actor.type === 'SYSTEM') {
    return { actorType: 'SYSTEM', actorId: null, actorMemberId: null }
  }
  if (actor.type === 'AGENT') {
    return { actorType: 'AGENT', actorId: actor.actorId, actorMemberId: null }
  }
  const memberId = actor.memberId ?? null
  const clerkId =
    actor.clerkId ??
    (memberId ? await auditEventRepository.findMemberClerkId(memberId) : null)
  return { actorType: 'MEMBER', actorId: clerkId, actorMemberId: memberId }
}

/**
 * Record one audit event. Never throws: a failure is logged and reported as
 * `false`, so a caller can `await` it after its write without risking the
 * operation it is auditing.
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput
): Promise<boolean> {
  try {
    const context = input.context ?? SYSTEM_AUDIT_CONTEXT
    if (!input.context) {
      logger.warn('[audit] event recorded without a request context', {
        action: input.action,
        workspaceId: input.workspaceId,
      })
    }
    const actor = await resolveActor(context.actor)
    await auditEventRepository.create({
      workspaceId: input.workspaceId,
      ...actor,
      action: input.action,
      targetType: input.target.type,
      targetId: input.target.id ?? null,
      source: context.source,
      ip: normalizeAuditIp(context.ip),
      userAgent: normalizeAuditUserAgent(context.userAgent),
      metadata: normalizeAuditMetadata(input.metadata),
    })
    return true
  } catch (error) {
    logger.error('[audit] write failed', {
      action: input.action,
      workspaceId: input.workspaceId,
      error: (error as Error)?.message ?? String(error),
    })
    return false
  }
}

/**
 * Daily cron: delete events older than AUDIT_RETENTION_DAYS, in batches, up
 * to a per-run budget (`done: false` = the next run continues).
 */
export async function pruneExpiredAuditEvents(
  now: Date = new Date(),
  limits: { batchSize: number; maxBatches: number } = {
    batchSize: AUDIT_PRUNE_BATCH_SIZE,
    maxBatches: AUDIT_PRUNE_MAX_BATCHES,
  }
): Promise<{ deleted: number; done: boolean; cutoff: string }> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS)
  let deleted = 0
  let done = false
  for (let batch = 0; batch < limits.maxBatches; batch++) {
    const n = await auditEventRepository.deleteBatchOlderThan(
      cutoff,
      limits.batchSize
    )
    deleted += n
    if (n < limits.batchSize) {
      done = true
      break
    }
  }
  logger.info('[audit] pruned expired events', { deleted, done })
  return { deleted, done, cutoff: cutoff.toISOString() }
}

export const auditService = {
  record: recordAuditEvent,
  pruneExpired: pruneExpiredAuditEvents,
}
