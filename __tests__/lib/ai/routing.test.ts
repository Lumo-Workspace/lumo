/**
 * @jest-environment node
 */
/**
 * LUM-1019 — route selection (gateway / direct / none) and the mapping of
 * gateway-format model ids onto direct providers. Pure: no provider SDK.
 */
import {
  AiModelUnavailableError,
  AiNotConfiguredError,
  anthropicNativeModelId,
  directEmbeddingModelTarget,
  directLanguageModelTarget,
  isAiConfigured,
  isAiUnavailableError,
  resolveAiRoute,
  type AiRoute,
} from '@/lib/ai/routing'
import {
  CODE_REVIEW_MODEL,
  CONTENT_MODEL,
  FAST_MODEL,
  GENERATION_MODEL,
  HUNT_MODEL,
  MEMORY_JUDGE_MODEL,
  POLICY_COMPILER_MODEL,
  REASONING_MODEL,
  TRANSLATION_MODEL,
} from '@/lib/ai/models'

type Direct = Extract<AiRoute, { kind: 'direct' }>
const direct = (env: Record<string, string>): Direct => {
  const route = resolveAiRoute(env)
  if (route.kind !== 'direct')
    throw new Error(`expected direct, got ${route.kind}`)
  return route
}

describe('resolveAiRoute', () => {
  it('routes through the gateway whenever it is configured (SaaS unchanged)', () => {
    expect(resolveAiRoute({ AI_GATEWAY_API_KEY: 'k' })).toEqual({
      kind: 'gateway',
    })
    expect(resolveAiRoute({ VERCEL_OIDC_TOKEN: 't' })).toEqual({
      kind: 'gateway',
    })
    // Production on Vercel authenticates by OIDC at request time; VERCEL=1 is
    // the runtime signal.
    expect(resolveAiRoute({ VERCEL: '1' })).toEqual({ kind: 'gateway' })
    // A provider key in the same env does not pull SaaS off the gateway.
    expect(
      resolveAiRoute({
        VERCEL: '1',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
      })
    ).toEqual({ kind: 'gateway' })
  })

  it('routes direct with an Anthropic key and/or an OpenAI-compatible endpoint', () => {
    expect(resolveAiRoute({ ANTHROPIC_API_KEY: 'test-anthropic-key' })).toEqual(
      {
        kind: 'direct',
        anthropic: { apiKey: 'test-anthropic-key' },
      }
    )
    expect(
      resolveAiRoute({
        OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_COMPATIBLE_MODEL: 'llama3.1',
        OPENAI_COMPATIBLE_EMBEDDING_MODEL: 'bge-m3',
      })
    ).toEqual({
      kind: 'direct',
      openaiCompatible: {
        baseURL: 'http://localhost:11434/v1',
        model: 'llama3.1',
        embeddingModel: 'bge-m3',
        structuredOutputs: true,
      },
    })
    expect(
      direct({
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/v1',
        ANTHROPIC_MODEL: 'claude-haiku-4-5',
        OPENAI_COMPATIBLE_BASE_URL: 'https://api.openai.com/v1',
        OPENAI_COMPATIBLE_API_KEY: 'test-compat-key',
        OPENAI_COMPATIBLE_STRUCTURED_OUTPUTS: 'false',
      })
    ).toEqual({
      kind: 'direct',
      anthropic: {
        apiKey: 'test-anthropic-key',
        baseURL: 'http://127.0.0.1:9/v1',
        fallbackModel: 'claude-haiku-4-5',
      },
      openaiCompatible: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test-compat-key',
        structuredOutputs: false,
      },
    })
  })

  it('is "none" when nothing is configured; blank values count as unset', () => {
    expect(resolveAiRoute({})).toEqual({ kind: 'none' })
    expect(
      resolveAiRoute({ AI_GATEWAY_API_KEY: '', ANTHROPIC_API_KEY: '  ' })
    ).toEqual({ kind: 'none' })
    expect(isAiConfigured({})).toBe(false)
    expect(isAiConfigured({ ANTHROPIC_API_KEY: 'test-anthropic-key' })).toBe(
      true
    )
    expect(isAiConfigured({ AI_GATEWAY_API_KEY: 'k' })).toBe(true)
  })

  it('AI_PROVIDER overrides the automatic choice', () => {
    const both = {
      AI_GATEWAY_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
    }
    expect(resolveAiRoute({ ...both, AI_PROVIDER: 'direct' }).kind).toBe(
      'direct'
    )
    expect(resolveAiRoute({ ...both, AI_PROVIDER: 'NONE' }).kind).toBe('none')
    expect(
      resolveAiRoute({
        ANTHROPIC_API_KEY: 'test-anthropic-key',
        AI_PROVIDER: 'gateway',
      }).kind
    ).toBe('gateway')
    // direct forced but no provider configured → none, not a crash.
    expect(
      resolveAiRoute({ AI_GATEWAY_API_KEY: 'k', AI_PROVIDER: 'direct' })
    ).toEqual({ kind: 'none' })
    expect(() => resolveAiRoute({ AI_PROVIDER: 'openai' })).toThrow(
      /AI_PROVIDER must be gateway, direct or none/
    )
  })
})

describe('direct model id mapping', () => {
  it('anthropicNativeModelId turns the gateway version dot into a dash', () => {
    expect(anthropicNativeModelId('claude-sonnet-4.6')).toBe(
      'claude-sonnet-4-6'
    )
    expect(anthropicNativeModelId('claude-haiku-4-5')).toBe('claude-haiku-4-5')
  })

  it('maps Claude ids to Anthropic and strips the prefix for the OpenAI-compatible endpoint', () => {
    const route = direct({
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      OPENAI_COMPATIBLE_BASE_URL: 'https://api.openai.com/v1',
    })
    expect(directLanguageModelTarget(route, CODE_REVIEW_MODEL)).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
    })
    expect(directLanguageModelTarget(route, REASONING_MODEL)).toEqual({
      provider: 'openai-compatible',
      modelId: 'gpt-5.5',
    })
    expect(directLanguageModelTarget(route, GENERATION_MODEL)).toEqual({
      provider: 'openai-compatible',
      modelId: 'deepseek-v4-pro',
    })
    // An unprefixed id passes through unchanged.
    expect(directLanguageModelTarget(route, 'claude-opus-4.8')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-opus-4-8',
    })
    expect(directLanguageModelTarget(route, 'llama3.1')).toEqual({
      provider: 'openai-compatible',
      modelId: 'llama3.1',
    })
  })

  it('OPENAI_COMPATIBLE_MODEL serves every non-Claude id; Claude stays on Anthropic', () => {
    const route = direct({
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_COMPATIBLE_MODEL: 'llama3.1',
    })
    for (const id of [FAST_MODEL, HUNT_MODEL, CONTENT_MODEL, REASONING_MODEL])
      expect(directLanguageModelTarget(route, id)).toEqual({
        provider: 'openai-compatible',
        modelId: 'llama3.1',
      })
    expect(directLanguageModelTarget(route, CODE_REVIEW_MODEL).provider).toBe(
      'anthropic'
    )
    // Without an Anthropic key, a Claude id goes to the compatible endpoint.
    const compatOnly = direct({
      OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_COMPATIBLE_MODEL: 'llama3.1',
    })
    expect(directLanguageModelTarget(compatOnly, CODE_REVIEW_MODEL)).toEqual({
      provider: 'openai-compatible',
      modelId: 'llama3.1',
    })
  })

  it('Anthropic only: non-Claude ids need ANTHROPIC_MODEL, else a clear error', () => {
    const bare = direct({ ANTHROPIC_API_KEY: 'test-anthropic-key' })
    expect(() => directLanguageModelTarget(bare, GENERATION_MODEL)).toThrow(
      AiModelUnavailableError
    )
    expect(() => directLanguageModelTarget(bare, GENERATION_MODEL)).toThrow(
      /deepseek\/deepseek-v4-pro is not available.*ANTHROPIC_MODEL/
    )
    // The one Claude id in the registry still maps.
    expect(directLanguageModelTarget(bare, CODE_REVIEW_MODEL).modelId).toBe(
      'claude-sonnet-5-5'
    )

    const withFallback = direct({
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    })
    for (const id of [
      REASONING_MODEL,
      GENERATION_MODEL,
      HUNT_MODEL,
      CONTENT_MODEL,
      TRANSLATION_MODEL,
      FAST_MODEL,
      MEMORY_JUDGE_MODEL,
      POLICY_COMPILER_MODEL,
    ])
      expect(directLanguageModelTarget(withFallback, id)).toEqual({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
  })

  it('embeddings route only to an OpenAI-compatible embedding model', () => {
    expect(
      directEmbeddingModelTarget(
        direct({
          OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1',
          OPENAI_COMPATIBLE_EMBEDDING_MODEL: 'bge-m3',
        }),
        'alibaba/qwen3-embedding-0.6b'
      )
    ).toEqual({ provider: 'openai-compatible', modelId: 'bge-m3' })
    expect(() =>
      directEmbeddingModelTarget(
        direct({ ANTHROPIC_API_KEY: 'test-anthropic-key' }),
        'alibaba/qwen3-embedding-0.6b'
      )
    ).toThrow(/OPENAI_COMPATIBLE_EMBEDDING_MODEL/)
  })
})

describe('unavailable errors', () => {
  it('carry status 503 and a code callers can test', () => {
    const off = new AiNotConfiguredError()
    expect(off.status).toBe(503)
    expect(off.message).toMatch(/AI is not configured/)
    expect(isAiUnavailableError(off)).toBe(true)
    const unmapped = new AiModelUnavailableError('x/y', 'why')
    expect(unmapped.status).toBe(503)
    expect(unmapped.modelId).toBe('x/y')
    expect(isAiUnavailableError(unmapped)).toBe(true)
    expect(isAiUnavailableError(new Error('gateway down'))).toBe(false)
    expect(isAiUnavailableError(null)).toBe(false)
  })
})
