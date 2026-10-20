import type { IntlShape } from 'react-intl'
import {
  buildStageCards,
  summarizeQueueKinds,
  toQueueRows,
  toTaskRows,
} from '@/app/workspace/[workspaceUrl]/sprints/components/detail/view-model'
import {
  formatDwellDays,
  formatWait,
} from '@/app/workspace/[workspaceUrl]/sprints/components/detail/format'
import type {
  SprintAttentionQueueItemDto,
  SprintAttentionTaskDto,
} from '@/lib/api-client/sprints'

const task = (
  over: Partial<SprintAttentionTaskDto> & { taskId: string }
): SprintAttentionTaskDto => ({
  identifier: over.taskId.toUpperCase(),
  title: `Title ${over.taskId}`,
  status: 'IN_PROGRESS',
  assignee: null,
  trust: {
    testsPassing: 0,
    testsTotal: 0,
    testsFresh: 0,
    crossingsBlocking: 0,
    security: 'clear',
  },
  verified: false,
  waitingOn: null,
  confirmedBy: null,
  ...over,
})

const prItem: SprintAttentionQueueItemDto = {
  kind: 'prReview',
  taskId: 'a',
  identifier: 'A',
  title: 'A',
  assignee: { actorId: 'x', name: 'Jordan' },
  waitingSince: '2026-10-16T00:00:00.000Z',
  waitingSec: 3 * 86400,
  pr: { repo: 'o/r', number: 7, title: 'pr', url: 'https://x/7' },
}
const crossingItem: SprintAttentionQueueItemDto = {
  kind: 'crossingRuling',
  taskId: 'b',
  identifier: 'B',
  title: 'B',
  assignee: null,
  waitingSince: '2026-10-18T00:00:00.000Z',
  waitingSec: 3600,
  crossing: {
    id: 'c1',
    number: 3,
    category: 'TEST_FILE_DELETED',
    severity: 'MEDIUM',
  },
}
const doneItem: SprintAttentionQueueItemDto = {
  kind: 'doneConfirmation',
  taskId: 'c',
  identifier: 'C',
  title: 'C',
  assignee: null,
  waitingSince: '2026-10-19T00:00:00.000Z',
  waitingSec: 600,
}

describe('buildStageCards', () => {
  it('counts stages, awaiting verification and verified from the DTO', () => {
    const tasks = [
      task({ taskId: 'a', status: 'DONE', verified: true }),
      task({ taskId: 'b', status: 'DONE' }), // no TC
      task({
        taskId: 'c',
        status: 'DONE',
        trust: {
          ...task({ taskId: 'x' }).trust,
          testsTotal: 1,
          testsPassing: 1,
          testsFresh: 0,
        },
      }),
      task({ taskId: 'd', status: 'IN_REVIEW' }),
    ]
    const model = buildStageCards(
      {
        tasks,
        stages: [
          { key: 'BACKLOG', count: 2, medianDwellSec: null },
          { key: 'TODO', count: 1, medianDwellSec: null },
          { key: 'IN_PROGRESS', count: 0, medianDwellSec: null },
          { key: 'IN_REVIEW', count: 1, medianDwellSec: 100 },
          { key: 'DONE', count: 3, medianDwellSec: 50 },
        ],
      },
      [prItem, crossingItem, crossingItem, doneItem]
    )
    expect(model).toEqual({
      inProgress: { count: 0, medianDwellSec: null },
      inReview: {
        count: 1,
        medianDwellSec: 100,
        prReviews: 1,
        crossingRulings: 2,
      },
      awaitingVerification: { count: 2, missingTc: 1 },
      verified: { count: 1, total: 4, notStarted: 3 },
    })
  })

  it('reads zeros for an empty sprint', () => {
    expect(buildStageCards({ tasks: [], stages: [] }, [])).toEqual({
      inProgress: { count: 0, medianDwellSec: null },
      inReview: {
        count: 0,
        medianDwellSec: null,
        prReviews: 0,
        crossingRulings: 0,
      },
      awaitingVerification: { count: 0, missingTc: 0 },
      verified: { count: 0, total: 0, notStarted: 0 },
    })
  })
})

describe('toQueueRows', () => {
  it('flattens each kind and joins the task trust', () => {
    const rows = toQueueRows(
      [prItem, crossingItem, doneItem],
      [
        task({
          taskId: 'a',
          trust: {
            testsPassing: 2,
            testsTotal: 3,
            testsFresh: 2,
            crossingsBlocking: 0,
            security: 'clear',
          },
        }),
      ]
    )
    expect(rows[0]).toMatchObject({
      kind: 'prReview',
      ownerName: 'Jordan',
      prNumber: 7,
      prUrl: 'https://x/7',
      crossingCategory: null,
      testsPassing: 2,
      testsTotal: 3,
    })
    expect(rows[1]).toMatchObject({
      kind: 'crossingRuling',
      ownerName: null,
      prNumber: null,
      crossingCategory: 'TEST_FILE_DELETED',
      testsTotal: null,
    })
    expect(rows[2]).toMatchObject({ kind: 'doneConfirmation', waitingSec: 600 })
    expect(new Set(rows.map(r => r.key)).size).toBe(3)
  })
})

describe('summarizeQueueKinds', () => {
  it('counts each kind with its longest wait, in a fixed order', () => {
    expect(
      summarizeQueueKinds([
        { kind: 'crossingRuling', waitingSec: 10 },
        { kind: 'crossingRuling', waitingSec: 30 },
        { kind: 'prReview', waitingSec: 5 },
      ])
    ).toEqual([
      { kind: 'prReview', count: 1, oldestSec: 5 },
      { kind: 'crossingRuling', count: 2, oldestSec: 30 },
      { kind: 'doneConfirmation', count: 0, oldestSec: null },
    ])
  })
})

describe('toTaskRows', () => {
  it("takes the wait of the task's own queue entry and the confirmer", () => {
    const rows = toTaskRows(
      [
        task({ taskId: 'a', waitingOn: 'prReview' }),
        task({
          taskId: 'z',
          status: 'DONE',
          verified: true,
          confirmedBy: { actorId: 'q', name: 'Chen' },
        }),
      ],
      [crossingItem, prItem]
    )
    expect(rows[0]).toMatchObject({
      waitingOn: 'prReview',
      waitingSec: 3 * 86400,
      confirmedByName: null,
    })
    expect(rows[1]).toMatchObject({
      waitingOn: null,
      waitingSec: null,
      verified: true,
      confirmedByName: 'Chen',
    })
  })
})

describe('format', () => {
  const intl = {
    formatMessage: ({ id }: { id: string }, v: { count: number }) =>
      `${id.split('.').pop()}:${v.count}`,
    formatNumber: (n: number, o: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', o).format(n),
  } as unknown as IntlShape

  it('formatWait picks one coarse unit', () => {
    expect(formatWait(intl, 20)).toBe('minutes:1')
    expect(formatWait(intl, 40 * 60)).toBe('minutes:40')
    expect(formatWait(intl, 26 * 3600)).toBe('hours:26')
    expect(formatWait(intl, 3 * 86400 + 5)).toBe('days:3')
  })

  it('formatDwellDays rounds to one decimal', () => {
    expect(formatDwellDays(intl, 1.24 * 86400)).toBe('1.2')
    expect(formatDwellDays(intl, 2 * 86400)).toBe('2')
  })
})
