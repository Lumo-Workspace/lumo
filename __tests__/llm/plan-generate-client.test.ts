/**
 * @jest-environment node
 */
jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import { generateObject } from 'ai'
import {
  callPlanGenerateLLM,
  selectClustersForPlanning,
  buildPlanGeneratePrompt,
  PlanGenerateSchema,
  PLAN_GENERATE_SYSTEM_PROMPT,
  type AlignedCluster,
  type ClusterPlanDraft,
} from '@/lib/llm/plan-generate-client'

const mockGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Fixtures ────────────────────────────────────────────────────────────────

function cluster(
  over: Partial<AlignedCluster> & { clusterId: string }
): AlignedCluster {
  return {
    label: 'ALIGNED',
    starred: false,
    theme: 'some theme',
    ideas: ['idea a', 'idea b'],
    ...over,
  }
}

function draft(clusterId: string, taskCount = 5): ClusterPlanDraft {
  return {
    clusterId,
    goalStatement: `goal for ${clusterId}`,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      title: `task ${i}`,
      why: `because ${i}`,
      size: 'M' as const,
    })),
    assumptionNote: 'the bet is X',
  }
}

// ── selectClustersForPlanning ───────────────────────────────────────────────

describe('selectClustersForPlanning', () => {
  it('keeps only starred ALIGNED clusters', () => {
    const clusters = [
      cluster({ clusterId: 'c1', starred: true, label: 'ALIGNED' }),
      cluster({ clusterId: 'c2', starred: false, label: 'ALIGNED' }), // unstarred
      cluster({ clusterId: 'c3', starred: true, label: 'UNRELATED' }), // wrong label
      cluster({ clusterId: 'c4', starred: true, label: 'CONFLICT' }), // wrong label
    ]
    const selected = selectClustersForPlanning(clusters)
    expect(selected.map(c => c.clusterId)).toEqual(['c1'])
  })

  it('caps the selection at the top 2 (input order)', () => {
    const clusters = [
      cluster({ clusterId: 'c1', starred: true, label: 'ALIGNED' }),
      cluster({ clusterId: 'c2', starred: true, label: 'ALIGNED' }),
      cluster({ clusterId: 'c3', starred: true, label: 'ALIGNED' }),
    ]
    const selected = selectClustersForPlanning(clusters)
    expect(selected.map(c => c.clusterId)).toEqual(['c1', 'c2'])
  })

  it('returns [] when nothing qualifies', () => {
    const clusters = [
      cluster({ clusterId: 'c1', starred: false, label: 'ALIGNED' }),
      cluster({ clusterId: 'c2', starred: true, label: 'CONFLICT' }),
    ]
    expect(selectClustersForPlanning(clusters)).toEqual([])
  })
})

// ── PlanGenerateSchema ──────────────────────────────────────────────────────

describe('PlanGenerateSchema', () => {
  it('accepts a well-formed draft (4-8 tasks, S/M/L sizes, all fields + prose)', () => {
    const ok = {
      drafts: [draft('c1', 4), draft('c2', 8)],
      prose: 'here is the recommendation',
    }
    expect(PlanGenerateSchema.safeParse(ok).success).toBe(true)
  })

  it('rejects a draft with fewer than 4 tasks', () => {
    const bad = { drafts: [draft('c1', 3)], prose: 'p' }
    expect(PlanGenerateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a draft with more than 8 tasks', () => {
    const bad = { drafts: [draft('c1', 9)], prose: 'p' }
    expect(PlanGenerateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a task size outside S|M|L', () => {
    const d = draft('c1', 4)
    ;(d.tasks[0] as { size: string }).size = 'XL'
    expect(
      PlanGenerateSchema.safeParse({ drafts: [d], prose: 'p' }).success
    ).toBe(false)
  })

  it('rejects a draft missing the assumptionNote', () => {
    const d = draft('c1', 4) as Partial<ClusterPlanDraft>
    delete d.assumptionNote
    expect(
      PlanGenerateSchema.safeParse({ drafts: [d], prose: 'p' }).success
    ).toBe(false)
  })

  it('rejects an output missing the prose field', () => {
    expect(
      PlanGenerateSchema.safeParse({ drafts: [draft('c1')] }).success
    ).toBe(false)
  })
})

// ── callPlanGenerateLLM ─────────────────────────────────────────────────────

describe('callPlanGenerateLLM', () => {
  it('short-circuits without calling the LLM when no cluster qualifies', async () => {
    const result = await callPlanGenerateLLM({
      priority: null,
      clusters: [
        cluster({ clusterId: 'c1', starred: false, label: 'ALIGNED' }),
      ],
    })
    expect(mockGenerateObject).not.toHaveBeenCalled()
    expect(result.drafts).toEqual([])
    expect(result.prose).toBe('')
  })

  it('only feeds the starred ALIGNED clusters into the prompt', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { drafts: [draft('c1')], prose: 'p' },
    } as never)

    await callPlanGenerateLLM({
      priority: 'ship the capture flow first',
      clusters: [
        cluster({
          clusterId: 'c1',
          starred: true,
          label: 'ALIGNED',
          theme: 'capture theme',
        }),
        cluster({
          clusterId: 'c2',
          starred: false,
          label: 'ALIGNED',
          theme: 'unstarred theme',
        }),
        cluster({
          clusterId: 'c3',
          starred: true,
          label: 'CONFLICT',
          theme: 'conflict theme',
        }),
      ],
    })

    const arg = mockGenerateObject.mock.calls[0]![0] as { prompt: string }
    expect(arg.prompt).toContain('capture theme')
    expect(arg.prompt).toContain('ship the capture flow first')
    // Non-qualifying clusters never reach the model.
    expect(arg.prompt).not.toContain('unstarred theme')
    expect(arg.prompt).not.toContain('conflict theme')
  })

  it('drops any draft the model emits for a non-selected cluster', async () => {
    // The model hallucinates an extra draft for a cluster we never selected.
    mockGenerateObject.mockResolvedValueOnce({
      object: { drafts: [draft('c1'), draft('c-bogus')], prose: 'p' },
    } as never)

    const result = await callPlanGenerateLLM({
      priority: null,
      clusters: [cluster({ clusterId: 'c1', starred: true, label: 'ALIGNED' })],
    })

    expect(result.drafts.map(d => d.clusterId)).toEqual(['c1'])
    expect(result.prose).toBe('p')
  })

  it('never produces more drafts than the ≤2 cap', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        drafts: [draft('c1'), draft('c2'), draft('c3')],
        prose: 'p',
      },
    } as never)

    const result = await callPlanGenerateLLM({
      priority: null,
      clusters: [
        cluster({ clusterId: 'c1', starred: true, label: 'ALIGNED' }),
        cluster({ clusterId: 'c2', starred: true, label: 'ALIGNED' }),
        cluster({ clusterId: 'c3', starred: true, label: 'ALIGNED' }),
      ],
    })

    // c3 was capped out of the selection, so its draft is discarded.
    expect(result.drafts.map(d => d.clusterId).sort()).toEqual(['c1', 'c2'])
    expect(result.drafts.length).toBeLessThanOrEqual(2)
  })
})

// ── system prompt / prose tone ──────────────────────────────────────────────

describe('PLAN_GENERATE_SYSTEM_PROMPT', () => {
  it('frames the prose as an advisor recommendation with the required beats', () => {
    const p = PLAN_GENERATE_SYSTEM_PROMPT.toLowerCase()
    expect(p).toContain('advisor')
    // overview -> why first -> what to shelve -> customization warnings
    expect(p).toMatch(/overview|总述/)
    expect(p).toMatch(/shelve|defer|放/)
    expect(p).toMatch(/customi[sz]ation|定制/)
    expect(p).toMatch(/assumption|赌注|bet/)
  })
})

describe('buildPlanGeneratePrompt', () => {
  it('renders the priority and every selected cluster with its ideas', () => {
    const prompt = buildPlanGeneratePrompt('do A before B', [
      cluster({
        clusterId: 'c1',
        starred: true,
        theme: 'onboarding',
        ideas: ['add tour', 'add tooltips'],
      }),
    ])
    expect(prompt).toContain('do A before B')
    expect(prompt).toContain('onboarding')
    expect(prompt).toContain('add tour')
    expect(prompt).toContain('add tooltips')
  })

  it('notes when no team priority is set', () => {
    const prompt = buildPlanGeneratePrompt(null, [
      cluster({ clusterId: 'c1', starred: true }),
    ])
    expect(prompt.toLowerCase()).toMatch(/no.*priority|priority.*not set/)
  })
})
