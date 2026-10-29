/**
 * LUM-859 — raw hook-event retention: the allowed tiers and the pruned-payload
 * marker. Pure (no Prisma, no I/O) so the sweep, the settings UI and the
 * timeline renderers share one definition.
 */

/** OWNER-selectable retention tiers, in days. `null` (the default) = keep forever. */
export const HOOK_EVENT_RETENTION_DAYS = [30, 90, 180, 365] as const

export type HookEventRetentionDays = (typeof HOOK_EVENT_RETENTION_DAYS)[number]

export function isHookEventRetentionDays(
  value: unknown
): value is HookEventRetentionDays {
  return (HOOK_EVENT_RETENTION_DAYS as readonly unknown[]).includes(value)
}

/** Reserved payload key the sweep writes; the hook boundary drops a client-supplied one. */
export const PRUNED_PAYLOAD_KEY = '_lumo_pruned'

export const PRUNE_REASON_RETENTION = 'RETENTION_POLICY'

/** LUM-910: the payload was dropped 7 days after its work was used up. */
export const PRUNE_REASON_USED_UP = 'USED_UP'

/**
 * LUM-944: a member (or the workspace OWNER) deleted the session's raw record
 * by hand. The marker names who did it — it is the audit record of the delete.
 */
export const PRUNE_REASON_USER_DELETED = 'USER_DELETED'

export type PrunedPayloadMarker =
  | {
      /** ISO time the payload was cleared. */
      at: string
      reason: typeof PRUNE_REASON_RETENTION
      retentionDays: HookEventRetentionDays
    }
  | {
      at: string
      reason: typeof PRUNE_REASON_USED_UP
      graceDays: number
    }
  | {
      at: string
      reason: typeof PRUNE_REASON_USER_DELETED
      /** WorkspaceMember id of who deleted it. */
      by: string
    }

/** The whole payload an expired event is left with: the marker and nothing else. */
export function buildPrunedPayload(
  at: Date,
  retentionDays: HookEventRetentionDays
): { [PRUNED_PAYLOAD_KEY]: PrunedPayloadMarker } {
  return {
    [PRUNED_PAYLOAD_KEY]: {
      at: at.toISOString(),
      reason: PRUNE_REASON_RETENTION,
      retentionDays,
    },
  }
}

/** LUM-910: the marker a used-up event is left with. */
export function buildUsedUpPrunedPayload(at: Date): {
  [PRUNED_PAYLOAD_KEY]: PrunedPayloadMarker
} {
  return {
    [PRUNED_PAYLOAD_KEY]: {
      at: at.toISOString(),
      reason: PRUNE_REASON_USED_UP,
      graceDays: USED_UP_GRACE_DAYS,
    },
  }
}

/** LUM-944: the marker an event is left with after its session's raw record was deleted. */
export function buildUserDeletedPayload(
  at: Date,
  byWorkspaceMemberId: string
): { [PRUNED_PAYLOAD_KEY]: PrunedPayloadMarker } {
  return {
    [PRUNED_PAYLOAD_KEY]: {
      at: at.toISOString(),
      reason: PRUNE_REASON_USER_DELETED,
      by: byWorkspaceMemberId,
    },
  }
}

// ── LUM-933 / LUM-910: session record mode ──────────────────────────────────

/** Mirrors the Prisma `HookEventRetentionMode` enum (kept here so the client bundle needs no Prisma import). */
export const HOOK_EVENT_RETENTION_MODES = ['RETAIN', 'USED_UP'] as const

export type HookEventRetentionMode = (typeof HOOK_EVENT_RETENTION_MODES)[number]

export function isHookEventRetentionMode(
  value: unknown
): value is HookEventRetentionMode {
  return (HOOK_EVENT_RETENTION_MODES as readonly unknown[]).includes(value)
}

/**
 * Code is stripped from the stored payload on ingest only in USED_UP mode
 * (LUM-855 rules). RETAIN keeps it whole; credentials are redacted in every
 * mode, before this decision is ever made.
 */
export function shouldStripCodeOnIngest(mode: HookEventRetentionMode): boolean {
  return mode === 'USED_UP'
}

/** LUM-910: days the raw payload is kept once its work is used up. */
export const USED_UP_GRACE_DAYS = 7

/** LUM-910: a task (or taskless session) with no hook event for this long is used up. */
export const USED_UP_IDLE_DAYS = 30

/**
 * LUM-910: a DONE task waits for its fragment-usage audit before it counts as
 * used up — but never longer than this after DONE: the automatic judge leaves
 * edges it cannot decide unvoted forever, which would keep the raw text forever.
 */
export const USED_UP_AUDIT_WAIT_CAP_DAYS = 30

/** The single settings choice the session-record row offers. */
export type SessionRecordChoice = 'forever' | HookEventRetentionDays | 'used_up'

export const SESSION_RECORD_CHOICES: readonly SessionRecordChoice[] = [
  'forever',
  ...HOOK_EVENT_RETENTION_DAYS,
  'used_up',
]

export interface SessionRecordSetting {
  mode: HookEventRetentionMode
  /** null = forever (RETAIN) or not applicable (USED_UP). */
  days: HookEventRetentionDays | null
}

/** Settings choice → stored columns. */
export function sessionRecordSettingFor(
  choice: SessionRecordChoice
): SessionRecordSetting {
  if (choice === 'used_up') return { mode: 'USED_UP', days: null }
  if (choice === 'forever') return { mode: 'RETAIN', days: null }
  return { mode: 'RETAIN', days: choice }
}

/** Stored columns → settings choice. Unknown values read as the default (forever). */
export function sessionRecordChoiceOf(
  mode: unknown,
  days: unknown
): SessionRecordChoice {
  if (mode === 'USED_UP') return 'used_up'
  return isHookEventRetentionDays(days) ? days : 'forever'
}

/**
 * True when moving from `from` to `to` makes the setting stricter: it could
 * clear raw events the current setting keeps. A stricter setting only
 * governs events stored afterwards (see nextSessionRecordCutoff) and the
 * settings row says so before saving.
 */
export function sessionRecordChoiceShortens(
  from: SessionRecordChoice,
  to: SessionRecordChoice
): boolean {
  if (from === to || to === 'forever') return false
  // Lengthening a day tier never clears more than today's setting does.
  if (typeof from === 'number' && typeof to === 'number') return to < from
  return true
}

/** True when a stored payload was cleared by the retention sweep. */
export function isPrunedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return false
  const marker = (payload as Record<string, unknown>)[PRUNED_PAYLOAD_KEY]
  return !!marker && typeof marker === 'object'
}

/**
 * LUM-1302: the `reason` of a pruned-payload marker (stored beside the
 * payload as `HookEvent.payloadPrunedReason`); null for any other payload.
 */
export function prunedReasonOf(payload: unknown): string | null {
  if (!isPrunedPayload(payload)) return null
  const reason = (payload as Record<string, Record<string, unknown>>)[
    PRUNED_PAYLOAD_KEY
  ]!.reason
  return typeof reason === 'string' ? reason : null
}

/** LUM-944: true when the payload was cleared by a member's delete, not by a sweep. */
export function isUserDeletedPayload(payload: unknown): boolean {
  if (!isPrunedPayload(payload)) return false
  const marker = (payload as Record<string, Record<string, unknown>>)[
    PRUNED_PAYLOAD_KEY
  ]
  return marker?.reason === PRUNE_REASON_USER_DELETED
}

// ── LUM-933: a setting change only governs data stored afterwards ──────────

/**
 * Which events the current session record setting governs. Events created at
 * or after `since` follow the current setting; older ones follow
 * `legacyDays` (a RETAIN day tier, LUM-859 rules) or, when it is null, are
 * never pruned. `since` null = no cutoff: the current setting governs all.
 */
export interface SessionRecordCutoff {
  since: Date | null
  legacyDays: number | null
}

/** The day tier a choice prunes by; null when it promises "until used up" or forever. */
function legacyDaysOf(choice: SessionRecordChoice): number | null {
  return typeof choice === 'number' ? choice : null
}

/**
 * The longer of two promises: null (never pruned) wins, otherwise the larger
 * day tier. Used-up is not comparable with a day tier (an open task's events
 * are kept indefinitely), so it is folded in as "never" — the safe side.
 */
function moreLenient(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return Math.max(a, b)
}

/**
 * The cutoff after the OWNER moves the session record setting from `from`
 * to `to` at `now`. Guarantees no event is ever pruned earlier than the
 * setting it was stored under promised:
 *  - stricter (forever → N days / used-up, N → smaller N, used-up ↔ N):
 *    `since` moves to `now`; everything stored before keeps the most
 *    lenient promise it was ever under (`legacyDays`). Several tightenings
 *    in a row merge into one legacy segment — it may keep data longer than
 *    the intermediate setting promised, never shorter.
 *  - looser: `since` stays; the legacy segment only ever gets more lenient.
 *  - back to forever: no cutoff at all — nothing is pruned any more.
 */
export function nextSessionRecordCutoff(input: {
  from: SessionRecordChoice
  to: SessionRecordChoice
  current: SessionRecordCutoff
  now: Date
}): SessionRecordCutoff {
  const { from, to, current, now } = input
  if (from === to) return current
  if (to === 'forever') return { since: null, legacyDays: null }
  if (sessionRecordChoiceShortens(from, to)) {
    const legacyDays = current.since
      ? moreLenient(current.legacyDays, legacyDaysOf(from))
      : legacyDaysOf(from)
    return { since: now, legacyDays }
  }
  if (!current.since) return current
  return {
    since: current.since,
    legacyDays: moreLenient(current.legacyDays, legacyDaysOf(to)),
  }
}
