/**
 * @jest-environment node
 *
 * LUM-798 — the mechanical gate judges "is this symbol in the REPOSITORY",
 * not "is this symbol in the subgraph I happened to build".
 *
 * Production forensics behind these cases: 129 hunt scans, 12M tokens, 23
 * candidates, 0 findings — and every one of the 23 rejected with the same
 * reason, `symbol-not-in-subgraph`. No line check, no chain check and no
 * falsifier ever ran. The three tiers below are the three shapes those 23
 * rejections actually had.
 */
import { buildSubgraph } from '@/ee/security/security-scan/graph/build-subgraph'
import {
  mechanicalVerify,
  candidateSymbolRefs,
} from '@/ee/security/security-scan/hunt/mechanical-verify'
import { sightingsInSource } from '@/ee/security/security-scan/hunt/repo-symbols'
import { formatPrScan, type PrScanEntry } from '@/cli/src/commands/pr-scan'

const ROUTE = 'app/api/tasks/[id]/route.ts'
const SERVICE = 'lib/services/task.service.ts'
const AI = 'lib/ai/summary.ts'
const REPO_FILE = 'lib/repositories/document.repository.ts'
const SINK = `${SERVICE}#prisma.$queryRawUnsafe@5`

const ROUTE_SOURCE = `import { taskService } from '@/lib/services/task.service'

export async function PATCH(req: Request) {
  const body = await req.json()
  return taskService.update(body)
}

export function plain() {
  return 1
}
`

const SERVICE_SOURCE = `import { prisma } from '@/lib/db/prisma'

export const taskService = {
  async update(b: { sql: string }) {
    return prisma.$queryRawUnsafe(b.sql)
  },
}
`

const AI_SOURCE = `import { generateText } from 'ai'

export async function summarize(text: string) {
  return generateText({ model: 'x', prompt: text })
}
`

/**
 * The LUM-798 ② / ③ shape: the symbol is plainly in the repo and the file is
 * read, but the graph indexes a function at its DEFINITION site while the
 * candidate names it at the CALL site — which is a different id. The call
 * sits on line 4; line 12 is far enough away to be a clean negative.
 */
const REPO_SOURCE = `export const documentRepository = {
  async read(id: string, userId: string) {
    const scope = await resolveScope(userId)
    return documentRepository.findWithPermission(id, scope)
  },

  async list(userId: string) {
    return [userId]
  },

  async count() {
    return 0
  },
}
`

const g = buildSubgraph([
  { path: ROUTE, source: ROUTE_SOURCE, touched: true },
  { path: SERVICE, source: SERVICE_SOURCE, touched: false },
  { path: AI, source: AI_SOURCE, touched: true },
  { path: REPO_FILE, source: REPO_SOURCE, touched: false },
])

const base = () => ({
  category: 'injection' as const,
  cwe: 'CWE-89',
  severity: 'HIGH' as const,
  sink: { symbol: SINK, file: SERVICE, line: 5 },
  entry: { symbol: `${ROUTE}#PATCH`, file: ROUTE, line: 3 },
  call_chain: [
    { from: `${ROUTE}#PATCH`, to: `${SERVICE}#taskService.update` },
    { from: `${SERVICE}#taskService.update`, to: SINK },
  ],
  precondition: 'attacker controls body.sql',
  claim: 'request body reaches $queryRawUnsafe unparsed',
})

/** The ① shape: a library callee, which can never carry a `<file>#<name>` id. */
const libraryCandidate = () => ({
  ...base(),
  category: 'prompt_injection' as const,
  cwe: 'CWE-1427',
  sink: { symbol: 'generateText', file: AI, line: 4 },
  call_chain: [{ from: `${ROUTE}#PATCH`, to: 'generateText' }],
  claim: 'request body becomes the model prompt',
})

/** The ② / ③ shape: a real repo symbol named at a site the graph never read. */
const callSiteCandidate = (line = 4) => ({
  ...base(),
  category: 'idor' as const,
  cwe: 'CWE-639',
  sink: {
    symbol: `${REPO_FILE}#documentRepository.findWithPermission@${line}`,
    file: REPO_FILE,
    line,
  },
  call_chain: [
    {
      from: `${ROUTE}#PATCH`,
      to: `${REPO_FILE}#documentRepository.findWithPermission@${line}`,
    },
  ],
  claim: 'the document id is trusted from the request',
})

const sightingsFor = (candidate: unknown, path: string, source: string) =>
  sightingsInSource(candidateSymbolRefs(candidate), path, source)

describe('LUM-798 the mechanical gate places symbols in the repo', () => {
  it('accepts a library sink named by a SINK_RULES callee with no subgraph symbol', () => {
    const c = libraryCandidate()
    // Precondition of the whole task: the bare callee is NOT a graph symbol,
    // which is exactly why the old gate rejected all four `generateText`
    // candidates production ever produced.
    expect(g.symbols.some(s => s.id === c.sink.symbol)).toBe(false)

    const { accepted, rejected } = mechanicalVerify(g, [c])

    expect(rejected).toEqual([])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]).toMatchObject({
      category: 'prompt_injection',
      resolvedBy: 'sink-rule',
      sinkRule: 'llm-call',
    })
  })

  it('accepts a call-site symbol the sandbox sighted on its own file line', () => {
    const c = callSiteCandidate()
    // The file is read, and the graph still does not hold this id: it indexes
    // the DEFINITION (`…#documentRepository.read`), the candidate names the
    // CALL (`…#documentRepository.findWithPermission@4`). That mismatch alone
    // killed a production candidate whose id shape was perfectly correct.
    expect(g.files.some(f => f.path === REPO_FILE)).toBe(true)
    expect(g.symbols.some(s => s.id === c.sink.symbol)).toBe(false)

    const sightings = sightingsFor(c, REPO_FILE, REPO_SOURCE)
    expect(sightings).toEqual([
      `${REPO_FILE}:4:${REPO_FILE}#documentRepository.findWithPermission@4`,
    ])

    const { accepted, rejected } = mechanicalVerify(g, [c], {
      sightings,
      fileSightings: [],
      missingFiles: [],
    })
    expect(rejected).toEqual([])
    expect(accepted[0]).toMatchObject({ resolvedBy: 'sandbox' })

    // And it is a real check, not a rubber stamp: point the same symbol at a
    // line that does not carry it and no sighting is produced, so the gate
    // falls through to the honest rejection.
    const wrongLine = callSiteCandidate(12)
    expect(sightingsFor(wrongLine, REPO_FILE, REPO_SOURCE)).toEqual([])
    const second = mechanicalVerify(g, [wrongLine], {
      sightings: [],
      fileSightings: [],
      missingFiles: [],
    })
    expect(second.accepted).toEqual([])
    expect(second.rejected[0]!.reason).toBe(
      `symbol-not-found-in-repo:${wrongLine.sink.symbol}`
    )
  })

  it('hands an ungraphed sink to the falsifier as UNKNOWN instead of dropping it', () => {
    const { accepted } = mechanicalVerify(g, [libraryCandidate()])

    // LUM-739's own rule, finally applied to naming: what the graph cannot
    // answer is UNKNOWN and travels on, it is not read as "not there".
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.reachability).toBe('UNKNOWN')
    expect(accepted[0]!.chainUnverified).toBe(true)

    // The chain is still checked wherever the graph CAN answer: both
    // endpoints graphed and no edge between them is a contradiction.
    const bothGraphed = {
      ...base(),
      call_chain: [{ from: `${ROUTE}#PATCH`, to: SINK }],
    }
    const { accepted: none, rejected } = mechanicalVerify(g, [bothGraphed])
    expect(none).toEqual([])
    expect(rejected[0]!.reason).toBe(
      `edge-not-in-subgraph:${ROUTE}#PATCH->${SINK}`
    )
  })

  it('still rejects hallucinated symbols, out-of-range lines, non-entry entries, missing edges, broken chains and duplicates', () => {
    const hallucinated = {
      ...base(),
      sink: { symbol: `${SERVICE}#gitGate@5`, file: SERVICE, line: 5 },
      call_chain: [{ from: `${ROUTE}#PATCH`, to: `${SERVICE}#gitGate@5` }],
    }
    const goneFile = {
      ...base(),
      sink: {
        symbol: 'lib/imaginary.ts#leak@2',
        file: 'lib/imaginary.ts',
        line: 2,
      },
      call_chain: [{ from: `${ROUTE}#PATCH`, to: 'lib/imaginary.ts#leak@2' }],
    }
    // A path the verification read never opens at all (not a repo TS file).
    // "Never looked" must not be reported as "not in the repository" — that
    // is the same overclaim LUM-798 removes, one level down.
    const unread = {
      ...base(),
      sink: { symbol: 'docs/spec.md#leak@2', file: 'docs/spec.md', line: 2 },
      call_chain: [{ from: `${ROUTE}#PATCH`, to: 'docs/spec.md#leak@2' }],
    }
    const badLine = {
      ...base(),
      sink: { symbol: SINK, file: SERVICE, line: 99 },
    }
    const notEntry = {
      ...base(),
      entry: { symbol: `${ROUTE}#plain`, file: ROUTE, line: 8 },
      call_chain: [{ from: `${ROUTE}#plain`, to: SINK }],
    }
    const missingEdge = {
      ...base(),
      call_chain: [{ from: `${ROUTE}#PATCH`, to: SINK }],
    }
    const disconnected = {
      ...base(),
      call_chain: [{ from: `${SERVICE}#taskService.update`, to: SINK }],
    }
    const badCwe = { ...base(), cwe: '89' }

    const { accepted, rejected } = mechanicalVerify(
      g,
      [
        hallucinated,
        goneFile,
        unread,
        badLine,
        notEntry,
        missingEdge,
        disconnected,
        badCwe,
        base(),
        base(),
      ],
      { sightings: [], fileSightings: [], missingFiles: ['lib/imaginary.ts'] }
    )

    expect(accepted).toHaveLength(1)
    expect(rejected.map(r => r.reason)).toEqual([
      `symbol-not-found-in-repo:${SERVICE}#gitGate@5`,
      'file-not-found:lib/imaginary.ts',
      'symbol-not-verifiable:docs/spec.md',
      `line-out-of-range:${SERVICE}:99`,
      `entry-not-entry:${ROUTE}#plain`,
      `edge-not-in-subgraph:${ROUTE}#PATCH->${SINK}`,
      'chain-disconnected',
      'schema:cwe:Invalid string: must match pattern /^CWE-\\d{1,5}$/',
      'duplicate',
    ])
    // A rejection now quotes the candidate, so it can be re-read rather than
    // only counted — the audit is the point of the drop.
    expect(rejected[0]).toMatchObject({
      category: 'injection',
      entry: `${ROUTE}#PATCH`,
      sinkFile: SERVICE,
      sinkLine: 5,
      entryFile: ROUTE,
      entryLine: 3,
    })
  })

  it('reports a resolution distribution covering every candidate it saw', () => {
    const callSite = callSiteCandidate()
    const raw = [
      base(), // subgraph
      libraryCandidate(), // sink rule
      callSite, // sandbox sighting
      { ...base(), cwe: 'nope' }, // rejected (schema)
      null, // rejected (not even an object)
    ]
    const { accepted, rejected, resolution } = mechanicalVerify(g, raw, {
      sightings: sightingsFor(callSite, REPO_FILE, REPO_SOURCE),
      fileSightings: [],
      missingFiles: [],
    })

    expect(resolution).toEqual({
      placed: { subgraph: 1, sinkRule: 1, sandbox: 1 },
      unplaced: 2,
      accepted: 3,
      rejected: 2,
    })
    // Two partitions of the same submissions — placement and outcome. The
    // first version had only one, and it answered neither question (see
    // mechanical-verify-followup.test.ts).
    const placedTotal =
      resolution.placed.subgraph +
      resolution.placed.sinkRule +
      resolution.placed.sandbox
    expect(placedTotal + resolution.unplaced).toBe(raw.length)
    expect(resolution.accepted + resolution.rejected).toBe(raw.length)
    expect(accepted).toHaveLength(3)
    expect(rejected).toHaveLength(2)

    // …and the audit's copy of it is what `lumo pr scan` prints, so the next
    // round reads this change's effect instead of re-deriving it.
    const scan = {
      id: 's1',
      headSha: 'abc1234def',
      status: 'COMPLETED',
      trigger: 'PR_OPENED',
      judgeStatus: null,
      truncated: false,
      stages: { hunt: 'RAN' },
      partial: false,
      externalFailureReason: null,
      startedAt: '2026-09-16T00:00:00.000Z',
      finishedAt: '2026-09-16T00:10:00.000Z',
      tokenSpent: 1000,
      counts: {
        findings: 0,
        open: 0,
        blocking: 0,
        dispositioned: 0,
        persisting: 0,
        externalFindings: 0,
        dependencyFindings: 0,
      },
      queueExits: {},
      findings: [],
      hunt: {
        coverage: null,
        plannedBy: 'model',
        plannedReason: null,
        diff: null,
        candidates: raw.length,
        falsifierRejects: 0,
        mechanicallyRejected: rejected.length,
        resolution: { kind: 'placement' as const, ...resolution },
        error: null,
        tasks: [],
      },
    } satisfies PrScanEntry

    const printed = formatPrScan(
      {
        version: 1,
        pullRequest: {
          repo: 'Lumo-Workspace/lumo',
          number: 1030,
          title: 'feat: place symbols in the repo [LUM-798]',
          url: 'https://github.com/Lumo-Workspace/lumo/pull/1030',
          state: 'open',
          task: null,
        },
        scans: [scan],
        all: false,
        redactedSecrets: 0,
      },
      { full: true }
    )
    expect(printed).toMatch(
      /^ +Placed by: +subgraph 1 · sink rule 1 · sandbox 1 · unplaced 2$/m
    )
    expect(printed).toMatch(/^ +Outcome: +survived 3 · rejected 2$/m)
  })
})
