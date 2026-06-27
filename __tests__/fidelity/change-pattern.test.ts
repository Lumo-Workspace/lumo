/**
 * LUM-610 (fidelity axis · second block): mechanical change-pattern read-out.
 *
 * A pure analysis over the LUM-609 delivery snapshot + the CRITERION_CHANGED
 * audit trail. For each delivery it discloses two compositions and NOTHING
 * else (no single score, no direction verdict):
 *
 *  (1) grounding composition — run effectiveReferentKind over the FROZEN
 *      contract: grounded (EXTERNAL_FACT) / self-confirming
 *      (AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION) / inconclusive
 *      (PENDING_OUTCOME + UNCLASSIFIED), plus the full effective-kind tally.
 *  (2) independence signal — criteria in the delivered contract that were
 *      ADDED/UPDATED at round>0 (after work started) are backward-inference
 *      suspects; round-0 (initial-draft) criteria are clean.
 *
 * These tests pin the pure core — no DB, no LLM.
 */
import {
  groundingComposition,
  independenceSignal,
  buildFidelityChangePatternReport,
  type SnapshotCriterionShape,
  type CriterionChange,
  type DeliverySnapshotInput,
} from '@/lib/fidelity/change-pattern'

function crit(
  over: Partial<SnapshotCriterionShape> & { id: string }
): SnapshotCriterionShape {
  return {
    statement: 's',
    verifierType: 'MACHINE',
    checkpointer: null,
    referentKind: null,
    evidenceRequired: false,
    ...over,
  }
}

describe('grounding composition', () => {
  it('grounding composition buckets a frozen contract by effective referent kind', () => {
    const criteria: SnapshotCriterionShape[] = [
      // declared EXTERNAL_FACT + a checkpointer that truly grounds external
      // (git, consumed) → stays EXTERNAL_FACT → grounded
      crit({
        id: 'a',
        referentKind: 'EXTERNAL_FACT',
        checkpointer: 'git diff --quiet origin/main -- prisma/',
      }),
      // declared EXTERNAL_FACT but the checkpointer is a jest run → the
      // LUM-605 downgrade → UNVERIFIED_ASSERTION → self-confirming
      crit({
        id: 'b',
        referentKind: 'EXTERNAL_FACT',
        checkpointer: 'npx jest foo.test.ts',
      }),
      // honest AGENT_CONSTRUCTED_STATE → self-confirming
      crit({
        id: 'c',
        referentKind: 'AGENT_CONSTRUCTED_STATE',
        checkpointer: 'npx jest bar.test.ts',
      }),
      // PENDING_OUTCOME (HUMAN) → inconclusive
      crit({
        id: 'd',
        verifierType: 'HUMAN',
        referentKind: 'PENDING_OUTCOME',
        checkpointer: null,
      }),
      // legacy null referentKind → UNCLASSIFIED → inconclusive
      crit({ id: 'e', referentKind: null }),
    ]

    const g = groundingComposition(criteria)

    expect(g.grounded).toBe(1) // a
    expect(g.selfConfirming).toBe(2) // b (downgraded) + c
    expect(g.inconclusive).toBe(2) // d + e
    expect(g.byEffectiveKind).toEqual({
      EXTERNAL_FACT: 1,
      AGENT_CONSTRUCTED_STATE: 1,
      UNVERIFIED_ASSERTION: 1,
      PENDING_OUTCOME: 1,
      UNCLASSIFIED: 1,
    })
    // the three rolled-up buckets partition the contract — nothing dropped
    expect(g.grounded + g.selfConfirming + g.inconclusive).toBe(criteria.length)
  })

  it('an empty contract grounds to all-zero, not a divide-by-zero', () => {
    const g = groundingComposition([])
    expect(g.grounded).toBe(0)
    expect(g.selfConfirming).toBe(0)
    expect(g.inconclusive).toBe(0)
  })
})

describe('independence signal', () => {
  const delivery: DeliverySnapshotInput = {
    snapshotId: 'snap1',
    frozenAt: new Date('2026-06-20T12:00:00Z'),
    trigger: 'IN_REVIEW_ENTRY',
    sessionId: 'sess1',
    criteria: [crit({ id: 'a' }), crit({ id: 'b' }), crit({ id: 'c' })],
  }

  it('independence flags post-start added or updated criteria as backward-inference suspects', () => {
    const changes: CriterionChange[] = [
      // a: added at the initial draft (round 0) → independent, NOT a suspect
      {
        op: 'ADDED',
        criterionId: 'a',
        round: 0,
        causeTag: null,
        at: new Date('2026-06-19T00:00:00Z'),
      },
      // b: added after work started (round 2) → suspect
      {
        op: 'ADDED',
        criterionId: 'b',
        round: 2,
        causeTag: 'SCOPE_CHANGE',
        at: new Date('2026-06-20T09:00:00Z'),
      },
      // c: updated after work started (round 1) → suspect
      {
        op: 'UPDATED',
        criterionId: 'c',
        round: 1,
        causeTag: null,
        at: new Date('2026-06-20T08:00:00Z'),
      },
    ]

    const sig = independenceSignal(delivery, changes)

    expect(sig.total).toBe(3)
    expect(sig.postStartChanges).toBe(2)
    expect(sig.suspects.map(s => s.criterionId).sort()).toEqual(['b', 'c'])
    // mechanical only: op + round + causeTag surfaced, no direction verdict
    const b = sig.suspects.find(s => s.criterionId === 'b')!
    expect(b.op).toBe('ADDED')
    expect(b.round).toBe(2)
    expect(b.causeTag).toBe('SCOPE_CHANGE')
    expect(sig).not.toHaveProperty('verdict')
    expect(sig).not.toHaveProperty('score')
  })

  it('ignores DELETED ops, changes to criteria not in the delivered contract, and changes recorded after the freeze', () => {
    const changes: CriterionChange[] = [
      // DELETED is not an inference-suspect op
      {
        op: 'DELETED',
        criterionId: 'a',
        round: 3,
        causeTag: null,
        at: new Date('2026-06-20T09:00:00Z'),
      },
      // 'z' is not in this delivered contract → ignored
      {
        op: 'UPDATED',
        criterionId: 'z',
        round: 2,
        causeTag: null,
        at: new Date('2026-06-20T09:00:00Z'),
      },
      // 'b' changed AFTER this delivery's freeze (a later cycle) → ignored
      {
        op: 'UPDATED',
        criterionId: 'b',
        round: 4,
        causeTag: null,
        at: new Date('2026-06-21T00:00:00Z'),
      },
    ]
    const sig = independenceSignal(delivery, changes)
    expect(sig.postStartChanges).toBe(0)
    expect(sig.suspects).toEqual([])
  })

  it('collapses multiple post-start edits of one criterion to a single suspect (latest qualifying change)', () => {
    const changes: CriterionChange[] = [
      {
        op: 'ADDED',
        criterionId: 'b',
        round: 1,
        causeTag: 'GRANULARITY',
        at: new Date('2026-06-20T07:00:00Z'),
      },
      {
        op: 'UPDATED',
        criterionId: 'b',
        round: 2,
        causeTag: 'NEW_INFO',
        at: new Date('2026-06-20T08:00:00Z'),
      },
    ]
    const sig = independenceSignal(delivery, changes)
    expect(sig.postStartChanges).toBe(1)
    expect(sig.suspects).toHaveLength(1)
    expect(sig.suspects[0]!.round).toBe(2)
    expect(sig.suspects[0]!.causeTag).toBe('NEW_INFO')
  })
})

describe('report assembly', () => {
  it('fidelity report surfaces inconclusive and the no-snapshot case explicitly', () => {
    // no-snapshot case: a task never delivered (pre-LUM-609 or still TODO)
    const empty = buildFidelityChangePatternReport({
      taskId: 'LUM-1',
      workStartedAt: null,
      deliveries: [],
      changes: [],
    })
    expect(empty.hasSnapshots).toBe(false)
    expect(empty.deliveries).toEqual([])
    expect(typeof empty.caveat).toBe('string')
    expect(empty.caveat.length).toBeGreaterThan(0)

    // a real delivery whose whole contract is inconclusive — the inconclusive
    // count must be carried through, never silently swallowed
    const report = buildFidelityChangePatternReport({
      taskId: 'LUM-2',
      workStartedAt: new Date('2026-06-19T00:00:00Z'),
      deliveries: [
        {
          snapshotId: 'snapA',
          frozenAt: new Date('2026-06-20T00:00:00Z'),
          trigger: 'IN_REVIEW_ENTRY',
          sessionId: null,
          criteria: [
            crit({ id: 'p', referentKind: null }),
            crit({
              id: 'q',
              verifierType: 'HUMAN',
              referentKind: 'PENDING_OUTCOME',
            }),
          ],
        },
      ],
      changes: [],
    })
    expect(report.hasSnapshots).toBe(true)
    expect(report.deliveries).toHaveLength(1)
    const d = report.deliveries[0]!
    expect(d.total).toBe(2)
    expect(d.grounding.inconclusive).toBe(2)
    expect(d.grounding.grounded).toBe(0)
    // it is a composition table, not a single score
    expect(report).not.toHaveProperty('score')
    expect(d).not.toHaveProperty('score')
  })

  it('orders deliveries oldest-first and stamps ISO timestamps', () => {
    const report = buildFidelityChangePatternReport({
      taskId: 'LUM-3',
      workStartedAt: new Date('2026-06-18T00:00:00Z'),
      deliveries: [
        {
          snapshotId: 'second',
          frozenAt: new Date('2026-06-22T00:00:00Z'),
          trigger: 'IN_REVIEW_ENTRY',
          sessionId: null,
          criteria: [crit({ id: 'a' })],
        },
        {
          snapshotId: 'first',
          frozenAt: new Date('2026-06-20T00:00:00Z'),
          trigger: 'IN_REVIEW_ENTRY',
          sessionId: null,
          criteria: [crit({ id: 'a' })],
        },
      ],
      changes: [],
    })
    expect(report.deliveries.map(d => d.snapshotId)).toEqual([
      'first',
      'second',
    ])
    expect(report.deliveries[0]!.frozenAt).toBe('2026-06-20T00:00:00.000Z')
    expect(report.workStartedAt).toBe('2026-06-18T00:00:00.000Z')
  })
})
