/**
 * @jest-environment node
 *
 * Regression test for the Layer 2 consolidation concurrency race.
 *
 * In production, every task→DONE transition fires layer2 consolidation via
 * `waitUntil(...)` (task-state.service.ts). Without serialization two
 * completions in the same project run concurrently, each reads a PROJECT-scope
 * snapshot BEFORE its multi-second LLM call, so both independently decide a
 * recurring lesson "isn't promoted yet" and both ADD it — producing two
 * differently-worded duplicate PROJECT memories.
 *
 * The fix is a per-project DB lease: only one run proceeds at a time. This
 * test drives the REAL pipeline (getLayer2Input + applyLayer2Operations)
 * against an in-memory repository; only the LLM step is mocked.
 */
jest.mock('@/lib/services/memory/layer2-extract', () => ({
  extractLayer2Operations: jest.fn(),
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findById: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveProjectMemories: jest.fn(),
    findRecentTaskScopeMemoriesByProject: jest.fn(),
    create: jest.fn(),
    applyPlansAtomically: jest.fn(),
    tryClaimLayer2Lease: jest.fn(),
    releaseLayer2Lease: jest.fn(),
  },
}))

import { layer2Service } from '@/lib/services/memory/layer2.service'
import { extractLayer2Operations } from '@/lib/services/memory/layer2-extract'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import type { Layer2Operation } from '@/lib/services/memory/layer2-extract'
import type { Layer2Input } from '@/lib/services/memory/layer2-input'

const mockExtract = extractLayer2Operations as jest.MockedFunction<
  typeof extractLayer2Operations
>
const mockProjectRepo = projectRepository as jest.Mocked<
  typeof projectRepository
>
const mockRepo = memoryRepository as jest.Mocked<typeof memoryRepository>

// Same lesson, two different tasks → satisfies the "recurrence" promotion bar.
const RECURRING_TASK_MEMORIES = [
  {
    id: 't1',
    category: 'TRAP' as const,
    content: {
      trigger: 'Ambiguous identifier resolution in CLI.',
      outcome: 'wrong resource',
    },
    taskId: 'task_1',
    createdAt: new Date(0),
  },
  {
    id: 't2',
    category: 'TRAP' as const,
    content: {
      trigger: 'Ambiguous reference resolution in API route.',
      outcome: 'wrong entity',
    },
    taskId: 'task_2',
    createdAt: new Date(0),
  },
]

describe('layer2 consolidation — concurrent task completions', () => {
  let projectStore: Array<{ content: unknown }>
  let leaseHeld: boolean

  // Barrier: hold the LLM call(s) until either both runs have reached the LLM
  // (the un-serialized race) or one run is denied the lease (the fix). This
  // forces the race deterministically without deadlocking once a lease blocks
  // the second run before it ever reaches the LLM.
  let releaseBarrier!: () => void
  let barrier: Promise<void>
  let arrivals: number

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    projectStore = []
    leaseHeld = false
    arrivals = 0
    barrier = new Promise<void>(resolve => {
      releaseBarrier = resolve
    })

    mockProjectRepo.findById.mockResolvedValue({
      id: 'proj_1',
      name: 'Test Project',
      workspaceId: 'ws_1',
    } as never)

    mockRepo.findRecentTaskScopeMemoriesByProject.mockResolvedValue(
      RECURRING_TASK_MEMORIES as never
    )

    // Reads the CURRENT shared store — this is the snapshot fed to the LLM.
    mockRepo.findActiveProjectMemories.mockImplementation(
      async () =>
        projectStore.map((row, i) => ({
          id: `proj_mem_${i}`,
          category: 'TRAP',
          content: row.content,
          createdAt: new Date(0),
        })) as never
    )

    mockRepo.create.mockImplementation(async (input: { content: unknown }) => {
      projectStore.push({ content: input.content })
      return { id: `proj_mem_${projectStore.length}` } as never
    })

    mockRepo.applyPlansAtomically.mockImplementation(async plans => {
      for (const plan of plans) await plan({} as never)
    })

    // In-memory lease. The claim body runs synchronously before any await, so
    // the first caller wins and the second is denied — deterministic.
    mockRepo.tryClaimLayer2Lease.mockImplementation(async () => {
      if (leaseHeld) {
        releaseBarrier() // unblock the holder; the denied run won't reach it
        return false
      }
      leaseHeld = true
      return true
    })
    mockRepo.releaseLayer2Lease.mockImplementation(async () => {
      leaseHeld = false
    })

    mockExtract.mockImplementation(async (input: Layer2Input) => {
      arrivals += 1
      const myIndex = arrivals
      if (arrivals >= 2) releaseBarrier() // un-serialized: both reached the LLM
      await barrier

      // Faithful LLM behavior: NOOP if the lesson is already in the snapshot;
      // otherwise promote it (each run synthesizes its own wording).
      const alreadyPromoted = input.existingProjectMemories.some(
        m => m.category === 'TRAP'
      )
      if (alreadyPromoted) return [{ type: 'NOOP' }] as Layer2Operation[]
      return [
        {
          type: 'ADD',
          category: 'TRAP',
          content: {
            trigger: `Ambiguous identifier resolution lesson (synthesis #${myIndex}).`,
            outcome: 'Resolves to the wrong resource.',
          },
        },
      ] as Layer2Operation[]
    })
  })

  it('promotes a recurring lesson exactly once even when two runs race', async () => {
    await Promise.all([
      layer2Service.runForProject('proj_1'),
      layer2Service.runForProject('proj_1'),
    ])

    expect(projectStore).toHaveLength(1)
  })
})
