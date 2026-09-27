/**
 * @jest-environment node
 *
 * LUM-590 — unit tests for the crossing-explain-client LLM wrapper.
 * The AI SDK (generateObject + gateway) is mocked to avoid real network calls.
 */

// Dynamic import required: static import of @ai-sdk/gateway explodes in jest
// (TransformStream is not defined — known jest trap, project_ai_sdk_gateway_jest_trap.md).
const mockGenerateObject = jest.fn()
const mockGateway = jest.fn((id: string) => `gateway:${id}`)

jest.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))
jest.mock('@/lib/ai/gateway', () => ({
  gateway: (id: string) => mockGateway(id),
}))
// Models module is a pure string constants file — no gateway import.
// crossing-explain rides 桶2 GENERATION (deepseek-v4-pro) per the LUM-588 repoint.
jest.mock('@/lib/ai/models', () => ({
  GENERATION_MODEL: 'deepseek/deepseek-v4-pro',
}))

describe('explainCrossing (LUM-590)', () => {
  let explainCrossing: (typeof import('@/lib/llm/crossing-explain-client'))['explainCrossing']

  beforeEach(async () => {
    jest.clearAllMocks()
    // Dynamic import after mocks are in place.
    const mod = await import('@/lib/llm/crossing-explain-client')
    explainCrossing = mod.explainCrossing
  })

  it('returns { explanation } from the LLM schema', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { explanation: 'The agent ran a command that matched the rule.' },
    })

    const result = await explainCrossing({
      rule: 'No destructive DB commands',
      evidence: 'DROP TABLE users',
      category: 'PROJECT_RULE_VIOLATION',
      severity: 'HIGH',
      agentContext: 'Attempted to clean up test data',
    })

    expect(result).toEqual({
      explanation: 'The agent ran a command that matched the rule.',
    })
    expect(mockGenerateObject).toHaveBeenCalledTimes(1)
    // Confirm model is passed to gateway
    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(callArgs.model).toBe('gateway:deepseek/deepseek-v4-pro')
  })

  it('builds prompt correctly without optional fields', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { explanation: 'Minimal explanation.' },
    })

    await explainCrossing({
      rule: null,
      evidence: 'some command',
      category: 'TEST_TAMPERING',
      severity: 'MEDIUM',
      agentContext: null,
    })

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<
      string,
      unknown
    >
    const prompt = callArgs.prompt as string
    // rule and agentContext are absent when null
    expect(prompt).not.toContain('rule:')
    expect(prompt).not.toContain('agentContext:')
    expect(prompt).toContain('evidence: some command')
    expect(prompt).toContain('category: TEST_TAMPERING')
  })

  it('propagates LLM errors to the caller', async () => {
    mockGenerateObject.mockRejectedValue(new Error('network timeout'))

    await expect(
      explainCrossing({
        rule: null,
        evidence: 'x',
        category: 'DB_DIRECT',
        severity: 'HIGH',
        agentContext: null,
      })
    ).rejects.toThrow('network timeout')
  })
})
