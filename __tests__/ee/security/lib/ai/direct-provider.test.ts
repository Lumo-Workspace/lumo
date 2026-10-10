/**
 * @jest-environment node
 */
/**
 * LUM-1064: plugin half of __tests__/lib/ai/direct-provider.test.ts (split)
 *
 * (Only the stub-free evaluation case lives here; the HTTP stub stays in the
 * core half.)
 *
 * LUM-1019 — the real `lib/ai/gateway` router on the direct route, end to end
 * against a local HTTP stub that speaks the Anthropic Messages and the
 * OpenAI-compatible chat/embeddings wire formats. No real provider is called.
 * Also: the unconfigured route throws a typed error instead of crashing, and
 * the gateway route keeps ZDR even when a provider key is present.
 */
const AI_ENV_KEYS = [
  'AI_PROVIDER',
  'AI_GATEWAY_API_KEY',
  'VERCEL',
  'VERCEL_OIDC_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_MODEL',
  'OPENAI_COMPATIBLE_EMBEDDING_MODEL',
  'OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS',
]

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of AI_ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of AI_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('unconfigured route', () => {
  it('evaluation models refuse to run off the gateway', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    const { evaluateBoolean, EvaluationError } =
      await import('@/lib/ai/evaluation')
    const fetchImpl = jest.fn()
    await expect(
      evaluateBoolean(
        {
          model: 'typesafe-ai/jev',
          state: 's',
          instructions: 'i',
          criteria: { true: 't', false: 'f' },
          timeoutMs: 1000,
        },
        fetchImpl as unknown as typeof fetch
      )
    ).rejects.toBeInstanceOf(EvaluationError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
