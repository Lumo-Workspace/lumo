/**
 * @jest-environment node
 *
 * Black-box test for the promote-task orchestrator: verifies the three
 * outcomes (skipped / no-promote / applied) and the fire-and-forget error
 * contract. Layer 2 / Layer 3 calls and DB writes are mocked — we're testing
 * wiring, not the model.
 *
 * Task-scoped memories are intentionally NOT touched by promotion: they stay
 * visible on the task detail page after the task is done, and Layer 1 can
 * still UPDATE / DELETE them on later sessions.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({})
    ),
  },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: jest.fn(),
    updateContent: jest.fn(),
  },
}))
jest.mock('@/lib/services/memory/layer2.service', () => ({
  layer2Service: {
    consolidateTaskMemory: jest.fn(),
  },
}))
jest.mock('@/lib/services/memory/layer3-input', () => ({
  getLayer3Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer3-extract', () => ({
  extractLayer3Operations: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { layer2Service } from '@/lib/services/memory/layer2.service'
import { getLayer3Input } from '@/lib/services/memory/layer3-input'
import { extractLayer3Operations } from '@/lib/services/memory/layer3-extract'
import { promoteTaskService } from '@/lib/services/memory/promote-task'

const tx = prisma as unknown as { $transaction: jest.Mock }
const consolidate = layer2Service.consolidateTaskMemory as jest.MockedFunction<
  typeof layer2Service.consolidateTaskMemory
>
const layer3Input = getLayer3Input as jest.MockedFunction<typeof getLayer3Input>
const layer3Extract = extractLayer3Operations as jest.MockedFunction<
  typeof extractLayer3Operations
>

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(memoryRepository.create as jest.Mock).mockResolvedValue({ id: 'mem_new' })
  ;(memoryRepository.updateContent as jest.Mock).mockResolvedValue({
    id: 'mem_upd',
  })
})

describe('promoteTaskService.promoteTaskMemory', () => {
  it('returns "skipped" when Layer 2 has no input (task gone or no memory)', async () => {
    consolidate.mockResolvedValue({ facts: null, task: null })
    const result = await promoteTaskService.promoteTaskMemory('task_1')
    expect(result).toEqual({ outcome: 'skipped' })
    expect(layer3Input).not.toHaveBeenCalled()
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it('returns "no-promote" when Layer 2 returns zero facts; does not run Layer 3', async () => {
    consolidate.mockResolvedValue({
      facts: [],
      task: { id: 'task_1', projectId: 'proj_1', workspaceId: 'ws_1' },
    })
    const result = await promoteTaskService.promoteTaskMemory('task_1')
    expect(result).toEqual({ outcome: 'no-promote' })
    expect(layer3Input).not.toHaveBeenCalled()
    expect(layer3Extract).not.toHaveBeenCalled()
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it('returns "applied" + runs Layer 3 inside a transaction', async () => {
    consolidate.mockResolvedValue({
      facts: [
        {
          category: 'TRAP',
          content: {
            trigger: 'x',
            outcome: 'y',
            workaround: 'z',
          },
        },
      ],
      task: { id: 'task_1', projectId: 'proj_1', workspaceId: 'ws_1' },
    })
    layer3Input.mockResolvedValue({
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      distilledFacts: [],
      existingProjectMemories: [],
    })
    layer3Extract.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y', workaround: 'z' },
      },
    ])

    const result = await promoteTaskService.promoteTaskMemory('task_1')

    expect(result.outcome).toBe('applied')
    expect(result.layer3).toBeDefined()
    expect(tx.$transaction).toHaveBeenCalledTimes(1)
  })

  it('fire-and-forget contract: when the apply throws, returns "skipped"', async () => {
    consolidate.mockResolvedValue({
      facts: [
        {
          category: 'TRAP',
          content: { trigger: 'x', outcome: 'y' },
        },
      ],
      task: { id: 'task_1', projectId: 'proj_1', workspaceId: 'ws_1' },
    })
    layer3Input.mockResolvedValue({
      projectId: 'proj_1',
      workspaceId: 'ws_1',
      distilledFacts: [],
      existingProjectMemories: [],
    })
    layer3Extract.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
      },
    ])
    tx.$transaction.mockRejectedValueOnce(new Error('apply failed'))

    const result = await promoteTaskService.promoteTaskMemory('task_1')

    expect(result).toEqual({ outcome: 'skipped' })
  })

  it('fire-and-forget contract: never throws even if Layer 2 itself errors', async () => {
    consolidate.mockRejectedValue(new Error('layer 2 boom'))
    await expect(
      promoteTaskService.promoteTaskMemory('task_1')
    ).resolves.toEqual({ outcome: 'skipped' })
  })
})
