/** @jest-environment node */
import {
  buildSubgraph,
  listImports,
  countLines,
} from '@/lib/security-scan/graph/build-subgraph'
import type { Subgraph } from '@/lib/security-scan/graph/types'

const ROUTE = 'app/api/tasks/[id]/route.ts'
const SERVICE = 'lib/services/task.service.ts'
const HELPER = 'app/api/tasks/[id]/helper.ts'

const routeSource = `import { taskService } from '@/lib/services/task.service'
import { helper } from './helper'
import { schema } from '@/lib/validation/task'

export async function PATCH(req: Request) {
  const body = schema.parse(await req.json())
  helper()
  return taskService.update(body)
}

export function notAnEntry() {
  return 1
}
`

const serviceSource = `import { prisma } from '@/lib/db/prisma'

export const taskService = {
  async update(b: { sql: string }) {
    return prisma.$queryRawUnsafe(b.sql)
  },
  list: async () => prisma.task.findMany(),
}
`

const helperSource = `export function helper() {
  return fetch('https://example.com')
}
`

const inputs = [
  { path: ROUTE, source: routeSource, touched: true },
  {
    path: 'lib/services/task.service.ts',
    source: serviceSource,
    touched: false,
  },
  { path: HELPER, source: helperSource, touched: false },
]

const sym = (g: Subgraph, id: string) => g.symbols.find(s => s.id === id)
const hasEdge = (g: Subgraph, from: string, to: string) =>
  g.edges.some(e => e.from === from && e.to === to)

describe('LUM-739 graph subgraph', () => {
  const g = buildSubgraph(inputs)

  it('classifies an exported route handler as an entry with its zod control', () => {
    const patch = sym(g, `${ROUTE}#PATCH`)
    expect(patch).toMatchObject({
      kind: 'entry',
      rule: 'next-route-handler',
      line: 5,
      controls: ['zod-parse'],
    })
    expect(sym(g, `${ROUTE}#notAnEntry`)?.kind).toBe('function')
    const control = g.symbols.find(
      s => s.kind === 'control' && s.file === ROUTE
    )
    expect(control).toMatchObject({
      id: `${ROUTE}#schema.parse@6`,
      rule: 'zod-parse',
    })
    expect(hasEdge(g, `${ROUTE}#PATCH`, `${ROUTE}#schema.parse@6`)).toBe(true)
  })

  it('records a prisma raw sink inside a service-object method', () => {
    const update = sym(g, `${SERVICE}#taskService.update`)
    expect(update?.kind).toBe('function')
    const sink = g.symbols.find(s => s.kind === 'sink' && s.file === SERVICE)
    expect(sink).toMatchObject({
      id: `${SERVICE}#prisma.$queryRawUnsafe@5`,
      rule: 'prisma-raw',
      line: 5,
    })
    expect(hasEdge(g, `${SERVICE}#taskService.update`, sink!.id)).toBe(true)
    expect(sym(g, `${SERVICE}#taskService.list`)).toBeDefined()
  })

  it('links a cross-file call through an @/ import and a relative import', () => {
    expect(hasEdge(g, `${ROUTE}#PATCH`, `${SERVICE}#taskService.update`)).toBe(
      true
    )
    expect(hasEdge(g, `${ROUTE}#PATCH`, `${HELPER}#helper`)).toBe(true)
    expect(hasEdge(g, `${HELPER}#helper`, `${HELPER}#fetch@2`)).toBe(true)
  })

  it('treats exported functions of a "use server" file as entries', () => {
    const g2 = buildSubgraph([
      {
        path: 'app/actions/save.ts',
        source: `'use server'\nexport async function saveTask() { return 1 }\nfunction internal() { return 2 }\n`,
        touched: true,
      },
    ])
    expect(sym(g2, 'app/actions/save.ts#saveTask')).toMatchObject({
      kind: 'entry',
      rule: 'next-server-action',
    })
    expect(sym(g2, 'app/actions/save.ts#internal')?.kind).toBe('function')
  })

  it('records new Function as a sink and attributes top-level calls to <module>', () => {
    const g2 = buildSubgraph([
      {
        path: 'lib/x.ts',
        source: `const f = new Function('x')\nfetch('u')\nexport class Svc {\n  run() { return eval('1') }\n}\n`,
        touched: true,
      },
    ])
    expect(sym(g2, 'lib/x.ts#new Function@1')).toMatchObject({
      kind: 'sink',
      rule: 'new-function',
    })
    expect(sym(g2, 'lib/x.ts#<module>')?.kind).toBe('module')
    expect(hasEdge(g2, 'lib/x.ts#<module>', 'lib/x.ts#fetch@2')).toBe(true)
    expect(hasEdge(g2, 'lib/x.ts#Svc.run', 'lib/x.ts#eval@4')).toBe(true)
  })

  it('carries per-file line counts and touched flags, with no duplicate symbols or edges', () => {
    expect(g.files).toEqual([
      { path: ROUTE, lineCount: 13, touched: true },
      { path: SERVICE, lineCount: 8, touched: false },
      { path: HELPER, lineCount: 3, touched: false },
    ])
    const ids = g.symbols.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = g.edges.map(e => `${e.from}->${e.to}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('listImports and countLines are exact', () => {
    expect(listImports(ROUTE, routeSource)).toEqual([
      '@/lib/services/task.service',
      './helper',
      '@/lib/validation/task',
    ])
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('')).toBe(0)
  })
})
