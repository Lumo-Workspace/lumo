import { activeIntervalsByTask } from '@/lib/agent-run/active-time'
import {
  assembleStageInputs,
  type StageRows,
} from '@/lib/summaries/sprint-process-stages-inputs'

const d = (s: string) => new Date(s)
const SHA = 'a'.repeat(40)

function rows(over: Partial<StageRows> = {}): StageRows {
  return {
    statusEvents: [
      {
        taskId: 't1',
        payload: { from: 'TODO', to: 'IN_PROGRESS' },
        createdAt: d('2026-10-02T00:00:00Z'),
      },
      {
        taskId: 't1',
        payload: { from: 'IN_REVIEW', to: 'DONE' },
        createdAt: d('2026-10-05T00:00:00Z'),
      },
    ],
    crossings: [],
    pullRequests: [
      {
        id: 'pr1',
        taskId: 't1',
        number: 1,
        title: 'x',
        url: 'u',
        state: 'merged',
        headSha: SHA,
        mergeCommitSha: SHA,
        isDraft: false,
        createdAt: d('2026-10-03T00:00:00Z'),
        mergedAt: d('2026-10-04T00:00:00Z'),
        closedAt: d('2026-10-04T00:00:00Z'),
      },
    ],
    testCases: [
      {
        id: 'tc1',
        taskId: 't1',
        requiredEnvironment: null,
        runs: [
          {
            id: 'r1',
            result: 'PASS',
            environment: 'LOCAL',
            failureAttribution: null,
            unprovenVerification: [],
            evidence: [{ kind: 'text', text: 'ok' }],
            stepResults: [],
            pullRequestId: 'pr1',
            commitSha: SHA,
            commitDirty: false,
            createdAt: d('2026-10-04T12:00:00Z'),
            disposition: null,
          },
        ],
      },
    ],
    turnEvents: [],
    crossingGateEnabled: true,
    ...over,
  }
}

describe('assembleStageInputs', () => {
  it('derives start, verified time and the verified count', () => {
    const { stageTasks, verifiedCount } = assembleStageInputs(
      [{ id: 't1', status: 'DONE' }],
      rows(),
      new Map()
    )
    expect(verifiedCount).toBe(1)
    expect(stageTasks[0]).toMatchObject({
      taskId: 't1',
      startedAt: d('2026-10-02T00:00:00Z'),
      // later of DONE (10-05) and the latest run (10-04 12:00)
      verifiedAt: d('2026-10-05T00:00:00Z'),
    })
  })

  it('an open blocking crossing or a security blocker un-verifies the task', () => {
    const crossing = {
      taskId: 't1',
      detectedAt: d('2026-10-03T00:00:00Z'),
      dispositionedAt: null,
      disposition: null,
      advisory: false,
      severity: 'MEDIUM',
    }
    expect(
      assembleStageInputs(
        [{ id: 't1', status: 'DONE' }],
        rows({ crossings: [crossing] }),
        new Map()
      ).verifiedCount
    ).toBe(0)
    expect(
      assembleStageInputs(
        [{ id: 't1', status: 'DONE' }],
        rows({ crossings: [{ ...crossing, advisory: true }] }),
        new Map()
      ).verifiedCount
    ).toBe(1)
    expect(
      assembleStageInputs(
        [{ id: 't1', status: 'DONE' }],
        rows(),
        new Map([['t1', 1]])
      ).verifiedCount
    ).toBe(0)
  })

  it('a stale latest run is not verified', () => {
    const r = rows()
    const run = r.testCases[0]!.runs[0]!
    run.commitSha = 'b'.repeat(40)
    const { stageTasks, verifiedCount } = assembleStageInputs(
      [{ id: 't1', status: 'DONE' }],
      r,
      new Map()
    )
    expect(verifiedCount).toBe(0)
    expect(stageTasks[0]!.verifiedAt).toBeNull()
  })
})

describe('activeIntervalsByTask', () => {
  it('collects completed-turn spans per attributed task', () => {
    const ev = (type: string, iso: string, taskId: string | null) => ({
      sessionId: 's1',
      taskId,
      type,
      createdAt: d(iso),
    })
    const out = activeIntervalsByTask([
      ev('USER_PROMPT_SUBMIT', '2026-10-02T00:00:00Z', 't1'),
      ev('PRE_TOOL_USE', '2026-10-02T00:01:00Z', 't1'),
      ev('STOP', '2026-10-02T00:02:00Z', 't1'),
      ev('USER_PROMPT_SUBMIT', '2026-10-02T01:00:00Z', null),
      ev('STOP', '2026-10-02T01:01:00Z', null),
    ])
    expect([...out.keys()]).toEqual(['t1'])
    expect(out.get('t1')).toEqual([
      [
        d('2026-10-02T00:00:00Z').getTime(),
        d('2026-10-02T00:01:00Z').getTime(),
      ],
      [
        d('2026-10-02T00:01:00Z').getTime(),
        d('2026-10-02T00:02:00Z').getTime(),
      ],
    ])
  })
})
