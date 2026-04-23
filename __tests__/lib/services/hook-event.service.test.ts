/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    createHookEvent: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventService } from '@/lib/services/hook-event.service'

const repo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  repo.createHookEvent.mockResolvedValue({ id: 'he_1' } as never)
})

describe('hookEventService.recordHookEvent', () => {
  it('extracts tool_name from payload for PRE_TOOL_USE', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'PRE_TOOL_USE',
      payload: { tool_name: 'Read', tool_input: { file_path: '/x' } },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceMemberId: 'wm_1',
      type: 'PRE_TOOL_USE',
      toolName: 'Read',
      payload: { tool_name: 'Read', tool_input: { file_path: '/x' } },
    })
  })

  it('stores null toolName when payload has no tool_name', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'STOP',
      payload: { stop_reason: 'user' },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STOP', toolName: null })
    )
  })

  it('coerces non-string tool_name to null', async () => {
    await hookEventService.recordHookEvent({
      identity,
      type: 'POST_TOOL_USE',
      payload: { tool_name: 42 },
    })

    expect(repo.createHookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: null })
    )
  })
})
