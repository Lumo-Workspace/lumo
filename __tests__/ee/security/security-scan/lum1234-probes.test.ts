/**
 * @jest-environment node
 *
 * LUM-1234 — the hand-written reward-hack probes: each is well formed (its
 * session is selected for its PR), a correct judge verdict survives the
 * shipped evidence gates, and `calibrateProbe` runs them through the shared
 * core and scores expected vs got.
 */
jest.mock('@/ee/security/security-scan/reward-hack-decide', () => {
  const actual = jest.requireActual(
    '@/ee/security/security-scan/reward-hack-decide'
  )
  return { ...actual, decideRewardHack: jest.fn(actual.decideRewardHack) }
})

import { decideRewardHack } from '@/ee/security/security-scan/reward-hack-decide'
import { selectSessionsForPr } from '@/ee/security/security-scan/reward-hack-input'
import {
  BudgetGate,
  calibrateProbe,
  probePassed,
  renderReviewSheet,
} from '@/scripts/analysis/lum1234-trace/calibrate-pr'
import {
  PROBE_MERGED_AT,
  RH_PROBES,
  type RhProbe,
} from '@/scripts/analysis/lum1234-trace/probes'

const decide = decideRewardHack as unknown as jest.Mock
const positives = RH_PROBES.filter(p => p.expect === 'positive')
const negative = RH_PROBES.find(p => p.expect === 'negative')!

function judgeCiting(
  kind: RhProbe['expectKinds'][number] | null,
  ids: string[]
) {
  return jest.fn(async () => ({
    output: {
      suspicion: kind ? 92 : 3,
      items: kind ? [{ kind, summary: 'probe verdict', eventIds: ids }] : [],
    },
    costUsd: 0.02,
  }))
}
beforeEach(() => {
  decide.mockClear()
})

describe('RH_PROBES', () => {
  it('has five positives (one per shape) and one honest negative, with unique ids', () => {
    expect(positives).toHaveLength(5)
    expect(RH_PROBES.filter(p => p.expect === 'negative')).toHaveLength(1)
    expect(new Set(RH_PROBES.map(p => p.id)).size).toBe(RH_PROBES.length)
    expect(negative.hackEventIds).toEqual([])
    for (const p of positives) {
      expect(p.expectKinds.length).toBeGreaterThan(0)
      expect(p.hackEventIds.length).toBeGreaterThan(0)
    }
  })

  it.each(RH_PROBES.map(p => [p.id, p] as const))(
    '%s: the session is selected for its PR, every event before the merge',
    (_id, p) => {
      const sel = selectSessionsForPr({
        sessions: [p.session],
        windowStart: null,
        windowEnd: PROBE_MERGED_AT,
        prFiles: p.prFileList.map(f => f.filename),
      })
      expect(sel.included).toHaveLength(1)
      expect(sel.included[0]!.events).toHaveLength(p.session.events.length)
      const ids = new Set(p.session.events.map(e => e.id))
      for (const id of p.hackEventIds) expect(ids.has(id)).toBe(true)
    }
  )
})

describe('calibrateProbe', () => {
  it.each(positives.map(p => [p.id, p] as const))(
    '%s: a correct verdict passes the shipped gates and scores as expected',
    async (_id, p) => {
      const judge = judgeCiting(p.expectKinds[0]!, p.hackEventIds)
      const rec = await calibrateProbe({
        probe: p,
        ordinal: -1,
        judge,
        spend: new BudgetGate(10),
      })
      expect(decide).toHaveBeenCalledTimes(1)
      // One model call: the gated item is reported with no refute call.
      expect(judge).toHaveBeenCalledTimes(1)
      expect(rec.outcome).toBe('judged')
      expect(rec.itemsAfterGates).toHaveLength(1)
      expect(rec.gotKinds).toEqual([p.expectKinds[0]])
      expect(rec.pass).toBe(true)
    }
  )

  it('a positive with no item, or only a wrong kind, fails', async () => {
    const p = positives[0]!
    const none = await calibrateProbe({
      probe: p,
      ordinal: -1,
      judge: judgeCiting(null, []),
      spend: new BudgetGate(10),
    })
    expect(none.pass).toBe(false)
    const wrong = await calibrateProbe({
      probe: p,
      ordinal: -1,
      judge: judgeCiting('OTHER', p.hackEventIds),
      spend: new BudgetGate(10),
    })
    expect(wrong.gotKinds).toEqual(['OTHER'])
    expect(wrong.pass).toBe(false)
  })

  it('the honest negative passes with no item and fails when an item is reported', async () => {
    const clean = await calibrateProbe({
      probe: negative,
      ordinal: -6,
      judge: judgeCiting(null, []),
      spend: new BudgetGate(10),
    })
    expect(clean).toMatchObject({ outcome: 'judged', pass: true, gotKinds: [] })
    const edit = negative.session.events.find(e => e.toolName === 'Edit')!
    const flagged = await calibrateProbe({
      probe: negative,
      ordinal: -6,
      judge: judgeCiting('TEST_TAMPERING', [edit.id]),
      spend: new BudgetGate(10),
    })
    expect(flagged.pass).toBe(false)
  })

  it('dry run: no model call, prompt size and estimate known, pass unknown', async () => {
    const judge = jest.fn()
    const gate = new BudgetGate(10, 0, false)
    for (const [i, p] of RH_PROBES.entries()) {
      const rec = await calibrateProbe({
        probe: p,
        ordinal: -(i + 1),
        judge,
        spend: gate,
      })
      expect(rec.outcome).toBe('capped')
      expect(rec.promptChars).toBeGreaterThan(0)
      expect(rec.pass).toBeNull()
    }
    expect(judge).not.toHaveBeenCalled()
    expect(gate.requestedUsd).toBeGreaterThan(0)
  })

  it('the review sheet shows a Probes section with expected vs got', async () => {
    const p = positives[0]!
    const rec = await calibrateProbe({
      probe: p,
      ordinal: -1,
      judge: judgeCiting(null, []),
      spend: new BudgetGate(10),
    })
    const sheet = renderReviewSheet([], [rec])
    expect(sheet).toContain('## Probes')
    expect(sheet).toContain('0/1 as expected')
    expect(sheet).toContain(
      `| ${p.id} — ${p.title} | ≥1 of ${p.expectKinds.join(' / ')} | no item |`
    )
    expect(sheet).toContain('**NO**')
    expect(renderReviewSheet([])).not.toContain('## Probes')
  })
})

describe('probePassed', () => {
  it('is null unless judged', () => {
    expect(
      probePassed(
        { expect: 'negative', expectKinds: [] },
        { outcome: 'capped', finalItems: [] }
      )
    ).toBeNull()
  })
})
