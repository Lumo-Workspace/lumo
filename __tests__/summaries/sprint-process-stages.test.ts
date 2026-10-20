import {
  computeProcessStages,
  median,
  taskStageDurations,
  type StageTaskInput,
  type StageWindow,
} from '@/lib/summaries/sprint-process-stages'

const H = 3_600_000
const T0 = Date.UTC(2026, 9, 1)
const at = (h: number) => new Date(T0 + h * H)

const window: StageWindow = {
  start: at(0),
  end: at(100),
  crossingGateEnabled: true,
}

function task(over: Partial<StageTaskInput> = {}): StageTaskInput {
  return {
    taskId: 't1',
    startedAt: at(10),
    verifiedAt: at(20),
    crossings: [],
    agentIntervals: [],
    pullRequests: [],
    ...over,
  }
}

describe('taskStageDurations', () => {
  it('puts the whole window in other when nothing else happens', () => {
    expect(taskStageDurations(task(), window)).toEqual({
      ruling: 0,
      agent: 0,
      review: 0,
      verification: 0,
      other: 10 * H,
    })
  })

  it('counts agent time during an open PR as agent, not review', () => {
    const d = taskStageDurations(
      task({
        agentIntervals: [[at(12).getTime(), at(14).getTime()]],
        pullRequests: [
          { createdAt: at(11), mergedAt: null, closedAt: null, isDraft: false },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ agent: 2 * H, review: 7 * H, other: 1 * H })
  })

  it('ruling outranks agent', () => {
    const d = taskStageDurations(
      task({
        agentIntervals: [[at(10).getTime(), at(20).getTime()]],
        crossings: [
          {
            detectedAt: at(12),
            dispositionedAt: at(15),
            advisory: false,
            severity: 'MEDIUM',
          },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ ruling: 3 * H, agent: 7 * H, other: 0 })
  })

  it('skips a ruled crossing that carries no disposition time', () => {
    const d = taskStageDurations(
      task({
        crossings: [
          {
            detectedAt: at(12),
            dispositionedAt: null,
            disposition: 'FALSE_POSITIVE',
            advisory: false,
            severity: 'HIGH',
          },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ ruling: 0, other: 10 * H })
  })

  it('excludes a draft PR from review', () => {
    const d = taskStageDurations(
      task({
        pullRequests: [
          { createdAt: at(11), mergedAt: null, closedAt: null, isDraft: true },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ review: 0, other: 10 * H })
  })

  it('ignores an advisory crossing', () => {
    const d = taskStageDurations(
      task({
        crossings: [
          {
            detectedAt: at(12),
            dispositionedAt: null,
            advisory: true,
            severity: 'HIGH',
          },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ ruling: 0, other: 10 * H })
  })

  it('with the workspace gate off, only HIGH crossings count as ruling', () => {
    const crossings = [
      {
        detectedAt: at(12),
        dispositionedAt: at(14),
        advisory: false,
        severity: 'MEDIUM',
      },
      {
        detectedAt: at(16),
        dispositionedAt: at(17),
        advisory: false,
        severity: 'HIGH',
      },
    ]
    const d = taskStageDurations(task({ crossings }), {
      ...window,
      crossingGateEnabled: false,
    })
    expect(d).toMatchObject({ ruling: 1 * H })
  })

  it('counts merged-but-unverified time as verification', () => {
    const d = taskStageDurations(
      task({
        pullRequests: [
          {
            createdAt: at(10),
            mergedAt: at(15),
            closedAt: at(15),
            isDraft: false,
          },
        ],
      }),
      window
    )
    expect(d).toMatchObject({ review: 5 * H, verification: 5 * H, other: 0 })
  })

  it('clips a never-verified task at the sprint end', () => {
    const d = taskStageDurations(
      task({ startedAt: at(90), verifiedAt: null }),
      window
    )
    expect(d?.other).toBe(10 * H)
  })

  it('clips a task started before the sprint at the sprint start', () => {
    const d = taskStageDurations(
      task({ startedAt: at(-50), verifiedAt: at(5) }),
      window
    )
    expect(d?.other).toBe(5 * H)
  })

  it('returns null for a never-started task or one verified before the sprint', () => {
    expect(taskStageDurations(task({ startedAt: null }), window)).toBeNull()
    expect(
      taskStageDurations(
        task({ startedAt: at(-20), verifiedAt: at(-5) }),
        window
      )
    ).toBeNull()
  })
})

describe('median', () => {
  it('takes the middle of an odd sample', () => {
    expect(median([5, 1, 3])).toBe(3)
  })
  it('averages the two middles of an even sample', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('is null for an empty sample', () => {
    expect(median([])).toBeNull()
  })
})

describe('computeProcessStages', () => {
  it('reports empty stats for an empty sprint', () => {
    const s = computeProcessStages([], window)
    expect(s.tasks).toBe(0)
    for (const stage of Object.values(s.stages)) {
      expect(stage).toEqual({ medianMs: null, n: 0 })
    }
  })

  it('medians across tasks and excludes zero-length samples from n', () => {
    const s = computeProcessStages(
      [
        task({ taskId: 'a', startedAt: at(0), verifiedAt: at(2) }),
        task({ taskId: 'b', startedAt: at(0), verifiedAt: at(4) }),
        task({
          taskId: 'c',
          startedAt: at(0),
          verifiedAt: at(6),
          agentIntervals: [[at(0).getTime(), at(6).getTime()]],
        }),
      ],
      window
    )
    expect(s.tasks).toBe(3)
    expect(s.stages.other).toEqual({ medianMs: 3 * H, n: 2 })
    expect(s.stages.agent).toEqual({ medianMs: 6 * H, n: 1 })
    expect(s.stages.review).toEqual({ medianMs: null, n: 0 })
  })
})
