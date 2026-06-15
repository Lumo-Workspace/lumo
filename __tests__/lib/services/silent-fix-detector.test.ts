/** @jest-environment node */
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listByTaskAndType: jest.fn(), create: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { taskIdsWithSendBack: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: jest.fn(),
    create: jest.fn(),
  },
}))
jest.mock('@/lib/llm/silent-fix-judge-client', () => ({
  judgeSilentFix: jest.fn(),
}))

import { recordSilentFixIfDetected } from '@/lib/services/boundary-detector.service'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { judgeSilentFix } from '@/lib/llm/silent-fix-judge-client'

const mockListByType = activityRepository.listByTaskAndType as jest.Mock
const mockSendBacks = verificationRunRepository.taskIdsWithSendBack as jest.Mock
const mockCoalesce = boundaryCrossingRepository.coalesceRecurrence as jest.Mock
const mockCrossingCreate = boundaryCrossingRepository.create as jest.Mock
const mockJudge = judgeSilentFix as jest.Mock

type Input = Parameters<typeof recordSilentFixIfDetected>[0]
const editInput: Input = {
  taskId: 't-1',
  hookEventId: 'h-1',
  toolName: 'Edit',
  filePath: 'app/x.tsx',
  payload: { tool_input: { old_string: 'a', new_string: 'b' } },
}

function reviewed(types: Record<string, unknown[]>) {
  mockListByType.mockImplementation(async (_taskId: string, type: string) =>
    type in types ? types[type] : []
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSendBacks.mockResolvedValue(new Set())
  mockJudge.mockResolvedValue('REAL_FIX')
  mockCoalesce.mockResolvedValue(0)
  mockCrossingCreate.mockResolvedValue({ id: 'bc-1' })
  reviewed({ STATUS_CHANGED: [{ payload: { toStatus: 'IN_REVIEW' } }] })
})

describe('recordSilentFixIfDetected', () => {
  it('records a SILENT_FIX crossing for a post-review edit with no send-back, judged REAL_FIX', async () => {
    await recordSilentFixIfDetected(editInput)
    expect(mockCrossingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        category: 'SILENT_FIX',
        target: 'app/x.tsx',
        severity: 'MEDIUM',
      })
    )
  })

  it('short-circuits a non-write tool (no DB, no judge)', async () => {
    await recordSilentFixIfDetected({ ...editInput, toolName: 'Bash' })
    expect(mockListByType).not.toHaveBeenCalled()
    expect(mockJudge).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('does nothing when the task never entered IN_REVIEW', async () => {
    reviewed({ STATUS_CHANGED: [{ payload: { toStatus: 'IN_PROGRESS' } }] })
    await recordSilentFixIfDetected(editInput)
    expect(mockJudge).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('does nothing when a send-back is already recorded (normal traced rework)', async () => {
    mockSendBacks.mockResolvedValue(new Set(['t-1']))
    await recordSilentFixIfDetected(editInput)
    expect(mockJudge).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('skips the judge (cost guard) when this file already has a SILENT_FIX crossing (coalesced)', async () => {
    mockCoalesce.mockResolvedValue(1)
    await recordSilentFixIfDetected(editInput)
    expect(mockJudge).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('records nothing when the judge says COSMETIC', async () => {
    mockJudge.mockResolvedValue('COSMETIC')
    await recordSilentFixIfDetected(editInput)
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })
})
