/**
 * LUM-1302 — the pruned marker's reason, stored beside the encrypted payload.
 */
import {
  buildPrunedPayload,
  buildUsedUpPrunedPayload,
  buildUserDeletedPayload,
  prunedReasonOf,
  PRUNE_REASON_RETENTION,
  PRUNE_REASON_USED_UP,
  PRUNE_REASON_USER_DELETED,
} from '@/lib/hook-event/retention'

describe('prunedReasonOf', () => {
  const at = new Date('2026-10-23T00:00:00Z')

  it('reads the reason of each marker', () => {
    expect(prunedReasonOf(buildPrunedPayload(at, 30))).toBe(
      PRUNE_REASON_RETENTION
    )
    expect(prunedReasonOf(buildUsedUpPrunedPayload(at))).toBe(
      PRUNE_REASON_USED_UP
    )
    expect(prunedReasonOf(buildUserDeletedPayload(at, 'm1'))).toBe(
      PRUNE_REASON_USER_DELETED
    )
  })

  it('is null for a whole payload or a malformed marker', () => {
    expect(prunedReasonOf({ tool_name: 'Bash' })).toBeNull()
    expect(prunedReasonOf(null)).toBeNull()
    expect(prunedReasonOf({ _lumo_pruned: { reason: 7 } })).toBeNull()
  })
})
