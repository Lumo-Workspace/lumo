/**
 * @jest-environment node
 */
/**
 * LUM-1019 — the real `lib/ai/gateway` router on the direct route, end to end
 * against a local HTTP stub that speaks the Anthropic Messages and the
 * OpenAI-compatible chat/embeddings wire formats. No real provider is called.
 * Also: the unconfigured route throws a typed error instead of crashing, and
 * the gateway route keeps ZDR even when a provider key is present.
 */
import http from 'http'
import type { AddressInfo } from 'net'
import { CODE_REVIEW_MODEL, GENERATION_MODEL } from '@/lib/ai/models'
import { AiNotConfiguredError, isAiUnavailableError } from '@/lib/ai/routing'

interface Seen {
  path: string
  headers: http.IncomingHttpHeaders
  body: Record<string, unknown>
}

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

const SUMMARY = 'The run added a provider router.'

/** A reply in the wire format the request's path belongs to. */
function reply(path: string, body: Record<string, unknown>): unknown {
  if (path.endsWith('/messages')) {
    // Anthropic Messages API. Structured output arrives either as a forced
    // `json` tool or as plain JSON text, depending on the SDK's choice.
    const tools = (body.tools as Array<{ name: string }> | undefined) ?? []
    const content = tools.some(t => t.name === 'json')
      ? [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'json',
            input: { summary: SUMMARY },
          },
        ]
      : [{ type: 'text', text: JSON.stringify({ summary: SUMMARY }) }]
    return {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content,
      stop_reason: tools.length > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 5 },
    }
  }
  if (path.endsWith('/embeddings')) {
    const input = body.input as string[]
    return {
      object: 'list',
      data: input.map((_, index) => ({
        object: 'embedding',
        index,
        embedding: [0.25, 0.5],
      })),
      model: body.model,
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }
  }
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({ summary: SUMMARY }),
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  }
}

let server: http.Server
let base: string
let seen: Seen[]
const saved: Record<string, string | undefined> = {}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => (raw += chunk))
    req.on('end', () => {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
      const path = req.url ?? ''
      seen.push({ path, headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(reply(path, body)))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
  seen = []
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

describe('direct Anthropic route', () => {
  it('a real AI feature (run summary) runs through the router to Anthropic', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/v1`
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'
    const { callRunSummaryLLM } = await import('@/lib/llm/run-summary-client')

    const summary = await callRunSummaryLLM({
      taskTitle: 'LUM-1019',
      eventLog: 'Edit lib/ai/gateway.ts',
    })

    expect(summary).toBe(SUMMARY)
    expect(seen).toHaveLength(1)
    const [call] = seen
    expect(call!.path).toBe('/anthropic/v1/messages')
    expect(call!.headers['x-api-key']).toBe('test-anthropic-key')
    // GENERATION_MODEL (DeepSeek) has no Claude mapping → ANTHROPIC_MODEL.
    expect(call!.body.model).toBe('claude-sonnet-4-6')
    // Gateway-only options never reach a direct provider.
    expect(call!.body).not.toHaveProperty('providerOptions')
  })

  it('a Claude registry id is sent under its native Anthropic name', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/v1`
    const { gateway } = await import('@/lib/ai/gateway')
    const { generateText } = await import('ai')

    const { text } = await generateText({
      model: gateway(CODE_REVIEW_MODEL),
      prompt: 'review this diff',
    })

    expect(text).toContain(SUMMARY)
    expect(seen[0]!.body.model).toBe('claude-sonnet-5-5')
  })

  it('an id with no Anthropic mapping fails with a typed error, no request sent', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/v1`
    const { gateway } = await import('@/lib/ai/gateway')
    let caught: unknown
    try {
      gateway(GENERATION_MODEL)
    } catch (err) {
      caught = err
    }
    expect(isAiUnavailableError(caught)).toBe(true)
    expect((caught as Error).message).toMatch(/ANTHROPIC_MODEL/)
    expect(seen).toHaveLength(0)
  })
})

describe('direct OpenAI-compatible route', () => {
  it('chat (structured) and embeddings reach the compatible endpoint', async () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = `${base}/compat/v1`
    process.env.OPENAI_COMPATIBLE_API_KEY = 'test-compat-key'
    process.env.OPENAI_COMPATIBLE_MODEL = 'llama3.1'
    process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL = 'bge-m3'
    const { callRunSummaryLLM } = await import('@/lib/llm/run-summary-client')
    const { embedTexts } = await import('@/lib/ai/embedding')

    expect(
      await callRunSummaryLLM({ taskTitle: 'LUM-1019', eventLog: 'Read x' })
    ).toBe(SUMMARY)
    expect(await embedTexts(['memory text'])).toEqual([[0.25, 0.5]])

    expect(seen.map(s => s.path)).toEqual([
      '/compat/v1/chat/completions',
      '/compat/v1/embeddings',
    ])
    expect(seen[0]!.headers.authorization).toBe('Bearer test-compat-key')
    expect(seen[0]!.body.model).toBe('llama3.1')
    // The schema goes on the wire (structured outputs on by default).
    expect(seen[0]!.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { schema: { properties: { summary: { type: 'string' } } } },
    })
    expect(seen[1]!.body.model).toBe('bge-m3')
    expect(seen[1]!.body.input).toEqual(['memory text'])
  })

  it('without OPENAI_COMPATIBLE_MODEL the provider prefix is stripped', async () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = `${base}/compat/v1`
    const { gateway } = await import('@/lib/ai/gateway')
    const { generateText } = await import('ai')
    await generateText({ model: gateway('openai/gpt-5.5'), prompt: 'hi' })
    // A bare string id resolves through the same router (LUM-870 path).
    await generateText({ model: 'deepseek/deepseek-v4-flash', prompt: 'hi' })
    expect(seen.map(s => s.body.model)).toEqual([
      'gpt-5.5',
      'deepseek-v4-flash',
    ])
    expect(seen[0]!.headers.authorization).toBeUndefined()
  })
})

describe('unconfigured route', () => {
  it('model lookups throw AiNotConfiguredError and the feature reports it', async () => {
    const { gateway } = await import('@/lib/ai/gateway')
    expect(() => gateway(GENERATION_MODEL)).toThrow(AiNotConfiguredError)
    expect(() => gateway.textEmbeddingModel('alibaba/x')).toThrow(
      AiNotConfiguredError
    )
    const { callRunSummaryLLM } = await import('@/lib/llm/run-summary-client')
    await expect(
      callRunSummaryLLM({ taskTitle: 't', eventLog: 'e' })
    ).rejects.toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' })
    const { embedTexts } = await import('@/lib/ai/embedding')
    await expect(embedTexts(['x'])).rejects.toBeInstanceOf(AiNotConfiguredError)
    expect(seen).toHaveLength(0)
  })

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

describe('gateway route with a provider key also present', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('still goes to the AI Gateway with ZDR forced (SaaS unchanged)', async () => {
    process.env.AI_GATEWAY_API_KEY = 'test-gateway-key'
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
    process.env.ANTHROPIC_BASE_URL = `${base}/anthropic/v1`
    const posts: Array<{ url: string; body: string }> = []
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST')
          posts.push({ url: String(input), body: String(init.body) })
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'OK' }],
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    ) as unknown as typeof fetch
    const { gateway } = await import('@/lib/ai/gateway')
    await gateway(CODE_REVIEW_MODEL).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'diff' }] }],
    })
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toMatch(/^https:\/\/ai-gateway\.vercel\.sh\//)
    const sent = JSON.parse(posts[0]!.body) as {
      providerOptions?: { gateway?: Record<string, unknown> }
    }
    expect(sent.providerOptions?.gateway?.zeroDataRetention).toBe(true)
    expect(sent.providerOptions?.gateway?.only).toEqual(['anthropic'])
    expect(seen).toHaveLength(0)
  })
})
