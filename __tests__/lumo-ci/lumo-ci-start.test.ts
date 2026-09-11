/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/workflows/lumo-ci', () => ({ lumoCiWorkflow: jest.fn() }))

import { getRun, start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { cancelLumoCiRun, startLumoCi } from '@/lib/services/lumo-ci-start'
import { lumoCiWorkflow } from '@/lib/workflows/lumo-ci'

const startMock = start as unknown as jest.Mock
const getRunMock = getRun as unknown as jest.Mock
const JOB = {
  ciRunId: 'r1',
  workspaceId: 'w1',
  taskId: 't1',
  pullRequestId: 'pr1',
  repo: 'o/lumo',
  prNumber: 7,
  headSha: 'a'.repeat(40),
  jestShards: 2,
}

beforeEach(() => jest.clearAllMocks())

describe('startLumoCi', () => {
  it('starts the workflow with the job as its single argument and returns the run id', async () => {
    startMock.mockResolvedValue({ runId: 'run_1' })
    await expect(startLumoCi(JOB)).resolves.toBe('run_1')
    expect(startMock).toHaveBeenCalledWith(lumoCiWorkflow, [JOB])
    const line = (logger.info as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('run=r1')
    expect(line).toContain('o/lumo#7')
  })

  it('returns null and logs when start throws', async () => {
    startMock.mockRejectedValue(new Error('workflow backend 503'))
    await expect(startLumoCi(JOB)).resolves.toBeNull()
    const line = (logger.error as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('workflow backend 503')
    expect(line).toContain('r1')
  })
})

describe('cancelLumoCiRun', () => {
  it('cancels by run id and returns true', async () => {
    const cancel = jest.fn(async () => undefined)
    getRunMock.mockReturnValue({ cancel })
    await expect(cancelLumoCiRun('run_1', 'r1')).resolves.toBe(true)
    expect(getRunMock).toHaveBeenCalledWith('run_1')
    expect(cancel).toHaveBeenCalled()
  })

  it('returns false and warns when the cancel fails (never throws)', async () => {
    getRunMock.mockReturnValue({
      cancel: jest.fn(async () => {
        throw new Error('WorkflowRunNotFoundError')
      }),
    })
    await expect(cancelLumoCiRun('run_x', 'r1')).resolves.toBe(false)
    const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
    expect(line).toContain('run=run_x')
    expect(line).toContain('WorkflowRunNotFoundError')
  })
})
