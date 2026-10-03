import {
  computeMilestoneRiskQueue,
  type MilestoneRiskQueueInput,
} from '@/lib/summaries/milestone-risk-queue'

const d = (iso: string) => new Date(iso)

function baseInput(
  over: Partial<MilestoneRiskQueueInput> = {}
): MilestoneRiskQueueInput {
  return {
    milestoneCreatedAt: d('2026-06-01T00:00:00Z'),
    tasks: [],
    edges: [],
    statusActivities: [],
    crossings: [],
    now: d('2026-07-01T00:00:00Z'),
    ...over,
  }
}

it('risk queue counts blocked review aging and scope baseline honestly', () => {
  const out = computeMilestoneRiskQueue(
    baseInput({
      tasks: [
        {
          id: 'a',
          ref: 'LUM-1',
          title: 'A',
          status: 'IN_REVIEW',
          createdAt: d('2026-05-20T00:00:00Z'),
        },
        {
          id: 'b',
          ref: 'LUM-2',
          title: 'B',
          status: 'IN_PROGRESS',
          createdAt: d('2026-06-10T00:00:00Z'),
        },
        {
          id: 'c',
          ref: 'LUM-3',
          title: 'C',
          status: 'IN_REVIEW',
          createdAt: d('2026-06-12T00:00:00Z'),
        },
      ],
      edges: [
        // CONFIRMED + blocking 未完成 → 计入
        {
          blockedTaskId: 'b',
          status: 'CONFIRMED',
          blocking: { ref: 'LUM-9', title: 'Blk', status: 'IN_PROGRESS' },
        },
        // SUGGESTED → 不计
        {
          blockedTaskId: 'b',
          status: 'SUGGESTED',
          blocking: { ref: 'LUM-8', title: 'Sug', status: 'TODO' },
        },
        // CONFIRMED 但 blocking 已 DONE → 不计
        {
          blockedTaskId: 'a',
          status: 'CONFIRMED',
          blocking: { ref: 'LUM-7', title: 'Done', status: 'DONE' },
        },
      ],
      statusActivities: [
        // a 最近一次转入 IN_REVIEW = 06-28 → aging 3 天;更早的转入 IN_PROGRESS 不算
        {
          taskId: 'a',
          payload: { from: 'IN_PROGRESS', to: 'IN_REVIEW' },
          createdAt: d('2026-06-28T00:00:00Z'),
        },
        {
          taskId: 'a',
          payload: { from: 'TODO', to: 'IN_PROGRESS' },
          createdAt: d('2026-06-20T00:00:00Z'),
        },
        // c 无 IN_REVIEW 转入记录 → aging 显式 unknown(null)
      ],
    })
  )

  expect(out.blocked).toEqual([
    {
      taskId: 'b',
      ref: 'LUM-2',
      title: 'B',
      blockingRef: 'LUM-9',
      blockingStatus: 'IN_PROGRESS',
    },
  ])
  expect(out.awaitingVerdict).toEqual([
    { taskId: 'a', ref: 'LUM-1', title: 'A', agingSec: 3 * 86400 },
    { taskId: 'c', ref: 'LUM-3', title: 'C', agingSec: null },
  ])
  // scope 基线以 milestone 创建时点(06-01)划分:a 之前建 → initial 1;b/c 之后 → 后加 2
  expect(out.scopeBaseline).toEqual({ initial: 1, current: 3, addedLater: 2 })
})

it('risk queue crossings block fails closed', () => {
  const tasks = [
    {
      id: 'a',
      ref: 'LUM-1',
      title: 'A',
      status: 'IN_PROGRESS' as const,
      createdAt: d('2026-05-01T00:00:00Z'),
    },
  ]
  // 读取失败(null 入参)→ unknown,绝不呈现为 0
  const failed = computeMilestoneRiskQueue(
    baseInput({ tasks, crossings: null })
  )
  expect(failed.crossings).toEqual({ known: false })

  // OPEN 判定只认未 disposition 且非 advisory 的越界
  const ok = computeMilestoneRiskQueue(
    baseInput({
      tasks,
      crossings: [
        { taskId: 'a', severity: 'HIGH', disposition: null, advisory: false }, // 计入
        {
          taskId: 'a',
          severity: 'MEDIUM',
          disposition: 'CONFIRMED',
          advisory: false,
        }, // 已处置,不计
        { taskId: 'a', severity: 'LOW', disposition: null, advisory: true }, // advisory,不计
      ],
    })
  )
  expect(ok.crossings).toEqual({
    known: true,
    bySeverity: { high: 1, medium: 0, low: 0 },
    tasks: [
      { taskId: 'a', ref: 'LUM-1', title: 'A', high: 1, medium: 0, low: 0 },
    ],
  })
})
