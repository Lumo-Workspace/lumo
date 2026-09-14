/** @jest-environment node */
import { buildSubgraph } from '@/lib/security-scan/graph/build-subgraph'
import { mechanicalVerify } from '@/lib/security-scan/hunt/mechanical-verify'

const ROUTE = 'app/api/tasks/[id]/route.ts'
const SERVICE = 'lib/services/task.service.ts'
const SINK = `${SERVICE}#prisma.$queryRawUnsafe@5`

const g = buildSubgraph([
  {
    path: ROUTE,
    source: `import { taskService } from '@/lib/services/task.service'

export async function PATCH(req: Request) {
  const body = await req.json()
  return taskService.update(body)
}

export function plain() {
  return 1
}
`,
    touched: true,
  },
  {
    path: SERVICE,
    source: `import { prisma } from '@/lib/db/prisma'

export const taskService = {
  async update(b: { sql: string }) {
    return prisma.$queryRawUnsafe(b.sql)
  },
}
`,
    touched: false,
  },
])

const good = () => ({
  category: 'injection',
  cwe: 'CWE-89',
  severity: 'HIGH',
  sink: { symbol: SINK, file: SERVICE, line: 5 },
  entry: { symbol: `${ROUTE}#PATCH`, file: ROUTE, line: 3 },
  call_chain: [
    { from: `${ROUTE}#PATCH`, to: `${SERVICE}#taskService.update` },
    { from: `${SERVICE}#taskService.update`, to: SINK },
  ],
  precondition: 'attacker controls body.sql',
  claim: 'request body reaches $queryRawUnsafe unparsed',
})

describe('LUM-739 graph mechanical verify', () => {
  it('accepts a well-formed candidate with reachability and a 16-char fingerprint', () => {
    const { accepted, rejected } = mechanicalVerify(g, [good()])
    expect(rejected).toEqual([])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({
      category: 'injection',
      reachability: 'EXTERNAL',
    })
    expect(accepted[0]!.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('rejects a candidate missing call_chain with a schema reason', () => {
    const c = good() as Record<string, unknown>
    delete c.call_chain
    const { accepted, rejected } = mechanicalVerify(g, [c])
    expect(accepted).toEqual([])
    expect(rejected[0]).toMatchObject({ category: 'injection', sink: SINK })
    expect(rejected[0]!.reason).toMatch(/^schema:call_chain:/)
  })

  it('rejects unknown symbols, non-entry entries, bad lines, missing edges, broken chains and duplicates', () => {
    const unknownSink = {
      ...good(),
      sink: { symbol: 'x#y@1', file: SERVICE, line: 5 },
    }
    const notEntry = {
      ...good(),
      entry: { symbol: `${ROUTE}#plain`, file: ROUTE, line: 8 },
      call_chain: [{ from: `${ROUTE}#plain`, to: SINK }],
    }
    const badLine = {
      ...good(),
      sink: { symbol: SINK, file: SERVICE, line: 99 },
    }
    const missingEdge = {
      ...good(),
      call_chain: [{ from: `${ROUTE}#PATCH`, to: SINK }],
    }
    const disconnected = {
      ...good(),
      call_chain: [{ from: `${SERVICE}#taskService.update`, to: SINK }],
    }
    const { accepted, rejected } = mechanicalVerify(g, [
      unknownSink,
      notEntry,
      badLine,
      missingEdge,
      disconnected,
      good(),
      good(),
    ])
    expect(accepted).toHaveLength(1)
    expect(rejected.map(r => r.reason)).toEqual([
      'symbol-not-in-subgraph:x#y@1',
      `entry-not-entry:${ROUTE}#plain`,
      `line-out-of-range:${SERVICE}:99`,
      `edge-not-in-subgraph:${ROUTE}#PATCH->${SINK}`,
      'chain-disconnected',
      'duplicate',
    ])
  })

  it('rejects non-object garbage without throwing', () => {
    const { rejected } = mechanicalVerify(g, [null, 42, 'x'])
    expect(rejected).toHaveLength(3)
    expect(rejected[0]).toMatchObject({ category: 'unknown', sink: '' })
  })
})
