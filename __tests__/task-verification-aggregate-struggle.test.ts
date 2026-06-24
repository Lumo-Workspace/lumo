/**
 * @jest-environment node
 */
// Cut the github-integration ESM import chain pulled in via task.service
// (task.service → task-pr-sync → github/auth → octokit ESM); statusForTask is
// spied below so no repository is exercised.
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))

import { taskVerificationService } from '@/lib/services/task-verification.service'

function fakeStatus(id: string) {
  return {
    task: { identifier: `LUM-${id}`, title: id },
    struggleTrail: {
      reworkRounds: [{ round: 1, failed: 2 }],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    machineVerification: { total: 1, machineVerified: 0, humanOverridden: 1 },
  } as unknown as Awaited<
    ReturnType<typeof taskVerificationService.statusForTask>
  >
}

describe('taskVerificationService.aggregateStruggleForTasks', () => {
  afterEach(() => jest.restoreAllMocks())

  it('rolls up struggle across tasks via statusForTask', async () => {
    jest
      .spyOn(taskVerificationService, 'statusForTask')
      .mockImplementation(async (id: string) => fakeStatus(id))

    const agg = await taskVerificationService.aggregateStruggleForTasks([
      't1',
      't2',
    ])
    expect(agg.tasksConsidered).toBe(2)
    expect(agg.reworkRounds).toBe(2)
    expect(agg.failedVerdicts).toBe(4)
    expect(agg.humanOverridden).toBe(2)
  })

  it('drops a task that 404s rather than failing the whole retro', async () => {
    jest
      .spyOn(taskVerificationService, 'statusForTask')
      .mockImplementation(async (id: string) => {
        if (id === 'missing') {
          throw Object.assign(new Error('Task not found'), { status: 404 })
        }
        return fakeStatus(id)
      })

    const agg = await taskVerificationService.aggregateStruggleForTasks([
      't1',
      'missing',
    ])
    expect(agg.tasksConsidered).toBe(1)
    expect(agg.reworkRounds).toBe(1)
  })
})
