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
 * True when moving from `from` to `to` lets the next daily sweep clear raw
 * events that the current setting keeps — the settings row warns first.
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
