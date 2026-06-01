/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    hookEvent: {
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const mockCreate = prisma.hookEvent.create as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('hookEventRepository.createHookEvent', () => {
  it('inserts a hook event with all fields and returns id', async () => {
    mockCreate.mockResolvedValue({ id: 'he_1' })

    const result = await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      sessionId: 'sess_abc',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      filePath: '/tmp/x',
      payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
    })

    expect(result).toEqual({ id: 'he_1' })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        sessionId: 'sess_abc',
        taskId: null,
        type: 'PRE_TOOL_USE',
        toolName: 'Read',
        filePath: '/tmp/x',
        payload: { tool_name: 'Read', tool_input: { file_path: '/tmp/x' } },
      },
      select: { id: true },
    })
  })

  it('defaults filePath to null when omitted', async () => {
    mockCreate.mockResolvedValue({ id: 'he_3' })

    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: { reason: 'user' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ filePath: null }),
      })
    )
  })

  it('allows null toolName for Stop events', async () => {
    mockCreate.mockResolvedValue({ id: 'he_2' })

    await hookEventRepository.createHookEvent({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'STOP',
      toolName: null,
      payload: { reason: 'user-ctrl-c' },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toolName: null }),
      })
    )
  })
})
