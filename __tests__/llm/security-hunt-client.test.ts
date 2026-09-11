/** @jest-environment node */
jest.mock('ai', () => ({
  generateText: jest.fn(),
  tool: (t: unknown) => t,
  stepCountIs: jest.fn((n: number) => ({ stepCountIs: n })),
  hasToolCall: jest.fn((name: string) => ({ hasToolCall: name })),
}))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { generateText } from 'ai'
import { GENERATION_MODEL } from '@/lib/ai/models'
import { HUNT_CLIENT_MAX_RETRIES } from '@/lib/services/security-hunt.config'
import {
  huntTask,
  numberLines,
  renderSubgraphForPrompt,
  renderTaskForPrompt,
} from '@/lib/llm/security-hunt-client'
import { SNIPPET_MAX_CHARS } from '@/lib/security-scan/hunt/snippet'
import type { Subgraph } from '@/lib/security-scan/graph/types'

const gen = generateText as jest.Mock

const g: Subgraph = {
  symbols: [
    {
      id: 'a.ts#GET',
      kind: 'entry',
      file: 'a.ts',
      line: 1,
      name: 'GET',
      rule: 'next-route-handler',
      controls: [],
    },
    {
      id: 'a.ts#fetch@2',
      kind: 'sink',
      file: 'a.ts',
      line: 2,
      name: 'fetch',
      rule: 'fetch',
      controls: [],
    },
  ],
  edges: [{ from: 'a.ts#GET', to: 'a.ts#fetch@2' }],
  files: [{ path: 'a.ts', lineCount: 3, touched: true }],
}

const candidate = {
  category: 'ssrf',
  cwe: 'CWE-918',
  severity: 'HIGH',
  sink: { symbol: 'a.ts#fetch@2', file: 'a.ts', line: 2 },
  entry: { symbol: 'a.ts#GET', file: 'a.ts', line: 1 },
  call_chain: [{ from: 'a.ts#GET', to: 'a.ts#fetch@2' }],
  precondition: 'url from query',
  claim: 'query url reaches fetch',
}

const TASK = {
  id: 't1',
  objective: 'the `next` query param on a.ts#GET reaches fetch unvalidated',
  category: 'ssrf' as const,
  startingPoints: ['a.ts'],
}

type Tools = Record<string, { execute: (input: unknown) => Promise<unknown> }>

function run(result: unknown) {
  gen.mockResolvedValueOnce(result)
  return huntTask({
    task: TASK,
    subgraph: g,
    readFile: async (path: string) => (path === 'a.ts' ? 'l1\nl2\nl3' : null),
    tokenBudget: 1000,
    timeoutMs: 5000,
    maxSteps: 4,
  })
}

beforeEach(() => gen.mockReset())

describe('LUM-739 hunt client', () => {
  it('uses the GENERATION bucket, three stop conditions, and returns submitted candidates as done', async () => {
    const out = await run({
      steps: [
        {
          toolCalls: [{ toolName: 'submit_candidates' }],
          usage: { totalTokens: 300 },
        },
      ],
      totalUsage: { totalTokens: 300 },
    })
    const call = gen.mock.calls[0]![0]
    expect(call.model).toEqual({ id: GENERATION_MODEL })
    expect(call.stopWhen).toHaveLength(3)
    expect(call.stopWhen[0]).toEqual({ stepCountIs: 4 })
    expect(call.stopWhen[1]).toEqual({ hasToolCall: 'submit_candidates' })
    expect(
      call.stopWhen[2]({
        steps: [
          { usage: { totalTokens: 600 } },
          { usage: { totalTokens: 500 } },
        ],
      })
    ).toBe(true)
    expect(call.stopWhen[2]({ steps: [{ usage: { totalTokens: 600 } }] })).toBe(
      false
    )
    // LUM-758: the prompt leads with the task's objective and starting
    // points; the category only says how the output gets filed.
    expect(call.prompt).toContain('## Task t1: ' + TASK.objective)
    expect(call.prompt).toContain(
      'Findings from this task are filed under: ssrf (CWE-918)'
    )
    expect(call.prompt).toContain('Start from: a.ts')
    // CATEGORY_BRIEF still rides along — it is the decision rule the
    // mechanical gate and the falsifier hold the submissions to.
    expect(call.prompt).toContain('SSRF: a request-derived URL or host')
    expect(call.prompt).toContain('a.ts#fetch@2')
    // The candidates come back only through the tool.
    const tools = call.tools as Tools
    await expect(
      tools.submit_candidates!.execute({ candidates: [candidate] })
    ).resolves.toEqual({ accepted: 1 })
    expect(out.stopped).toBe('done')
    expect(out.tokens).toBe(300)
  })

  it('LUM-762 bounds SDK retries so backoff cannot eat the category window', async () => {
    await run({ steps: [], totalUsage: { totalTokens: 0 } })
    const call = gen.mock.calls[0]![0]
    // The SDK default is 2 retries with exponential backoff — the production
    // abort landed inside one of those delays ("Delay was aborted").
    expect(call.maxRetries).toBe(HUNT_CLIENT_MAX_RETRIES)
    expect(HUNT_CLIENT_MAX_RETRIES).toBeLessThan(2)
  })

  it('confines read_file to subgraph files and numbers the lines', async () => {
    await run({ steps: [], totalUsage: { totalTokens: 0 } })
    const tools = gen.mock.calls[0]![0].tools as Tools
    await expect(
      tools.read_file!.execute({ path: 'secret.ts' })
    ).resolves.toEqual({ error: 'not in subgraph' })
    await expect(
      tools.read_file!.execute({ path: 'a.ts', startLine: 2 })
    ).resolves.toEqual({ content: '2: l2\n3: l3' })
    await expect(
      tools.callers_of!.execute({ symbol: 'a.ts#fetch@2' })
    ).resolves.toEqual({ callers: ['a.ts#GET'] })
    await expect(
      tools.callees_of!.execute({ symbol: 'a.ts#GET' })
    ).resolves.toEqual({ callees: ['a.ts#fetch@2'] })
    await expect(
      tools.path_to_entry!.execute({ symbol: 'a.ts#fetch@2' })
    ).resolves.toEqual({ path: ['a.ts#GET', 'a.ts#fetch@2'] })
  })

  it('reports budget vs steps when nothing was submitted', async () => {
    const budget = await run({
      steps: [{ toolCalls: [], usage: { totalTokens: 1000 } }],
      totalUsage: { totalTokens: 1000 },
    })
    expect(budget).toEqual({ candidates: [], tokens: 1000, stopped: 'budget' })
    const steps = await run({
      steps: [
        { toolCalls: [{ toolName: 'read_file' }], usage: { totalTokens: 10 } },
      ],
      totalUsage: { totalTokens: undefined },
    })
    expect(steps).toEqual({ candidates: [], tokens: 10, stopped: 'steps' })
  })

  it('numberLines cuts at the char budget and the prompt renderer lists every section', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
    const cut = numberLines(big)
    expect(cut.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 20)
    expect(cut.endsWith('…[truncated]')).toBe(true)
    const text = renderSubgraphForPrompt(g)
    expect(text).toContain('### Entries')
    expect(text).toContain('### Sinks')
    expect(text).toContain('a.ts#GET -> a.ts#fetch@2')
    expect(text).toContain('a.ts (3 lines, touched by the PR)')
  })

  it('LUM-758 renderTaskForPrompt omits the Start-from line when the task has no starting points', () => {
    const withPoints = renderTaskForPrompt(TASK)
    expect(withPoints).toContain('Start from: a.ts')
    const without = renderTaskForPrompt({ ...TASK, startingPoints: [] })
    expect(without).not.toContain('Start from:')
    // The objective, the filing category and the category brief survive.
    expect(without).toContain(`## Task t1: ${TASK.objective}`)
    expect(without).toContain(
      'Findings from this task are filed under: ssrf (CWE-918)'
    )
    expect(without).toContain('SSRF: a request-derived URL or host')
  })
})
