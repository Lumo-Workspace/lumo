/**
 * @jest-environment node
 */
/**
 * LUM-854 — customer code sent to an LLM must only reach zero-data-retention
 * providers. These tests lock the three layers of that guarantee:
 *   1. the fetch wrapper forces `providerOptions.gateway.zeroDataRetention`
 *   2. the real `lib/ai/gateway` provider (chat + embedding) puts it on the wire,
 *      including when a call site passes a bare string model id (LUM-870)
 *   3. no runtime module can reach the gateway (or a provider SDK) around it
 */
import fs from 'fs'
import path from 'path'
import { createZdrFetch, withZeroDataRetention } from '@/lib/ai/zdr-fetch'

type Body = {
  providerOptions?: Record<string, Record<string, unknown>>
} & Record<string, unknown>

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const inner = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  ) as unknown as typeof fetch
  return { calls, inner }
}

describe('ZDR fetch wrapper', () => {
  it('zdr wrapper forces zeroDataRetention and keeps call-site gateway options', async () => {
    const { calls, inner } = captureFetch()
    const zdrFetch = createZdrFetch(inner)

    // A call site that tried to opt out and set its own routing order.
    await zdrFetch('https://ai-gateway.vercel.sh/v3/ai/language-model', {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'diff',
        providerOptions: {
          gateway: { zeroDataRetention: false, order: ['alibaba'] },
          openai: { reasoningEffort: 'low' },
        },
      }),
    })
    const sent = JSON.parse(calls[0]!.init!.body as string) as Body
    expect(sent.prompt).toBe('diff')
    expect(sent.providerOptions).toEqual({
      gateway: { zeroDataRetention: true, order: ['alibaba'] },
      openai: { reasoningEffort: 'low' },
    })

    // A call site with no providerOptions at all still gets ZDR.
    expect(JSON.parse(withZeroDataRetention('{"values":["x"]}'))).toEqual({
      values: ['x'],
      providerOptions: { gateway: { zeroDataRetention: true } },
    })

    // Metadata GETs carry no customer data and pass through untouched.
    await zdrFetch('https://ai-gateway.vercel.sh/v3/ai/config', {
      method: 'GET',
    })
    expect(calls[1]!.init).toEqual({ method: 'GET' })

    // Fail closed: an unreadable POST body is never sent unconstrained.
    await expect(
      zdrFetch('https://x', { method: 'POST', body: 'not json' })
    ).rejects.toThrow(/ZDR guard/)
    await expect(
      zdrFetch('https://x', { method: 'POST', body: '[1]' })
    ).rejects.toThrow(/ZDR guard/)
    await expect(zdrFetch('https://x', { method: 'POST' })).rejects.toThrow(
      /ZDR guard/
    )
    expect(calls).toHaveLength(2)
  })
})

describe('lib/ai/gateway on the wire', () => {
  const realFetch = global.fetch
  let calls: Array<{ url: string; init: RequestInit | undefined }>

  beforeEach(() => {
    process.env.AI_GATEWAY_API_KEY = 'test-key'
    calls = []
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        const isEmbed = String(input).includes('embedding')
        const payload = isEmbed
          ? { embeddings: [[0.1]], usage: { tokens: 1 } }
          : {
              content: [{ type: 'text', text: 'OK' }],
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1 },
            }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
    ) as unknown as typeof fetch
  })
  afterEach(() => {
    global.fetch = realFetch
  })

  it('chat requests through lib/ai/gateway carry zeroDataRetention', async () => {
    const { gateway } = await import('@/lib/ai/gateway')
    await gateway('deepseek/deepseek-v4-pro').doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'customer diff' }] },
      ],
      providerOptions: { gateway: { zeroDataRetention: false } },
    })
    const posts = calls.filter(c => c.init?.method === 'POST')
    expect(posts).toHaveLength(1)
    const sent = JSON.parse(posts[0]!.init!.body as string) as Body
    expect(sent.providerOptions?.gateway?.zeroDataRetention).toBe(true)
  })

  it('embedTexts requests zero data retention', async () => {
    const { embedTexts } = await import('@/lib/ai/embedding')
    await embedTexts(['customer memory text'])
    const posts = calls.filter(c => c.init?.method === 'POST')
    expect(posts).toHaveLength(1)
    const sent = JSON.parse(posts[0]!.init!.body as string) as Body
    expect(sent.values).toEqual(['customer memory text'])
    expect(sent.providerOptions?.gateway?.zeroDataRetention).toBe(true)
  })
  // LUM-870 — the AI SDK resolves a string `model` through
  // `globalThis.AI_SDK_DEFAULT_PROVIDER ?? <unwrapped global gateway>`.
  it('string model ids resolve through the zdr gateway', async () => {
    const { gateway } = await import('@/lib/ai/gateway')
    expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(gateway)

    const { generateText, generateObject, embed, jsonSchema } =
      await import('ai')
    await generateText({
      model: 'deepseek/deepseek-v4-pro',
      prompt: 'customer diff',
    })
    await generateObject({
      model: 'deepseek/deepseek-v4-pro',
      schema: jsonSchema<{ ok: boolean }>({
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      }),
      prompt: 'customer diff',
    }).catch(() => undefined) // the stub's reply is not the schema; only the request matters
    await embed({
      model: 'openai/text-embedding-3-small',
      value: 'customer memory text',
    })

    const posts = calls.filter(c => c.init?.method === 'POST')
    expect(posts).toHaveLength(3)
    for (const post of posts) {
      const sent = JSON.parse(post.init!.body as string) as Body
      expect(sent.providerOptions?.gateway?.zeroDataRetention).toBe(true)
    }
  })
})

describe('no bypass', () => {
  const WRAPPER = path.join('lib', 'ai', 'gateway.ts')
  // Scan the whole repo by default so a new runtime directory is covered the
  // day it appears (LUM-870). Only tests, test fixtures (incl. the semgrep
  // rule fixtures under security/), docs and offline eval/probe scripts
  // (developer-run, never in a request path) are skipped.
  const SKIP_ROOTS = new Set([
    '__tests__',
    '__stubs__',
    'tests',
    'test-utils',
    'docs',
    'public',
    'prisma',
    'scripts',
    'security',
    'coverage',
  ])
  const SKIP_DIRS = new Set(['node_modules', '__tests__', 'test-support'])
  // A direct gateway import skips the ZDR fetch; a provider SDK skips the gateway.
  const FORBIDDEN =
    /(?:from\s+|import\(\s*|require\(\s*)['"](@ai-sdk\/gateway|@ai-sdk\/(?:openai|anthropic|deepseek|alibaba|google|mistral|xai)|@anthropic-ai\/sdk|openai)['"]/
  // AI SDK entry points that take a `model` — a string id there resolves via
  // `globalThis.AI_SDK_DEFAULT_PROVIDER`, which only `lib/ai/gateway` sets.
  const MODEL_CALL =
    /import\s*\{[^}]*\b(?:generateText|generateObject|streamText|streamObject|embed|embedMany|rerank|generateImage|experimental_generateImage|ToolLoopAgent|Experimental_Agent)\b[^}]*\}\s*from\s*['"]ai['"]/
  const LOADS_GATEWAY = /from\s+['"](?:@\/lib\/ai\/gateway|\.\/gateway)['"]/

  function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  function runtimeRoots(): string[] {
    return fs
      .readdirSync(process.cwd(), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(n => !n.startsWith('.') && n !== 'node_modules')
      .filter(n => !SKIP_ROOTS.has(n))
  }

  function runtimeFiles(): string[] {
    return runtimeRoots()
      .flatMap(r => walk(path.join(process.cwd(), r)))
      .map(f => path.relative(process.cwd(), f))
      .filter(f => !/\.test\.(ts|tsx|js)$/.test(f))
  }

  it('no runtime module bypasses the zdr gateway wrapper', () => {
    const roots = runtimeRoots()
    for (const r of [
      'lib',
      'app',
      'shared',
      'mcp',
      'cli',
      'components',
      'hooks',
    ]) {
      expect(roots).toContain(r)
    }

    const offenders = runtimeFiles()
      .filter(f => f !== WRAPPER)
      .filter(f => FORBIDDEN.test(fs.readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])

    const wrapper = fs.readFileSync(path.join(process.cwd(), WRAPPER), 'utf8')
    expect(wrapper).toMatch(
      /createGatewayProvider\(\{\s*fetch:\s*createZdrFetch\(/
    )
  })

  it('every runtime ai call site loads the zdr gateway', () => {
    const callSites = runtimeFiles().filter(f =>
      MODEL_CALL.test(fs.readFileSync(f, 'utf8'))
    )
    // Guards the scan itself: the known call sites must be found.
    expect(callSites).toContain(path.join('lib', 'ai', 'embedding.ts'))
    expect(callSites.length).toBeGreaterThan(10)

    const missing = callSites.filter(
      f => !LOADS_GATEWAY.test(fs.readFileSync(f, 'utf8'))
    )
    expect(missing).toEqual([])
  })
})
