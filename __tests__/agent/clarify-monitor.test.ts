jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentClarify: { create: jest.fn() },
    task: { findUnique: jest.fn(), update: jest.fn() },
  },
}))

jest.mock('@/lib/agent/state-machine', () => ({
  transitionAgentStatus: jest.fn(),
}))

jest.mock('@/lib/notifications/notifyAgentActions', () => ({
  notifyAgentClarify: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { notifyAgentClarify } from '@/lib/notifications/notifyAgentActions'
import {
  monitorForClarify,
  checkForClarifyFile,
} from '@/lib/agent/clarify-monitor'

const mockCreate = prisma.agentClarify.create as jest.Mock
const mockTransition = transitionAgentStatus as jest.Mock
const mockNotify = notifyAgentClarify as jest.Mock

// Fake sandbox
function makeSandbox(fileContent: string | null = null) {
  return {
    files: {
      read: jest
        .fn()
        .mockImplementation(() =>
          fileContent
            ? Promise.resolve(fileContent)
            : Promise.reject(new Error('not found'))
        ),
    },
  } as any
}

const TASK: Parameters<typeof monitorForClarify>[1] = {
  id: 'task-1',
  identifier: 'LUM-1',
  reviewerId: '',
  projectId: 'proj-1',
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  mockCreate.mockResolvedValue({ id: 'clarify-1' })
  mockTransition.mockResolvedValue(undefined)
  mockNotify.mockResolvedValue(undefined)
  // state-machine reads agentStatus before transition
  ;(prisma.task.findUnique as jest.Mock).mockResolvedValue({
    agentStatus: 'WORKING',
  })
  ;(prisma.task.update as jest.Mock).mockResolvedValue({})
})

afterEach(() => {
  jest.useRealTimers()
})

describe('monitorForClarify', () => {
  it('resolves when the clarify file appears', async () => {
    const question = JSON.stringify({
      question: 'What DB to use?',
      context: 'Spec mentions persistence but not which DB',
    })
    const sandbox = makeSandbox(question)

    const handle = monitorForClarify(sandbox, TASK, 50)

    // Advance past one interval so the poll fires
    jest.advanceTimersByTime(60)
    await handle.promise

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        taskId: 'task-1',
        question: 'What DB to use?',
        context: 'Spec mentions persistence but not which DB',
      },
    })
    expect(mockTransition).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      'INPUT_REQUIRED',
      {
        inputReason: 'clarify',
      }
    )
    expect(mockNotify).toHaveBeenCalledWith('task-1', 'clarify-1')
  })

  it('keeps polling when file not found', async () => {
    const sandbox = makeSandbox(null)

    const handle = monitorForClarify(sandbox, TASK, 50)

    // Advance a few intervals
    jest.advanceTimersByTime(200)

    // Should have polled multiple times, but not resolved
    expect(sandbox.files.read).toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()

    handle.stop()
  })

  it('stop() prevents further polling', async () => {
    const sandbox = makeSandbox(null)

    const handle = monitorForClarify(sandbox, TASK, 50)

    jest.advanceTimersByTime(60)
    const callsBefore = (sandbox.files.read as jest.Mock).mock.calls.length

    handle.stop()

    jest.advanceTimersByTime(200)
    const callsAfter = (sandbox.files.read as jest.Mock).mock.calls.length

    expect(callsAfter).toBe(callsBefore)
  })
})

describe('checkForClarifyFile', () => {
  it('returns true and creates clarify when file exists', async () => {
    jest.useRealTimers()
    const question = JSON.stringify({
      question: 'Missing API key?',
      context: null,
    })
    const sandbox = makeSandbox(question)

    const result = await checkForClarifyFile(sandbox, TASK)

    expect(result).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        taskId: 'task-1',
        question: 'Missing API key?',
        context: null,
      },
    })
    expect(mockTransition).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      'INPUT_REQUIRED',
      {
        inputReason: 'clarify',
      }
    )
  })

  it('returns false when file does not exist', async () => {
    jest.useRealTimers()
    const sandbox = makeSandbox(null)

    const result = await checkForClarifyFile(sandbox, TASK)

    expect(result).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
