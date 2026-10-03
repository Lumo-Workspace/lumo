/**
 * LUM-910 — the pure "used up" decisions the USED_UP sweep is built on.
 */
import {
  isCrossingEvidenceReleased,
  isDoneTaskKept,
  isOpenTaskKept,
  recentlyDoneSince,
  usedUpIdleCutoff,
  usedUpKeepTaskIds,
} from '@/lib/hook-event/used-up'
import {
  buildUsedUpPrunedPayload,
  isPrunedPayload,
} from '@/lib/hook-event/retention'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-20T00:00:00Z')
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

describe('used-up decisions', () => {
  it('cutoffs: idle 30 days plus 7 grace; DONE look-back covers the audit cap', () => {
    expect(usedUpIdleCutoff(NOW).getTime()).toBe(ago(37).getTime())
    expect(recentlyDoneSince(NOW).getTime()).toBe(ago(30).getTime())
  })

  it('a DONE task is kept for 7 days, or up to 30 while its usage vote is pending', () => {
    expect(
      isDoneTaskKept({ id: 'a', doneAt: ago(6), usageVotePending: false }, NOW)
    ).toBe(true)
    expect(
      isDoneTaskKept({ id: 'a', doneAt: ago(8), usageVotePending: false }, NOW)
    ).toBe(false)
    expect(
      isDoneTaskKept({ id: 'a', doneAt: ago(20), usageVotePending: true }, NOW)
    ).toBe(true)
    expect(
      isDoneTaskKept({ id: 'a', doneAt: ago(31), usageVotePending: true }, NOW)
    ).toBe(false)
  })

  it('an open task is kept until 37 days without activity', () => {
    expect(isOpenTaskKept({ id: 'a', lastActivityAt: ago(36) }, NOW)).toBe(true)
    expect(isOpenTaskKept({ id: 'a', lastActivityAt: ago(38) }, NOW)).toBe(
      false
    )
    expect(isOpenTaskKept({ id: 'a', lastActivityAt: null }, NOW)).toBe(true)
  })

  it('usedUpKeepTaskIds lists only tasks still needed', () => {
    expect(
      usedUpKeepTaskIds({
        openTasks: [
          { id: 'open_active', lastActivityAt: ago(1) },
          { id: 'open_idle', lastActivityAt: ago(40) },
        ],
        recentlyDone: [
          { id: 'done_new', doneAt: ago(2), usageVotePending: false },
          { id: 'done_old', doneAt: ago(9), usageVotePending: false },
        ],
        now: NOW,
      })
    ).toEqual(['open_active', 'done_new'])
  })

  it('crossing evidence is released only when every crossing is ruled for 7 days', () => {
    const ruled = (d: number) => ({
      disposition: 'CONFIRMED',
      dispositionedAt: ago(d),
    })
    const open = { disposition: null, dispositionedAt: null }
    expect(isCrossingEvidenceReleased([ruled(8)], NOW)).toBe(true)
    expect(isCrossingEvidenceReleased([ruled(6)], NOW)).toBe(false)
    expect(isCrossingEvidenceReleased([ruled(8), open], NOW)).toBe(false)
    expect(isCrossingEvidenceReleased([], NOW)).toBe(true)
  })

  it('buildUsedUpPrunedPayload is a pruned marker with the reason and grace', () => {
    const marker = buildUsedUpPrunedPayload(NOW)
    expect(isPrunedPayload(marker)).toBe(true)
    expect(marker._lumo_pruned).toEqual({
      at: NOW.toISOString(),
      reason: 'USED_UP',
      graceDays: 7,
    })
  })
})
