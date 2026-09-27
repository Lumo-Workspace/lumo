/**
 * @jest-environment node
 *
 * LUM-666 — Spec2-4 Stage2 alignment LLM client (plan-align-client).
 * The AI SDK (generateObject + gateway) is mocked to avoid real network calls.
 */

// Dynamic import required: a static import of @ai-sdk/gateway explodes in jest
// (TransformStream is not defined — known jest trap). Mocks are installed first,
// then the client is dynamic-imported inside beforeEach.
const mockGenerateObject = jest.fn()
const mockGateway = jest.fn((id: string) => `gateway:${id}`)

jest.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: (id: string) => mockGateway(id),
}))
// Stage2 alignment is a judgment call → 桶1 VERIFIER tier (REASONING_MODEL).
jest.mock('@/lib/ai/models', () => ({
  REASONING_MODEL: 'openai/gpt-5.5',
}))

import type {
  PlanAlignInput,
  PlanAlignResult,
} from '@/lib/llm/plan-align-client'

describe('alignClusters (LUM-666)', () => {
  let alignClusters: (input: PlanAlignInput) => Promise<PlanAlignResult>

  beforeEach(async () => {
    jest.clearAllMocks()
    const mod = await import('@/lib/llm/plan-align-client')
    alignClusters = mod.alignClusters
  })

  const twoClusters: PlanAlignInput = {
    priority: 'Ship the self-serve onboarding flow this quarter.',
    clusters: [
      {
        clusterId: 'c1',
        label: 'Faster signup',
        items: ['One-click Google signup', 'Skip the email confirmation step'],
      },
      {
        clusterId: 'c2',
        label: 'Acme custom export',
        items: ['Acme wants a bespoke CSV export format'],
      },
    ],
  }

  it('conforms to schema and preserves the customizationTrap flag through to the output', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            rationale:
              'Removes signup friction, directly serving self-serve onboarding.',
            customizationTrap: false,
          },
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            rationale:
              'Single-customer request (Acme); park it — one-off customization risk.',
            customizationTrap: true,
          },
        ],
      },
    })

    const result = await alignClusters(twoClusters)

    expect(result.clusters).toHaveLength(2)
    // verdict enum + shape
    expect(result.clusters[0]).toEqual({
      clusterId: 'c1',
      verdict: 'ALIGNED',
      rationale: expect.any(String),
      customizationTrap: false,
    })
    // customizationTrap:true survives to the output untouched
    const c2 = result.clusters[1]!
    expect(c2.clusterId).toBe('c2')
    expect(c2.customizationTrap).toBe(true)
    // priority present → declared
    expect(result.priorityDeclared).toBe(true)
  })

  it('routes to the REASONING_MODEL via the gateway with the align schema', async () => {
    mockGenerateObject.mockResolvedValue({ object: { clusters: [] } })

    await alignClusters(twoClusters)

    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(callArgs.model).toBe('gateway:openai/gpt-5.5')
    expect(callArgs.schema).toBeDefined()
    expect(typeof callArgs.system).toBe('string')
  })

  it('includes the priority text and every cluster in the prompt', async () => {
    mockGenerateObject.mockResolvedValue({ object: { clusters: [] } })

    await alignClusters(twoClusters)

    const prompt = (
      mockGenerateObject.mock.calls[0][0] as Record<string, unknown>
    ).prompt as string
    expect(prompt).toContain(
      'Ship the self-serve onboarding flow this quarter.'
    )
    expect(prompt).toContain('c1')
    expect(prompt).toContain('Faster signup')
    expect(prompt).toContain('One-click Google signup')
    expect(prompt).toContain('c2')
    expect(prompt).toContain('Acme wants a bespoke CSV export format')
  })

  it('flags priority as undeclared (null) and signals it to the model', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'UNRELATED',
            rationale: 'Team priority is undeclared; cannot assess alignment.',
            customizationTrap: false,
          },
        ],
      },
    })

    const result = await alignClusters({
      priority: null,
      clusters: [{ clusterId: 'c1', label: 'Faster signup', items: ['x'] }],
    })

    expect(result.priorityDeclared).toBe(false)
    const prompt = (
      mockGenerateObject.mock.calls[0][0] as Record<string, unknown>
    ).prompt as string
    expect(prompt.toLowerCase()).toContain('undeclared')
  })

  it('treats a blank/whitespace priority as undeclared', async () => {
    mockGenerateObject.mockResolvedValue({ object: { clusters: [] } })

    const result = await alignClusters({
      priority: '   ',
      clusters: [{ clusterId: 'c1', label: 'x', items: ['y'] }],
    })

    expect(result.priorityDeclared).toBe(false)
  })

  it('propagates LLM errors to the caller', async () => {
    mockGenerateObject.mockRejectedValue(new Error('network timeout'))

    await expect(
      alignClusters({
        priority: 'p',
        clusters: [{ clusterId: 'c1', label: 'x', items: ['y'] }],
      })
    ).rejects.toThrow('network timeout')
  })
})
