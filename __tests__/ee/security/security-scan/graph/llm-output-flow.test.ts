/** @jest-environment node */
import {
  findLlmOutputFlows,
  LLM_OUTPUT_SINK_META,
  LLM_OUTPUT_TARGET_SINKS,
} from '@/ee/security/security-scan/graph/llm-output-flow'
import {
  SOURCE_RULES,
  matchCallRule,
} from '@/ee/security/security-scan/graph/patterns'

const ROUTE = 'app/api/sql/route.ts'
const SERVICE = 'lib/services/sql.service.ts'

const flowsOf = (files: Array<[string, string]>) =>
  findLlmOutputFlows(
    files.map(([path, source]) => ({ path, source, touched: true }))
  ).flows

describe('LUM-785 llm-output-to-sink graph rule', () => {
  it('reports a model result reaching prisma-raw in the same function with no zod-parse on the path', () => {
    const flows = flowsOf([
      [
        ROUTE,
        `import { generateText } from 'ai'
import { prisma } from '@/lib/db/prisma'

export async function POST(req: Request) {
  const { text } = await generateText({ model: m, prompt: 'write sql' })
  const sql = \`SELECT * FROM t WHERE \${text}\`
  return prisma.$queryRawUnsafe(sql)
}
`,
      ],
    ])
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({
      source: {
        symbol: `${ROUTE}#POST`,
        file: ROUTE,
        line: 5,
        callee: 'generateText',
      },
      sink: {
        symbol: `${ROUTE}#prisma.$queryRawUnsafe@7`,
        file: ROUTE,
        line: 7,
        rule: 'prisma-raw',
      },
      chain: [`${ROUTE}#POST`],
      reachability: 'EXTERNAL',
    })
  })

  it('stays silent when a zod-parse sits on the path', () => {
    const flows = flowsOf([
      [
        ROUTE,
        `import { generateObject } from 'ai'
import { prisma } from '@/lib/db/prisma'
import { SqlSchema } from '@/lib/validation/sql'

export async function POST(req: Request) {
  const out = await generateObject({ model: m, schema: SqlSchema, prompt: 'p' })
  const safe = SqlSchema.parse(out.object)
  return prisma.$queryRawUnsafe(safe.sql)
}
`,
      ],
    ])
    expect(flows).toEqual([])
  })

  it('stays silent when the sink is not reachable from the model result', () => {
    const flows = flowsOf([
      [
        ROUTE,
        `import { generateText } from 'ai'
import { prisma } from '@/lib/db/prisma'

export async function POST(req: Request) {
  const { text } = await generateText({ model: m, prompt: 'p' })
  const body = await req.json()
  await prisma.$queryRawUnsafe(body.sql)
  return text
}

export async function GET() {
  return prisma.$executeRawUnsafe('DELETE FROM t')
}
`,
      ],
    ])
    expect(flows).toEqual([])
  })

  it('reports a chain that crosses one file hop through a resolved call', () => {
    const flows = flowsOf([
      [
        ROUTE,
        `import { generateText } from 'ai'
import { sqlService } from '@/lib/services/sql.service'

export async function POST(req: Request) {
  const result = await generateText({ model: m, prompt: 'p' })
  return sqlService.run(result.text)
}
`,
      ],
      [
        SERVICE,
        `import { prisma } from '@/lib/db/prisma'

export const sqlService = {
  async run(statement: string) {
    return prisma.$queryRawUnsafe(statement)
  },
}
`,
      ],
    ])
    expect(flows).toHaveLength(1)
    expect(flows[0]).toMatchObject({
      source: { symbol: `${ROUTE}#POST`, line: 5 },
      sink: {
        symbol: `${SERVICE}#prisma.$queryRawUnsafe@5`,
        rule: 'prisma-raw',
      },
      chain: [`${ROUTE}#POST`, `${SERVICE}#sqlService.run`],
      reachability: 'EXTERNAL',
    })
  })

  it('stays silent when the callee on the hop parses the value with zod first', () => {
    const flows = flowsOf([
      [
        ROUTE,
        `import { generateText } from 'ai'
import { sqlService } from '@/lib/services/sql.service'

export async function POST(req: Request) {
  const result = await generateText({ model: m, prompt: 'p' })
  return sqlService.run(result.text)
}
`,
      ],
      [
        SERVICE,
        `import { prisma } from '@/lib/db/prisma'
import { StatementSchema } from '@/lib/validation/sql'

export const sqlService = {
  async run(statement: string) {
    const checked = StatementSchema.parse(statement)
    return prisma.$queryRawUnsafe(checked)
  },
}
`,
      ],
    ])
    expect(flows).toEqual([])
  })

  it('covers child-process, eval, new Function, fs-write and fetch sinks and an OpenAI-shaped source', () => {
    const flows = flowsOf([
      [
        'lib/agent.ts',
        `import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { streamText } from 'ai'

export async function shell() {
  const r = await streamText({ model: m, prompt: 'p' })
  execSync(\`sh -c "\${r.text}"\`)
}
export async function code() {
  const completion = await openai.chat.completions.create({ model: 'x', messages: [] })
  const js = completion.choices[0].message.content
  eval(js)
  const fn = new Function(js)
  return fn
}
export async function file() {
  const { text } = await streamText({ model: m, prompt: 'p' })
  writeFileSync('/tmp/out', text)
  return fetch(text)
}
export async function harmless() {
  const { text } = await streamText({ model: m, prompt: 'p' })
  return JSON.stringify({ text })
}
`,
      ],
    ])
    const rules = flows.map(f => f.sink.rule).sort()
    expect(rules).toEqual(
      ['child-process', 'eval', 'fetch', 'fs-write', 'new-function'].sort()
    )
    expect(flows.every(f => f.reachability === 'UNKNOWN')).toBe(true)
  })

  it('never reports a model result that only flows into another model call or a redirect', () => {
    const flows = flowsOf([
      [
        'lib/chain.ts',
        `import { generateText } from 'ai'
import { redirect } from 'next/navigation'

export async function chain() {
  const a = await generateText({ model: m, prompt: 'p' })
  const b = await generateText({ model: m, prompt: a.text })
  redirect(b.text)
}
`,
      ],
    ])
    expect(flows).toEqual([])
  })

  it('classifies every AI SDK and SDK-client shape as an llm-output source', () => {
    for (const callee of [
      'generateText',
      'ai.generateObject',
      'streamText',
      'openai.chat.completions.create',
      'anthropic.messages.create',
      'client.responses.create',
    ]) {
      expect(matchCallRule(SOURCE_RULES, callee)?.id).toBe('llm-output')
    }
    expect(matchCallRule(SOURCE_RULES, 'prisma.task.create')).toBeNull()
    expect(matchCallRule(SOURCE_RULES, 'fetch')).toBeNull()
  })

  it('has severity and CWE metadata for every target sink', () => {
    for (const sink of LLM_OUTPUT_TARGET_SINKS) {
      expect(LLM_OUTPUT_SINK_META[sink].cwe).toMatch(/^CWE-\d+$/)
      expect(['HIGH', 'MEDIUM']).toContain(LLM_OUTPUT_SINK_META[sink].severity)
    }
  })
})
