/**
 * @jest-environment node
 *
 * Black-box test for the layer2 orchestrator: verifies skip-paths
 * (no input) and that the task ids are forwarded to the caller for use
 * by Layer 3.
 */
jest.mock('@/lib/services/memory/layer2-input', () => ({
  getLayer2Input: jest.fn(),
}))
jest.mock('@/lib/services/memory/layer2-extract', () => ({
  extractLayer2Facts: jest.fn(),
}))

import { getLayer2Input } from '@/lib/services/memory/layer2-input'
import { extractLayer2Facts } from '@/lib/services/memory/layer2-extract'
import { layer2Service } from '@/lib/services/memory/layer2.service'

const getInput = getLayer2Input as jest.MockedFunction<typeof getLayer2Input>
const extract = extractLayer2Facts as jest.MockedFunction<
  typeof extractLayer2Facts
>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('layer2Service.consolidateTaskMemory', () => {
  it('returns null facts + null task when getLayer2Input returns null (task gone or no active memory)', async () => {
    getInput.mockResolvedValue(null)
    const result = await layer2Service.consolidateTaskMemory('task_1')
    expect(result).toEqual({ facts: null, task: null })
    expect(extract).not.toHaveBeenCalled()
  })

  it('returns the distilled facts and task ids on the happy path', async () => {
    getInput.mockResolvedValue({
      task: {
        id: 'task_1',
        title: 't',
        description: null,
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      },
      taskMemories: [{ id: 'mem_a', category: 'TRAP', content: {} }],
    })
    extract.mockResolvedValue([
      {
        category: 'CONVENTION',
        content: { rule: 'use Zod', scope: 'all endpoints' },
      },
    ])

    const result = await layer2Service.consolidateTaskMemory('task_1')

    expect(result.task).toEqual({
      id: 'task_1',
      projectId: 'proj_1',
      workspaceId: 'ws_1',
    })
    expect(result.facts).toHaveLength(1)
    expect(result.facts?.[0]?.category).toBe('CONVENTION')
  })

  it('returns an empty facts array when extraction yields no facts (still returns task ids)', async () => {
    // Empty facts is a successful distillation — not a skip. The promote-
    // task orchestrator distinguishes this from `facts: null` and uses it
    // to return the "no-promote" outcome.
    getInput.mockResolvedValue({
      task: {
        id: 'task_1',
        title: 't',
        description: null,
        projectId: 'proj_1',
        workspaceId: 'ws_1',
      },
      taskMemories: [{ id: 'mem_a', category: 'TRAP', content: {} }],
    })
    extract.mockResolvedValue([])

    const result = await layer2Service.consolidateTaskMemory('task_1')

    expect(result.facts).toEqual([])
    expect(result.task).not.toBeNull()
  })
})
