import { sprintProcessStagesRepository } from '@/lib/repositories/sprint-process-stages.repository'

const m = {
  taskActivity: jest.fn(),
  boundaryCrossing: jest.fn(),
  pullRequest: jest.fn(),
  testCase: jest.fn(),
  hookEvent: jest.fn(),
  workspace: jest.fn(),
}

jest.mock('@/lib/db/workspace-scope', () => ({
  scopedPrisma: {
    taskActivity: { findMany: (...a: any[]) => m.taskActivity(...a) },
    boundaryCrossing: { findMany: (...a: any[]) => m.boundaryCrossing(...a) },
    pullRequest: { findMany: (...a: any[]) => m.pullRequest(...a) },
    testCase: { findMany: (...a: any[]) => m.testCase(...a) },
    hookEvent: { findMany: (...a: any[]) => m.hookEvent(...a) },
    workspace: { findUnique: (...a: any[]) => m.workspace(...a) },
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  for (const fn of Object.values(m)) fn.mockResolvedValue([])
  m.workspace.mockResolvedValue({ boundaryGateEnabled: false })
})

describe('sprintProcessStagesRepository.loadInputs', () => {
  it('skips every query for an empty task set', async () => {
    const out = await sprintProcessStagesRepository.loadInputs('ws1', [])
    expect(out.crossingGateEnabled).toBe(true)
    for (const fn of Object.values(m)) expect(fn).not.toHaveBeenCalled()
  })

  it('batches by task ids and pins every query to the workspace', async () => {
    m.hookEvent.mockResolvedValue([
      {
        sessionId: 's1',
        taskId: null,
        type: 'STOP',
        createdAt: new Date(0),
        session: { taskId: 't1' },
      },
    ])
    const out = await sprintProcessStagesRepository.loadInputs('ws1', [
      't1',
      't2',
    ])
    const ids = { in: ['t1', 't2'] }
    expect(m.taskActivity.mock.calls[0][0].where).toMatchObject({
      taskId: ids,
      task: { workspaceId: 'ws1' },
      type: 'STATUS_CHANGED',
    })
    expect(m.boundaryCrossing.mock.calls[0][0].where).toMatchObject({
      taskId: ids,
      task: { workspaceId: 'ws1' },
    })
    expect(m.pullRequest.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'ws1',
      taskId: ids,
    })
    expect(m.testCase.mock.calls[0][0].where).toMatchObject({
      taskId: ids,
      task: { workspaceId: 'ws1' },
      deletedAt: null,
    })
    expect(m.hookEvent.mock.calls[0][0].where.workspaceId).toBe('ws1')
    // An event without its own task falls back to its session's task.
    expect(out.turnEvents).toEqual([
      { sessionId: 's1', taskId: 't1', type: 'STOP', createdAt: new Date(0) },
    ])
    expect(out.crossingGateEnabled).toBe(false)
  })
})
