/**
 * @jest-environment node
 */
/**
 * LUM-854 — customer code sent to an LLM must only reach zero-data-retention
 * providers. These tests lock the three layers of that guarantee:
 *   1. the fetch wrapper forces `providerOptions.gateway.zeroDataRetention`
 *   2. the real `lib/ai/gateway` provider (chat + embedding) puts it on the wire,
 *      including when a call site passes a bare string model id (LUM-870)
 *   3. no runtime module can reach the gateway (or a provider SDK) around it,
 *      judged on the import graph (test-utils/zdr-import-audit.ts, LUM-877)
 */
import fs from 'fs'
import path from 'path'
import ts from 'typescript'
import {
  createZdrFetch,
  modelIdOf,
  withZeroDataRetention,
} from '@/lib/ai/zdr-fetch'
import { CODE_REVIEW_MODEL, MODEL_PROVIDER_PINS } from '@/lib/ai/models'
import {
  auditRuntimeModule,
  collectImports,
  importsUnwrappedGateway,
  isAiCallSite,
  isZdrWrapper,
  ZDR_WRAPPER,
} from '@/test-utils/zdr-import-audit'

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
      headers: { 'ai-language-model-id': 'deepseek/deepseek-v4-pro' },
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

describe('LUM-988 provider pin', () => {
  it('forces gateway.only for a pinned model and leaves other models alone', async () => {
    const { calls, inner } = captureFetch()
    const zdrFetch = createZdrFetch(inner)
    const body = JSON.stringify({
      prompt: 'diff',
      providerOptions: { gateway: { only: ['bedrock'], order: ['bedrock'] } },
    })
    await zdrFetch('https://ai-gateway.vercel.sh/v3/ai/language-model', {
      method: 'POST',
      headers: { 'ai-language-model-id': CODE_REVIEW_MODEL },
      body,
    })
    await zdrFetch('https://ai-gateway.vercel.sh/v3/ai/language-model', {
      method: 'POST',
      headers: new Headers({ 'ai-language-model-id': 'openai/gpt-5.5' }),
      body,
    })
    const pinned = JSON.parse(calls[0]!.init!.body as string) as Body
    const free = JSON.parse(calls[1]!.init!.body as string) as Body
    // A call site cannot widen the pin.
    expect(pinned.providerOptions?.gateway).toEqual({
      zeroDataRetention: true,
      only: ['anthropic'],
      order: ['bedrock'],
    })
    expect(free.providerOptions?.gateway).toEqual({
      zeroDataRetention: true,
      only: ['bedrock'],
      order: ['bedrock'],
    })
    expect(MODEL_PROVIDER_PINS[CODE_REVIEW_MODEL]).toEqual(['anthropic'])
  })

  it('fails closed: a POST that names no model is refused, never sent unpinned', async () => {
    const { calls, inner } = captureFetch()
    const zdrFetch = createZdrFetch(inner)
    await expect(
      zdrFetch('https://ai-gateway.vercel.sh/v3/ai/language-model', {
        method: 'POST',
        body: JSON.stringify({ prompt: 'customer diff' }),
      })
    ).rejects.toThrow(/names no model/)
    expect(calls).toHaveLength(0)
  })

  it('reads the model from ai-model-id and from a Request object too', async () => {
    const { calls, inner } = captureFetch()
    const zdrFetch = createZdrFetch(inner)
    await zdrFetch('https://ai-gateway.vercel.sh/v3/ai/embedding-model', {
      method: 'POST',
      headers: { 'ai-model-id': CODE_REVIEW_MODEL },
      body: '{}',
    })
    const req = new Request(
      'https://ai-gateway.vercel.sh/v3/ai/language-model',
      {
        method: 'POST',
        headers: { 'ai-language-model-id': CODE_REVIEW_MODEL },
      }
    )
    await zdrFetch(req, { method: 'POST', body: '{}' })
    for (const c of calls)
      expect(
        (JSON.parse(c.init!.body as string) as Body).providerOptions?.gateway
          ?.only
      ).toEqual(['anthropic'])
    expect(modelIdOf('https://x', { headers: {} })).toBeNull()
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

  it('LUM-988 CODE_REVIEW_MODEL requests through lib/ai/gateway are pinned to anthropic', async () => {
    const { gateway } = await import('@/lib/ai/gateway')
    await gateway(CODE_REVIEW_MODEL).doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'customer diff' }] },
      ],
    })
    const posts = calls.filter(c => c.init?.method === 'POST')
    const sent = JSON.parse(posts[0]!.init!.body as string) as Body
    expect(sent.providerOptions?.gateway?.only).toEqual(['anthropic'])
    expect(sent.providerOptions?.gateway?.zeroDataRetention).toBe(true)
  })

  // LUM-988 — the fail-closed guard and the provider pin read the model from
  // these two headers. Pinned against the INSTALLED @ai-sdk/gateway: an SDK
  // bump that renames them fails here, not as every AI call refused in prod.
  it('the installed gateway SDK names the model in the headers the guard reads', async () => {
    const { gateway } = await import('@/lib/ai/gateway')
    const { embedTexts } = await import('@/lib/ai/embedding')
    await gateway('deepseek/deepseek-v4-pro').doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    })
    await embedTexts(['y'])
    const posts = calls.filter(c => c.init?.method === 'POST')
    expect(posts).toHaveLength(2)
    const headers = posts.map(p => new Headers(p.init!.headers))
    expect(headers[0]!.get('ai-language-model-id')).toBe(
      'deepseek/deepseek-v4-pro'
    )
    expect(headers[1]!.get('ai-model-id')).toMatch(/\//)
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

describe('zdr import audit', () => {
  const run = (src: string, file = path.join('lib', 'x', 'mod.ts')) =>
    auditRuntimeModule(file, src)

  // LUM-877 — each form below slipped past the old regex guard.
  it('zdr audit flags every bypass form', () => {
    const load = "import '@/lib/ai/gateway'\n"
    const bypasses = [
      // `ai` re-exports the unwrapped gateway, under any spelling.
      "import { gateway } from 'ai'",
      "import { generateText, createGateway as cg } from 'ai'",
      "export { gateway } from 'ai'",
      "export * from 'ai'",
      "import * as ai from 'ai'",
      "import ai from 'ai'",
      "const ai = require('ai')",
      "import ai = require('ai')",
      "async function f() { const { gateway } = await import('ai') }",
      "async function f() { return (await import('ai')).gateway }",
      "import('ai').then(m => m.gateway)",
      // Provider SDKs other than the wrapper's own `@ai-sdk/gateway`.
      "import { gateway } from '@ai-sdk/gateway'",
      "const g = await import('@ai-sdk/gateway')",
      "import { createOpenAICompatible } from '@ai-sdk/openai-compatible'",
      "import { groq } from '@ai-sdk/groq'",
      "import OpenAI from 'openai'",
      "import Anthropic from '@anthropic-ai/sdk'",
    ]
    for (const src of bypasses) {
      expect({ src, violations: run(load + src) }).toEqual({
        src,
        violations: expect.arrayContaining([expect.any(String)]),
      })
    }
    // A comment naming a forbidden import is not an import.
    expect(run(load + "// import { gateway } from 'ai'\n")).toEqual([])
    // Only the wrapper itself may build on `@ai-sdk/gateway`.
    expect(
      run(
        "import { createGatewayProvider } from '@ai-sdk/gateway'",
        ZDR_WRAPPER
      )
    ).toEqual([])
    // LUM-1019 — the wrapper also builds the self-hosting direct providers;
    // everywhere else they remain a bypass.
    for (const sdk of ['@ai-sdk/anthropic', '@ai-sdk/openai-compatible']) {
      const src = `import * as p from '${sdk}'`
      expect(run(src, ZDR_WRAPPER)).toEqual([])
      expect(run(load + src)).not.toEqual([])
    }
    expect(
      run("import Anthropic from '@anthropic-ai/sdk'", ZDR_WRAPPER)
    ).not.toEqual([])
  })

  it('zdr audit requires a side-effect gateway load at every ai call site', () => {
    const call = "import { generateText } from 'ai'\n"
    // The only accepted static form: a bare side-effect import, alias or relative.
    expect(run("import '@/lib/ai/gateway'\n" + call)).toEqual([])
    expect(
      run("import '../ai/gateway'\n" + call, path.join('lib', 'llm', 'x.ts'))
    ).toEqual([])
    expect(
      run("import './gateway'\n" + call, path.join('lib', 'ai', 'x.ts'))
    ).toEqual([])
    // A relative path that is not the wrapper does not count.
    expect(
      run("import './gateway'\n" + call, path.join('lib', 'llm', 'x.ts'))
    ).not.toEqual([])

    // Forms the compiler can erase, so the wrapper never runs.
    for (const load of [
      "import { gateway } from '@/lib/ai/gateway'",
      "import type { gateway } from '@/lib/ai/gateway'",
      "import { type gateway } from '@/lib/ai/gateway'",
      '',
    ]) {
      expect(run(load + '\n' + call)).not.toEqual([])
    }
    // ...which is what TypeScript really does: an unused named import vanishes,
    // a bare one is always emitted.
    const emit = (src: string) =>
      ts.transpileModule(src, {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText
    expect(
      emit("import { gateway } from '@/lib/ai/gateway'\n" + call)
    ).not.toContain('@/lib/ai/gateway')
    expect(emit("import '@/lib/ai/gateway'\n" + call)).toContain(
      'require("@/lib/ai/gateway")'
    )

    // Dynamic use of `ai` needs the wrapper loaded too (dynamically is fine).
    const dyn =
      "async function f() { const { generateObject } = await import('ai') }\n"
    expect(run(dyn)).not.toEqual([])
    expect(
      run(
        dyn +
          "async function g() { const { gateway } = await import('@/lib/ai/gateway') }"
      )
    ).toEqual([])

    // Every non-allowlisted `ai` value is a call site — incl. experimental_*.
    for (const fn of [
      'experimental_transcribe',
      'experimental_generateSpeech',
      'experimental_generateVideo',
      'experimental_generateImage',
      'streamText',
      'ToolLoopAgent',
    ]) {
      expect(run(`import { ${fn} } from 'ai'`)).not.toEqual([])
    }
    // Types and request-free helpers are not call sites.
    expect(run("import type { LanguageModel } from 'ai'")).toEqual([])
    expect(
      run("import { type LanguageModel, jsonSchema, APICallError } from 'ai'")
    ).toEqual([])
  })
})

describe('no bypass', () => {
  // Scan the whole repo by default so a new runtime directory — or a root
  // file such as proxy.ts / instrumentation.ts — is covered the day it
  // appears (LUM-870/877). Only tests, test fixtures (incl. the semgrep rule
  // fixtures under security/), docs and scripts (checked separately below)
  // are skipped.
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
  const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/
  const read = (f: string) =>
    fs.readFileSync(path.join(process.cwd(), f), 'utf8')

  function walk(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (SOURCE.test(entry.name)) out.push(full)
    }
    return out
  }

  const rootEntries = () =>
    fs
      .readdirSync(process.cwd(), { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')

  function runtimeRoots(): string[] {
    return rootEntries()
      .filter(e => e.isDirectory() && !SKIP_ROOTS.has(e.name))
      .map(e => e.name)
  }

  function runtimeFiles(): string[] {
    const rootFiles = rootEntries()
      .filter(e => e.isFile() && SOURCE.test(e.name))
      .map(e => path.join(process.cwd(), e.name))
    return [
      ...rootFiles,
      ...runtimeRoots().flatMap(r => walk(path.join(process.cwd(), r))),
    ]
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
    const files = runtimeFiles()
    expect(files).toContain('proxy.ts')

    const offenders = files.flatMap(f =>
      auditRuntimeModule(f, read(f)).map(v => `${f}: ${v}`)
    )
    expect(offenders).toEqual([])

    expect(read(ZDR_WRAPPER)).toMatch(
      /createGatewayProvider\(\{\s*fetch:\s*createZdrFetch\(/
    )
  })

  it('every runtime ai call site loads the zdr gateway', () => {
    // Guards the scan itself: the known call sites must be found.
    const callSites = runtimeFiles().filter(f => isAiCallSite(f, read(f)))
    expect(callSites).toContain(path.join('lib', 'ai', 'embedding.ts'))
    expect(callSites).toContain(
      path.join('lib', 'services', 'memory', 'manual-dedup.ts')
    )
    expect(callSites.length).toBeGreaterThan(10)
  })

  // Scripts are developer-run, but some send real data (LUM-787's replay
  // sends real PR diffs), so every script uses lib/ai/gateway too — no
  // allowlist (the six LUM-877 left behind were migrated).
  const GATEWAY_SCRIPTS = [
    'scripts/analysis/lum787-hunt-replay/replay.ts',
    'scripts/analysis/lum776-plan-probe/probe.ts',
    'scripts/eval/memory/fixture-gen.ts',
    'scripts/eval/memory/injection-runner.ts',
    'scripts/eval/memory/retrieve-fixture-gen.ts',
    'scripts/eval/memory/retrieve-judge.ts',
    'scripts/translate-i18n-slack-context.ts',
  ].map(f => path.join(...f.split('/')))

  it('scripts reach the gateway only through the zdr wrapper', () => {
    const scripts = walk(path.join(process.cwd(), 'scripts')).map(f =>
      path.relative(process.cwd(), f)
    )
    const raw = scripts.filter(f => importsUnwrappedGateway(f, read(f)))
    expect(raw).toEqual([])

    // Guards the scan itself: the known gateway scripts are found, and each
    // loads the wrapper (statically or via import()).
    for (const f of GATEWAY_SCRIPTS) {
      expect(scripts).toContain(f)
      expect({
        f,
        loadsWrapper: collectImports(f, read(f)).some(
          r => !r.typeOnly && isZdrWrapper(r.specifier, f)
        ),
      }).toEqual({ f, loadsWrapper: true })
    }
  })
})
