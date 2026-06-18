/**
 * @jest-environment node
 *
 * LUM-540 (P4a) — the memory eval harness must expose a retire/error entry count
 * (低 judged-used + clearly-wrong) alongside the existing residual near-dup
 * cluster count, so "近重复簇数 + 错误条目数下降且不反弹" is observable from one run.
 */
import {
  errorEntryCount,
  formatEntropyLedgerLine,
} from '@/scripts/eval/memory/retire-metric'
import type { RetireCandidate } from '@/lib/services/memory/retire.service'

const cands = (...reasons: RetireCandidate['reasons'][]): RetireCandidate[] =>
  reasons.map((r, i) => ({ memoryId: `m${i}`, reasons: r }))

describe('memory eval harness — retire/error entry metric', () => {
  test('reports retired or error entry count alongside near-dup cluster count', () => {
    // The metric counts flagged entries (either signal).
    expect(errorEntryCount([])).toBe(0)
    expect(
      errorEntryCount(
        cands(
          ['low-judged-used'],
          ['contradiction'],
          ['low-judged-used', 'contradiction']
        )
      )
    ).toBe(3)

    // A single harness line carries BOTH halves of the entropy ledger so one
    // run shows dedup (near-dup clusters) and retire (error entries) together.
    const line = formatEntropyLedgerLine({
      nearDupClusters: 2,
      errorEntries: 3,
    })
    expect(line).toMatch(/near-dup clusters: 2/)
    expect(line).toMatch(/(retire|error) entries: 3/)
  })
})
