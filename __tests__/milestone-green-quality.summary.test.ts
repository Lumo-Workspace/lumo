import {
  computeMilestoneGreenQuality,
  type GreenQualityTaskRow,
} from '@/lib/summaries/milestone-green-quality'
import { deriveFrictionBucket } from '@/lib/outcome/friction'
import {
  groundingComposition,
  parseSnapshotCriteria,
  type SnapshotCriterionShape,
} from '@/lib/fidelity/change-pattern'

function row(overrides: Partial<GreenQualityTaskRow>): GreenQualityTaskRow {
  return {
    id: 't-1',
    status: 'DONE',
    verificationRounds: null,
    sendBackCount: null,
    faithfulnessVerdict: null,
    snapshotCriteria: null,
    ...overrides,
  }
}

function criterion(
  overrides: Partial<SnapshotCriterionShape>
): SnapshotCriterionShape {
  return {
    id: 'c-1',
    statement: 'jest suite passes',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest __tests__/x.test.ts',
    referentKind: 'AGENT_CONSTRUCTED_STATE',
    evidenceRequired: false,
    ...overrides,
  }
}

describe('computeMilestoneGreenQuality', () => {
  it('green quality buckets are explicit and never scored', () => {
    const result = computeMilestoneGreenQuality([
      // null scalars = no verification record — its own bucket, not 0 rounds.
      row({ id: 'a', faithfulnessVerdict: 'FAITHFUL' }),
      // One clean round, judged faithful, frozen self-confirming contract.
      row({
        id: 'b',
        verificationRounds: 1,
        sendBackCount: 0,
        faithfulnessVerdict: 'FAITHFUL',
        snapshotCriteria: [criterion({ id: 'b1' }), criterion({ id: 'b2' })],
      }),
      // A send-back forces multi-round-or-sendback even at round 1.
      row({
        id: 'c',
        verificationRounds: 1,
        sendBackCount: 1,
        faithfulnessVerdict: 'OVERSTATED',
        snapshotCriteria: [
          criterion({
            id: 'c1',
            referentKind: 'EXTERNAL_FACT',
            checkpointer: 'bash -c "git diff --exit-code -- prisma/"',
          }),
        ],
      }),
      row({
        id: 'd',
        verificationRounds: 3,
        sendBackCount: 0,
        faithfulnessVerdict: 'UNDERREPORT',
        snapshotCriteria: [criterion({ id: 'd1', referentKind: null })],
      }),
      // UNJUDGEABLE and unknown verdict strings are explicit unjudged, never
      // silently folded into a judged bucket.
      row({
        id: 'e',
        verificationRounds: 1,
        sendBackCount: 0,
        faithfulnessVerdict: 'UNJUDGEABLE',
      }),
      row({
        id: 'f',
        verificationRounds: 1,
        sendBackCount: 0,
        faithfulnessVerdict: 'SOMETHING_NEW',
      }),
      // Non-DONE rows are ignored entirely.
      row({ id: 'g', status: 'IN_PROGRESS', faithfulnessVerdict: 'FAITHFUL' }),
    ])

    // Exact shape — counts only. No rate, no score, no synthesized third state.
    expect(result).toEqual({
      doneCount: 6,
      friction: {
        noVerification: 1,
        singleRound: 3,
        multiRoundOrSendback: 2,
      },
      faithfulness: {
        faithful: 2,
        overstated: 1,
        underReported: 1,
        unjudged: 2,
      },
      referentKind: {
        externallyAnchored: 1,
        selfConfirming: 2,
        other: 1,
        noSnapshotTasks: 3,
      },
    })
    const serialized = JSON.stringify(result).toLowerCase()
    for (const forbidden of ['score', 'rate', 'ratio', 'health', 'satisfied']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('green quality reuses friction and fidelity semantics', () => {
    // Friction: for every scalar pair, the rollup's bucket must be exactly
    // what the LUM-606 workspace implementation derives for the same input.
    const scalarPairs: Array<[number | null, number | null]> = [
      [null, null],
      [1, 0],
      [1, null],
      [1, 1],
      [2, 0],
      [4, 2],
    ]
    for (const [rounds, sendBacks] of scalarPairs) {
      const result = computeMilestoneGreenQuality([
        row({ verificationRounds: rounds, sendBackCount: sendBacks }),
      ])
      const expected = deriveFrictionBucket(rounds, sendBacks)
      expect(result.friction).toEqual({
        noVerification: expected === 'no-verification' ? 1 : 0,
        singleRound: expected === 'single-round' ? 1 : 0,
        multiRoundOrSendback: expected === 'multi-round-or-sendback' ? 1 : 0,
      })
    }

    // Referent kind: same frozen contract (including a declared-EXTERNAL_FACT
    // criterion whose checkpointer does not ground external — the LUM-605
    // downgrade) must roll up exactly as fidelity show's groundingComposition.
    const frozen = parseSnapshotCriteria([
      criterion({ id: 'k1', referentKind: 'AGENT_CONSTRUCTED_STATE' }),
      criterion({
        id: 'k2',
        referentKind: 'EXTERNAL_FACT',
        checkpointer: 'bash -c "gh pr view 42 --json state | grep MERGED"',
      }),
      criterion({
        id: 'k3',
        // Declared external but checkpointed by the agent's own jest run —
        // must count as self-confirming, never laundered into grounded.
        referentKind: 'EXTERNAL_FACT',
        checkpointer: 'npx jest __tests__/self.test.ts',
      }),
      criterion({
        id: 'k4',
        referentKind: 'PENDING_OUTCOME',
        checkpointer: null,
        verifierType: 'HUMAN',
      }),
      criterion({ id: 'k5', referentKind: null }),
    ])
    const grounding = groundingComposition(frozen)
    const result = computeMilestoneGreenQuality([
      row({ snapshotCriteria: frozen }),
    ])
    expect(result.referentKind).toEqual({
      externallyAnchored: grounding.grounded,
      selfConfirming: grounding.selfConfirming,
      other: grounding.inconclusive,
      noSnapshotTasks: 0,
    })
    // Pin the split itself so a silent change in either implementation that
    // still agreed with the other would surface here.
    expect(grounding.grounded).toBe(1)
    expect(grounding.selfConfirming).toBe(2)
    expect(grounding.inconclusive).toBe(2)
  })
})
