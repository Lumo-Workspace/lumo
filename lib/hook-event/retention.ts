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

export interface PrunedPayloadMarker {
  /** ISO time the payload was cleared. */
  at: string
  reason: typeof PRUNE_REASON_RETENTION
  retentionDays: HookEventRetentionDays
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

/** True when a stored payload was cleared by the retention sweep. */
export function isPrunedPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return false
  const marker = (payload as Record<string, unknown>)[PRUNED_PAYLOAD_KEY]
  return !!marker && typeof marker === 'object'
}
