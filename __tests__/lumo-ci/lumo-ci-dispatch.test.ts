/** @jest-environment node */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/services/lumo-ci-request.service', () => ({
  lumoCiRequestService: { requestRun: jest.fn() },
}))

import { logger } from '@/lib/logger'
import { lumoCiRequestService } from '@/lib/services/lumo-ci-request.service'
import { dispatchLumoCi } from '@/lib/services/lumo-ci-dispatch'

const requestRun = lumoCiRequestService.requestRun as jest.Mock

beforeEach(() => jest.clearAllMocks())

it('forwards the request (with the head sha when the caller has it)', async () => {
  requestRun.mockResolvedValue({
    kind: 'started',
    ciRunId: 'r1',
    runId: 'run_1',
  })
  await dispatchLumoCi('pr1', 'PR_EVENT', 'abc1234')
  expect(requestRun).toHaveBeenCalledWith({
    pullRequestId: 'pr1',
    trigger: 'PR_EVENT',
    headSha: 'abc1234',
  })
  await dispatchLumoCi('pr2', 'PR_LINK')
  expect(requestRun).toHaveBeenLastCalledWith({
    pullRequestId: 'pr2',
    trigger: 'PR_LINK',
  })
})

it('never throws: a request failure is logged and swallowed', async () => {
  requestRun.mockRejectedValue(new Error('db down'))
  await expect(
    dispatchLumoCi('pr1', 'PR_EVENT', 'abc1234')
  ).resolves.toBeUndefined()
  const line = (logger.warn as jest.Mock).mock.calls[0]?.join(' ') ?? ''
  expect(line).toContain('pr=pr1')
  expect(line).toContain('db down')
})
