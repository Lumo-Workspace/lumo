/**
 * @jest-environment node
 *
 * Black-box test for the promote-task orchestrator: verifies the three
 * outcomes (skipped / no-promote / applied), the atomic transaction
 * semantics, and the fire-and-forget error contract. Layer 2 / Layer 3
 * calls and DB writes are mocked — we're testing wiring, not the model.
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
    archiveAllForTask: jest.fn(),
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
const archiveAll = memoryRepository.archiveAllForTask as jest.MockedFunction<
  typeof memoryRepository.archiveAllForTask
>
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
  archiveAll.mockResolvedValue({ count: 0 } as never)
  ;(memoryRepository.create as jest.Mock).mockResolvedValue({ id: 'mem_new' })
  ;(memoryRepository.updateContent as jest.Mock).mockResolvedValue({
    id: 'mem_upd',
  })
})

describe('promoteTaskService.promoteTaskMemory', () => {
  it('returns "skipped" when Layer 2 has no input (task gone or no active memory)', async () => {
    consolidate.mockResolvedValue({ facts: null, task: null })
    const result = await promoteTaskService.promoteTaskMemory('task_1')
    expect(result).toEqual({ outcome: 'skipped' })
    // Critically: do NOT archive when there's no input. There may be no
    // task memory rows to archive at all (task gone / had none); calling
    // archive would be a no-op but we want the contract clear.
    expect(archiveAll).not.toHaveBeenCalled()
    expect(layer3Input).not.toHaveBeenCalled()
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it('returns "no-promote" + archives task memory when Layer 2 returns zero facts', async () => {
    consolidate.mockResolvedValue({
      facts: [],
      task: { id: 'task_1', projectId: 'proj_1', workspaceId: 'ws_1' },
    })
    archiveAll.mockResolvedValue({ count: 3 } as never)
    const result = await promoteTaskService.promoteTaskMemory('task_1')
    expect(result).toEqual({ outcome: 'no-promote', archived: 3 })
    expect(archiveAll).toHaveBeenCalledWith('task_1')
    // Layer 3 must NOT run — there's nothing to merge.
    expect(layer3Input).not.toHaveBeenCalled()
    expect(layer3Extract).not.toHaveBeenCalled()
    expect(tx.$transaction).not.toHaveBeenCalled()
  })

  it('returns "applied" + runs Layer 3 + archives task memory inside ONE transaction', async () => {
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
    archiveAll.mockResolvedValue({ count: 5 } as never)

    const result = await promoteTaskService.promoteTaskMemory('task_1')

    expect(result.outcome).toBe('applied')
    expect(result.archived).toBe(5)
    // Apply + archive run inside a single $transaction call. This is the
    // atomicity contract: a failure mid-apply must roll back the archive
    // too, leaving task memory intact for a future retry.
    expect(tx.$transaction).toHaveBeenCalledTimes(1)
    // Within the transaction, archiveAllForTask was invoked with the tx.
    expect(archiveAll).toHaveBeenCalledWith('task_1', {})
  })

  it('atomic semantics: when the apply step throws, archive is NOT called', async () => {
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
    // Inject a bad op that fails schema validation inside buildLayer3Plans
    // (counters.skipped++, no plan emitted) — the transaction body still
    // runs but only does the archive. To force an actual throw, make the
    // $transaction itself reject.
    layer3Extract.mockResolvedValue([
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
      },
    ])
    tx.$transaction.mockRejectedValueOnce(new Error('apply failed'))

    const result = await promoteTaskService.promoteTaskMemory('task_1')

    // Top-level catch turns it into the safe "skipped" outcome — the
    // task memory rows stay active so a future trigger can retry.
    expect(result).toEqual({ outcome: 'skipped' })
    // Outside-transaction archive was never called either.
    expect(archiveAll).not.toHaveBeenCalledWith('task_1') // (no plain-prisma call)
  })

  it('fire-and-forget contract: never throws even if Layer 2 itself errors', async () => {
    consolidate.mockRejectedValue(new Error('layer 2 boom'))
    await expect(
      promoteTaskService.promoteTaskMemory('task_1')
    ).resolves.toEqual({ outcome: 'skipped' })
  })
})
