/**
 * @jest-environment node
 *
 * LUM-798 follow-up — the two things 28 post-deploy scans showed were still
 * broken after the first cut.
 *
 * Production, 40 candidates on the new gate, 100% rejected: 19 could not
 * place their sink, 8 placed the sink but not the entry, and 13 placed BOTH
 * and then died at `chain-disconnected`. So placement worked for 21 of 40 —
 * and the tally reported `subgraph 0 · sinkRule 0 · sandbox 0`, because it
 * only counted a placement when the candidate also survived. The read-out
 * built to answer "did placement work" could not tell "never placed" from
 * "placed, then rejected" — this task's own error, one level up.
 */
import { buildSubgraph } from '@/ee/security/security-scan/graph/build-subgraph'
import {
  mechanicalVerify,
  candidateSymbolRefs,
} from '@/ee/security/security-scan/hunt/mechanical-verify'
import {
  fileSightingsInSource,
  sightingsInSource,
} from '@/ee/security/security-scan/hunt/repo-symbols'

const ROUTE = 'app/api/tasks/[id]/route.ts'
const AI = 'lib/ai/summary.ts'
const CLI = 'cli/src/commands/task-testcase-run.ts'

const ROUTE_SOURCE = `import { summarize } from '@/lib/ai/summary'

export async function PATCH(req: Request) {
  const body = await req.json()
  return summarize(body.text)
}
`

const AI_SOURCE = `import { generateText } from 'ai'

export async function summarize(text: string) {
  return generateText({ model: 'x', prompt: text })
}
`

/**
 * The production shape of the eight entry failures: the export is real and
 * near the top, and the agent pointed at a line much further down.
 */
const CLI_SOURCE = [
  "import { spawnSync } from 'node:child_process'",
  '',
  'export async function taskTestcaseRun(id: string) {',
  '  const info = readGitCoordinate()',
  '  return spawnSync("git", ["rev-parse", id, info])',
  '}',
  '',
  'function readGitCoordinate() {',
  '  return "HEAD"',
  '}',
  '',
  '// padding so the claimed line below is inside the file',
  '// padding',
  '// padding',
  '// padding',
  '// padding',
  '// padding',
  '// padding',
  '// padding',
  '// padding',
].join('\n')

const g = buildSubgraph([
  { path: ROUTE, source: ROUTE_SOURCE, touched: true },
  { path: AI, source: AI_SOURCE, touched: true },
  { path: CLI, source: CLI_SOURCE, touched: true },
])

const SOURCES: Record<string, string> = {
  [ROUTE]: ROUTE_SOURCE,
  [AI]: AI_SOURCE,
  [CLI]: CLI_SOURCE,
}

/** Exactly what `collectVerifyGraph` gathers, over the same sources. */
function evidenceFor(candidates: unknown[]) {
  const refs = candidates.flatMap(candidateSymbolRefs)
  const sightings: string[] = []
  const fileSightings: string[] = []
  for (const [path, source] of Object.entries(SOURCES)) {
    sightings.push(...sightingsInSource(refs, path, source))
    fileSightings.push(...fileSightingsInSource(refs, path, source))
  }
  return { sightings, fileSightings, missingFiles: [] }
}

const run = (candidates: unknown[]) =>
  mechanicalVerify(g, candidates, evidenceFor(candidates))

/** Sink placed by a SINK_RULES callee; chain written in full-id form. */
const libraryCandidate = () => ({
  category: 'prompt_injection' as const,
  cwe: 'CWE-1427',
  severity: 'HIGH' as const,
  sink: { symbol: 'generateText', file: AI, line: 4 },
  entry: { symbol: `${ROUTE}#PATCH`, file: ROUTE, line: 3 },
  call_chain: [
    { from: `${ROUTE}#PATCH`, to: `${AI}#summarize` },
    { from: `${AI}#summarize`, to: `${AI}#generateText@4` },
  ],
  precondition: 'body.text is attacker controlled',
  claim: 'request body becomes the model prompt',
})

describe('LUM-798 follow-up the audit says where a candidate died', () => {
  it('counts a placement even when the candidate is rejected downstream', () => {
    // Sink placed by rule, then killed by a chain that contradicts itself.
    const brokenChain = {
      ...libraryCandidate(),
      call_chain: [{ from: `${AI}#summarize`, to: `${AI}#generateText@4` }],
    }
    const { accepted, rejected, resolution } = run([brokenChain])

    expect(accepted).toEqual([])
    expect(rejected[0]!.reason).toBe('chain-disconnected')
    // The whole point: the placement axis SAW it, the outcome axis rejected
    // it. Before this, both read zero and the two cases were one.
    expect(resolution.placed).toEqual({ subgraph: 0, sinkRule: 1, sandbox: 0 })
    expect(resolution.unplaced).toBe(0)
    expect(resolution.accepted).toBe(0)
    expect(resolution.rejected).toBe(1)
  })

  it('keeps both partitions exact over a mixed batch', () => {
    const good = libraryCandidate()
    const brokenChain = {
      ...libraryCandidate(),
      call_chain: [{ from: `${AI}#summarize`, to: `${AI}#generateText@4` }],
    }
    const unplaceable = {
      ...libraryCandidate(),
      sink: { symbol: `${AI}#nowhereAtAll@3`, file: AI, line: 3 },
      call_chain: [{ from: `${ROUTE}#PATCH`, to: `${AI}#nowhereAtAll@3` }],
    }
    const garbage = { category: 'idor' }
    const raw = [good, brokenChain, unplaceable, garbage]
    const { resolution } = run(raw)

    const placedTotal =
      resolution.placed.subgraph +
      resolution.placed.sinkRule +
      resolution.placed.sandbox
    // placement axis and outcome axis each partition the submissions.
    expect(placedTotal + resolution.unplaced).toBe(raw.length)
    expect(resolution.accepted + resolution.rejected).toBe(raw.length)
    expect(resolution.accepted).toBeLessThanOrEqual(placedTotal)
    expect(resolution.accepted).toBe(1)
  })

  it('records the entry own file and line on an entry failure, not the sink location', () => {
    // Production printed `symbol-not-found-in-repo:POST` next to the SINK's
    // path — a row that reads as a sink failure and is not one.
    const badEntry = {
      ...libraryCandidate(),
      entry: { symbol: 'POST', file: CLI, line: 20 },
      call_chain: [{ from: 'POST', to: `${AI}#generateText@4` }],
    }
    const { rejected } = run([badEntry])

    expect(rejected[0]!.reason).toBe('symbol-not-found-in-repo:POST')
    expect(rejected[0]).toMatchObject({
      sink: 'generateText',
      sinkFile: AI,
      sinkLine: 4,
      entry: 'POST',
      entryFile: CLI,
      entryLine: 20,
    })
  })
})

describe('LUM-798 follow-up naming levels', () => {
  it('places an entry whose name is in the file it claimed but not on the claimed line', () => {
    // `taskTestcaseRun` is declared on line 3; the agent said line 20. The
    // symbol is real — only its line is the agent's guess, and the candidate
    // carries that distinction instead of dying on it.
    const offByLines = {
      ...libraryCandidate(),
      category: 'injection' as const,
      cwe: 'CWE-74',
      sink: { symbol: 'spawnSync', file: CLI, line: 5 },
      entry: { symbol: 'taskTestcaseRun', file: CLI, line: 20 },
      call_chain: [{ from: 'taskTestcaseRun', to: 'spawnSync' }],
    }
    const { accepted, rejected } = run([offByLines])

    expect(rejected).toEqual([])
    expect(accepted[0]).toMatchObject({
      resolvedBy: 'sink-rule',
      sinkRule: 'child-process',
      entryLineUnconfirmed: true,
    })
  })

  it('connects a chain written in id form to a sink named as a bare callee', () => {
    // 13 of 40 production rejections were exactly this: placement accepted
    // `generateText`, and the chain named the same call `lib/ai/summary.ts#generateText@4`.
    const { accepted, rejected } = run([libraryCandidate()])

    expect(rejected).toEqual([])
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.reachability).toBe('UNKNOWN')
  })

  it('still refuses to equate the same name in two different files', () => {
    const wrongFile = {
      ...libraryCandidate(),
      call_chain: [
        { from: `${CLI}#PATCH`, to: `${AI}#summarize` },
        { from: `${AI}#summarize`, to: `${AI}#generateText@4` },
      ],
    }
    const { accepted, rejected } = run([wrongFile])

    expect(accepted).toEqual([])
    expect(rejected[0]!.reason).toBe('chain-disconnected')
  })
})
