/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: jest.fn(),
    updateContent: jest.fn(),
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'
import { buildLayer3Plans } from '@/lib/services/memory/layer3-apply'
import type { Layer3Operation } from '@/lib/services/memory/layer3-extract'

const repo = memoryRepository as jest.Mocked<typeof memoryRepository>
const tx = {} as never

const baseInput = {
  projectId: 'proj_1',
  workspaceId: 'ws_1',
  existingMemories: [
    { id: 'mem_trap', category: 'TRAP' as const },
    { id: 'mem_convention', category: 'CONVENTION' as const },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  repo.create.mockResolvedValue({ id: 'new_mem' } as never)
  repo.updateContent.mockResolvedValue({ id: 'updated' } as never)
})

async function runPlans(
  plans: ReturnType<typeof buildLayer3Plans>['plans']
): Promise<void> {
  for (const p of plans) await p(tx)
}

describe('buildLayer3Plans', () => {
  it('counts NOOP without scheduling any writes', async () => {
    const ops: Layer3Operation[] = [{ type: 'NOOP' }, { type: 'NOOP' }]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(0)
    expect(counters).toEqual({ added: 0, updated: 0, noop: 2, skipped: 0 })
  })

  it('writes ADD with scope=PROJECT, taskId=null, sourceSessionId=null', async () => {
    const ops: Layer3Operation[] = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: {
          trigger: 'enum mid-migration',
          outcome: 'P3009',
          workaround: 'split migrations',
        },
      },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(1)
    await runPlans(plans)
    expect(counters.added).toBe(1)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj_1',
        workspaceId: 'ws_1',
        scope: 'PROJECT',
        taskId: null,
        sourceSessionId: null,
        category: 'TRAP',
      }),
      expect.anything()
    )
  })

  it('drops ADD whose content fails the per-category Zod schema', async () => {
    const ops: Layer3Operation[] = [
      { type: 'ADD', category: 'TRAP', content: { foo: 'bar' } },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(0)
    expect(counters).toEqual({ added: 0, updated: 0, noop: 0, skipped: 1 })
  })

  it('updates an existing memory with content validated against its existing category', async () => {
    const ops: Layer3Operation[] = [
      {
        type: 'UPDATE',
        id: 'mem_trap',
        content: {
          trigger: 'enum mid-migration (refined)',
          outcome: 'P3009 — resolve does not unstick',
          workaround: 'two migrations, split the value add',
        },
      },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(1)
    await runPlans(plans)
    expect(counters.updated).toBe(1)
    expect(repo.updateContent).toHaveBeenCalledWith(
      'mem_trap',
      expect.objectContaining({ trigger: expect.any(String) }),
      expect.anything()
    )
  })

  it('drops UPDATE pointing at an unknown id (row may have been deleted concurrently)', async () => {
    const ops: Layer3Operation[] = [
      { type: 'UPDATE', id: 'mem_gone', content: { what: 'x', why: 'y' } },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(0)
    expect(counters).toEqual({ added: 0, updated: 0, noop: 0, skipped: 1 })
  })

  it('drops UPDATE whose content fails the existing memory category schema (cross-category content)', async () => {
    // mem_trap's category is TRAP. Content shaped like a CONVENTION
    // ({rule, scope}) does NOT pass the TRAP schema — UPDATE is dropped.
    // This is the firewall against "LLM emits UPDATE with content shaped
    // for a different category."
    const ops: Layer3Operation[] = [
      {
        type: 'UPDATE',
        id: 'mem_trap',
        content: { rule: 'use Zod', scope: 'all endpoints' },
      },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    expect(plans).toHaveLength(0)
    expect(counters).toEqual({ added: 0, updated: 0, noop: 0, skipped: 1 })
    expect(repo.updateContent).not.toHaveBeenCalled()
  })

  it('Case D: same-shape UPDATE is currently NOT detected as effective NOOP — documented Day 4+ followup', async () => {
    // Adversarial scenario from Day 3 dogfood: when the LLM emits an UPDATE
    // whose content is *functionally equivalent* to the existing memory
    // (same trigger / outcome / workaround, no new information), the apply
    // step does NOT short-circuit it to NOOP — the row is rewritten with
    // identical content. This is documented as a non-safety boundary
    // (content unchanged in meaning) and tracked as a Day 4+ polish:
    // detect effective NOOP and convert to NOOP to keep counters honest.
    //
    // This test pins the CURRENT behavior so a future "convert to NOOP"
    // change is intentional and will fail-loud here. If/when we add
    // semantic-equivalence detection, flip this assertion.
    const equivalentContent = {
      trigger: 'enum mid-migration',
      outcome: 'P3009',
      workaround: 'split migrations',
    }
    const ops: Layer3Operation[] = [
      { type: 'UPDATE', id: 'mem_trap', content: equivalentContent },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    await runPlans(plans)
    expect(counters.updated).toBe(1)
    expect(counters.noop).toBe(0)
    expect(repo.updateContent).toHaveBeenCalledTimes(1)
  })

  it('mixes ADD / UPDATE / NOOP / skipped in a single batch', async () => {
    const ops: Layer3Operation[] = [
      {
        type: 'ADD',
        category: 'CONVENTION',
        content: { rule: 'use Zod', scope: 'all endpoints' },
      },
      {
        type: 'UPDATE',
        id: 'mem_convention',
        content: { rule: 'refined', scope: 'all endpoints' },
      },
      { type: 'NOOP' },
      { type: 'UPDATE', id: 'mem_unknown', content: { rule: 'x', scope: 'y' } },
    ]
    const { plans, counters } = buildLayer3Plans({
      ...baseInput,
      operations: ops,
    })
    await runPlans(plans)
    expect(counters).toEqual({ added: 1, updated: 1, noop: 1, skipped: 1 })
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.updateContent).toHaveBeenCalledTimes(1)
  })
})
