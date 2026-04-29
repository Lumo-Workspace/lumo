/**
 * @jest-environment node
 *
 * Black-box test for the layer1 orchestrator: verifies the skip-paths
 * (no taskId, no input, no LLM ops) and the happy path. The LLM call and
 * DB writes are mocked — we're testing wiring, not the model.
 */
jest.mock('@/lib/services/memory/layer1-input', () => ({
  getLayer1Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-extract', () => ({
  extractLayer1Operations: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer1-apply', () => ({
  applyLayer1Operations: jest.fn(),
}))

import { getLayer1Input } from '@/lib/services/memory/layer1-input'
import { extractLayer1Operations } from '@/lib/services/memory/layer1-extract'
import { applyLayer1Operations } from '@/lib/services/memory/layer1-apply'
import { layer1Service } from '@/lib/services/memory/layer1.service'

const getInput = getLayer1Input as jest.MockedFunction<typeof getLayer1Input>
const extract = extractLayer1Operations as jest.MockedFunction<
  typeof extractLayer1Operations
>
const apply = applyLayer1Operations as jest.MockedFunction<
  typeof applyLayer1Operations
>

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('layer1Service.triggerLayer1Extraction', () => {
  it('skips when taskId is null', async () => {
    await layer1Service.triggerLayer1Extraction({
      sessionId: 'sess_1',
      taskId: null,
      workspaceId: 'ws_1',
    })
    expect(getInput).not.toHaveBeenCalled()
    expect(extract).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips when getLayer1Input returns null', async () => {
    getInput.mockResolvedValue(null)
    await layer1Service.triggerLayer1Extraction({
      sessionId: 'sess_1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
    })
    expect(extract).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips apply when LLM returns empty operations list', async () => {
    getInput.mockResolvedValue({
      task: {
        id: 'task_1',
        title: 't',
        description: null,
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      },
      turnEvents: [],
      existingMemories: [],
    })
    extract.mockResolvedValue([])
    await layer1Service.triggerLayer1Extraction({
      sessionId: 'sess_1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
    })
    expect(apply).not.toHaveBeenCalled()
  })

  it('runs the full pipeline on the happy path', async () => {
    getInput.mockResolvedValue({
      task: {
        id: 'task_1',
        title: 't',
        description: null,
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      },
      turnEvents: [],
      existingMemories: [{ id: 'mem_a', category: 'TRAP', content: {} }],
    })
    extract.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
      },
    ])
    apply.mockResolvedValue({
      added: 1,
      updated: 0,
      archived: 0,
      noop: 0,
      skipped: 0,
    })

    await layer1Service.triggerLayer1Extraction({
      sessionId: 'sess_1',
      taskId: 'task_1',
      workspaceId: 'ws_1',
    })

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task_1',
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        sessionId: 'sess_1',
        existingMemories: [{ id: 'mem_a', category: 'TRAP' }],
      })
    )
  })

  it('swallows unexpected errors instead of throwing (fire-and-forget contract)', async () => {
    getInput.mockRejectedValue(new Error('db down'))
    await expect(
      layer1Service.triggerLayer1Extraction({
        sessionId: 'sess_1',
        taskId: 'task_1',
        workspaceId: 'ws_1',
      })
    ).resolves.toBeUndefined()
  })
})
