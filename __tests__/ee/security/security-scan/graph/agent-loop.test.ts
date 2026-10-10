/** @jest-environment node */
import {
  AGENT_LOOP_SHAPES,
  AGENT_LOOP_SHAPE_META,
  findUnboundedAgentLoops,
} from '@/ee/security/security-scan/graph/agent-loop'

const ROUTE = 'app/api/agent/route.ts'
const LIB = 'lib/services/agent.service.ts'

const findingsOf = (files: Array<[string, string]>) =>
  findUnboundedAgentLoops(
    files.map(([path, source]) => ({ path, source, touched: true }))
  ).findings

describe('LUM-794 unbounded agent loop graph rule', () => {
  it('reports a while(true) loop that re-issues a model call with no exit path', () => {
    const findings = findingsOf([
      [
        ROUTE,
        `import { generateText } from 'ai'

export async function POST(req: Request) {
  const out = []
  while (true) {
    const step = await generateText({ model: m, prompt: 'keep going' })
    out.push(step.text)
  }
}
`,
      ],
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      shape: 'while-true',
      symbol: `${ROUTE}#POST`,
      file: ROUTE,
      line: 5,
      call: {
        symbol: `${ROUTE}#generateText@6`,
        line: 6,
        callee: 'generateText',
      },
      reachability: 'EXTERNAL',
    })
  })

  it('reports a for(;;) loop and a do…while(true) loop under their own shapes', () => {
    const findings = findingsOf([
      [
        LIB,
        `import { generateText } from 'ai'

export async function forever() {
  for (;;) {
    await generateText({ model: m, prompt: 'go' })
  }
}

export async function doForever() {
  do {
    await generateText({ model: m, prompt: 'go' })
  } while (true)
}
`,
      ],
    ])
    expect(findings.map(f => f.shape).sort()).toEqual([
      'for-ever',
      'while-true',
    ])
  })

  it('stays silent when a counter comparison bounds the loop', () => {
    const findings = findingsOf([
      [
        LIB,
        `import { generateText } from 'ai'

export async function bounded() {
  let steps = 0
  while (true) {
    await generateText({ model: m, prompt: 'go' })
    steps += 1
    if (steps >= 20) break
  }
}
`,
      ],
    ])
    expect(findings).toEqual([])
  })

  it('stays silent when the loop has a return, a break or a throw', () => {
    const shapes = [
      `  while (true) {
    const step = await generateText({ model: m, prompt: 'go' })
    if (step) return step.text
  }`,
      `  while (true) {
    await generateText({ model: m, prompt: 'go' })
    break
  }`,
      `  while (true) {
    await generateText({ model: m, prompt: 'go' })
    throw new Error('stop')
  }`,
    ]
    for (const body of shapes) {
      expect(
        findingsOf([
          [
            LIB,
            `import { generateText } from 'ai'

export async function maybe() {
${body}
}
`,
          ],
        ])
      ).toEqual([])
    }
  })

  it('stays silent on an unbounded loop that issues no model call', () => {
    const findings = findingsOf([
      [
        LIB,
        `export async function poll() {
  while (true) {
    await tick()
  }
}
`,
      ],
    ])
    expect(findings).toEqual([])
  })

  it('reports unguarded self-recursion around a model call', () => {
    const findings = findingsOf([
      [
        LIB,
        `import { generateText } from 'ai'

export async function loop() {
  const step = await generateText({ model: m, prompt: 'go' })
  record(step.text)
  return loop()
}
`,
      ],
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      shape: 'recursion',
      symbol: `${LIB}#loop`,
      line: 3,
      call: { line: 4, callee: 'generateText' },
    })
  })

  it('stays silent on self-recursion with any guard in the body', () => {
    const findings = findingsOf([
      [
        LIB,
        `import { generateText } from 'ai'

export async function loop(depth: number) {
  const step = await generateText({ model: m, prompt: 'go' })
  if (depth >= 10) return step.text
  return loop(depth + 1)
}
`,
      ],
    ])
    expect(findings).toEqual([])
  })

  it('stays silent on recursion that never calls a model', () => {
    const findings = findingsOf([
      [
        LIB,
        `export async function walk() {
  await step()
  return walk()
}
`,
      ],
    ])
    expect(findings).toEqual([])
  })

  it('reports a loop around an SDK client call, with reachability UNKNOWN when the subgraph has no node for it', () => {
    const findings = findingsOf([
      [
        LIB,
        `export async function chat() {
  while (true) {
    await openai.chat.completions.create({ model: m, messages: [] })
  }
}
`,
      ],
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      shape: 'while-true',
      call: { symbol: null, callee: 'openai.chat.completions.create' },
      reachability: 'UNKNOWN',
    })
  })

  it('reports the outer loop once when unbounded loops are nested', () => {
    const findings = findingsOf([
      [
        LIB,
        `import { generateText } from 'ai'

export async function nested() {
  while (true) {
    for (;;) {
      await generateText({ model: m, prompt: 'go' })
    }
  }
}
`,
      ],
    ])
    expect(findings).toHaveLength(1)
    expect(findings[0]!.shape).toBe('while-true')
  })

  it('has label and CWE metadata for every shape', () => {
    for (const shape of AGENT_LOOP_SHAPES) {
      expect(AGENT_LOOP_SHAPE_META[shape].cwe).toMatch(/^CWE-\d+$/)
      expect(AGENT_LOOP_SHAPE_META[shape].label.length).toBeGreaterThan(0)
    }
  })

  it('does not report this repo own bounded hunt loop shape', () => {
    // The search call is a single `generateText` with `stopWhen`, not a
    // hand-written loop — nothing here for this rule to see.
    const findings = findingsOf([
      [
        'ee/security/llm/security-hunt-client.ts',
        `import { generateText, stepCountIs, hasToolCall } from 'ai'

export async function runHunt(input: { maxSteps: number }) {
  const result = await generateText({
    model: m,
    tools,
    prompt: 'go',
    stopWhen: [stepCountIs(input.maxSteps), hasToolCall('submit_candidates')],
  })
  return result.text
}
`,
      ],
    ])
    expect(findings).toEqual([])
  })
})
