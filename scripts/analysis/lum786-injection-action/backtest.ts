/**
 * LUM-786 — retrospective validation of the injection→action correlator on
 * PRODUCTION history. Read-only: it opens the prod database, replays the
 * criterion in `correlate.ts` over every recorded injection and the actions
 * that followed it in the same session, and writes one aggregate JSON file.
 *
 * The backtest exists to answer ONE question the task made decisive: on real
 * history, does this detector produce signal or noise? It therefore reports
 * three numbers side by side, never just the hit count:
 *
 *  1. TIME_ONLY   — what a naive "an action happened after an injection"
 *                   detector would emit. The null model.
 *  2. REPORTABLE  — novel literal reproduced, no exemption applies.
 *  3. PLACEBO     — the same criterion run on SHUFFLED pairs: fragments
 *                   correlated against a session they were never injected
 *                   into. If (2) ≈ (3), the correlation carries no
 *                   information and the detector should not be built.
 *
 * Run (from the MAIN checkout, whose .env.production holds the prod URL):
 *   DOTENV_CONFIG_PATH=/abs/path/.env.production npx tsx -r dotenv/config \
 *     scripts/analysis/lum786-injection-action/backtest.ts \
 *     [--days 90] [--out scripts/analysis/lum786-injection-action/results.json]
 *
 * This is a one-off analysis CLI under scripts/analysis — `console.log` is the
 * output channel here, per the repo's carve-out for these scripts.
 */
/* eslint-disable no-console */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../../../lib/db/prisma'
import { openHookPayloads } from '../../../lib/hook-event/payload-cipher'
import {
  memoryManifestLine,
  renderMemoryItem,
  type RenderableMemory,
} from '../../../lib/memory/render'
import { isContentSignals } from '../../../shared/src/untrusted-content'
import {
  buildVocabulary,
  correlate,
  extractLiterals,
  type AgentAction,
  type Candidate,
  type InjectedFragment,
  type Tier,
  type Vocabulary,
} from './correlate'

// ─── Options ──────────────────────────────────────────────────────────────────

function arg(name: string, fallback: string | null = null): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback)
}

const DAYS = Number(arg('days', '0')) // 0 = all history
const OUT =
  arg('out') ?? 'scripts/analysis/lum786-injection-action/results.json'
const SAMPLE_SIZE = Number(arg('sample', '40'))
const EXCERPT = 200

/**
 * Literal-count buckets for the MATCHED placebo. A fake pair is only a fair
 * control if it differs from the real pair in exactly one respect — whether the
 * fragment was really injected there. Session, injection instant, vocabulary
 * and action stream are therefore held identical, and the donor is drawn from
 * the same literal-count bucket so a fragment with 30 literals is never
 * compared against one with 2.
 */
export function literalBucket(n: number): string {
  if (n <= 1) return '1'
  if (n <= 2) return '2'
  if (n <= 3) return '3'
  if (n <= 5) return '4-5'
  if (n <= 10) return '6-10'
  return '>10'
}

/**
 * Tool calls whose input is an ACTION (it changes something, reaches the
 * network, or runs a command) plus `Read`, which is kept deliberately: the
 * READ_ONLY exemption can only be measured if read reproductions are counted
 * first.
 */
const ACTING_TOOLS = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Read',
  'mcp__Claude_Browser__navigate',
  'mcp__Claude_Browser__javascript_tool',
]

// ─── Repo vocabulary (what the agent knew anyway) ─────────────────────────────

export function repoVocabulary(): Vocabulary {
  const texts: string[] = []
  try {
    texts.push(
      execFileSync('git', ['ls-files'], {
        encoding: 'utf8',
        maxBuffer: 64 << 20,
      })
    )
  } catch {
    console.warn('! git ls-files failed — repo paths will count as novel')
  }
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        texts.push(`npm install ${name}`)
      }
    }
  } catch {
    /* no package.json in this cwd — fine */
  }
  // `git ls-files` emits bare paths, which PATH_RE only matches with a leading
  // separator; feed it line by line with a space prefix.
  const prefixed = texts
    .flatMap(t => t.split('\n'))
    .map(l => ` ${l.trim()}`)
    .join('\n')
  return buildVocabulary([prefixed])
}

export function mergeVocab(...vs: Vocabulary[]): Vocabulary {
  const known = new Set<string>()
  for (const v of vs) for (const k of v.known) known.add(k)
  return { known }
}

// ─── Reconstructing what was injected ─────────────────────────────────────────

interface EdgeRow {
  id: string
  sessionId: string
  taskId: string
  fragmentType: string
  fragmentId: string
  includedAt: Date
  disclosure: string
}

/**
 * Source rows are fetched once in bulk and looked up from memory — an edge is
 * recorded per (session × fragment), so the same memory row reappears in
 * thousands of edges and a per-edge query would be thousands of round trips to
 * a remote database.
 */
interface SourceIndex {
  memories: Map<string, RenderableMemory & { signals: number; member: boolean }>
  prs: Map<
    string,
    {
      repo: string
      number: number
      title: string
      url: string
      headBranch: string
    }
  >
  slack: Map<string, { summary: string; snapshot: string; signals: number }>
}

async function loadSources(edges: EdgeRow[]): Promise<SourceIndex> {
  const idsOf = (type: string) => [
    ...new Set(
      edges.filter(e => e.fragmentType === type).map(e => e.fragmentId)
    ),
  ]

  const memoryRows = await prisma.memory.findMany({
    where: { id: { in: idsOf('MEMORY') } },
    select: {
      id: true,
      scope: true,
      category: true,
      content: true,
      createdByMemberId: true,
      contentSignals: true,
    },
  })
  const memories = new Map(
    memoryRows.map(m => [
      m.id,
      {
        id: m.id,
        scope: m.scope,
        category: m.category,
        content: m.content,
        source: (m.createdByMemberId ? 'user' : 'agent') as 'user' | 'agent',
        signals: signalCount(m.contentSignals),
        member: m.createdByMemberId != null,
      },
    ])
  )

  const prRows = await prisma.pullRequest.findMany({
    where: { id: { in: idsOf('PR') } },
    select: {
      id: true,
      repo: true,
      number: true,
      title: true,
      url: true,
      headBranch: true,
    },
  })
  const prs = new Map(prRows.map(p => [p.id, p]))

  const slackRows = await prisma.taskSlackContext.findMany({
    where: { id: { in: idsOf('SLACK_CONTEXT') } },
    select: { id: true, summary: true, snapshot: true, contentSignals: true },
  })
  const slack = new Map(
    slackRows.map(s => [
      s.id,
      {
        summary: s.summary ?? '',
        snapshot: JSON.stringify(s.snapshot ?? ''),
        signals: signalCount(s.contentSignals),
      },
    ])
  )

  return { memories, prs, slack }
}

/**
 * The bytes a fragment contributed to the context window. FULL = the rendered
 * card; INDEX = the one-line manifest and nothing else (the body was never in
 * context — `lib/memory/render.ts` truncates the headline to 100 chars).
 */
function reconstruct(
  edge: EdgeRow,
  sources: SourceIndex
): Omit<InjectedFragment, 'sessionId' | 'includedAt'> | null {
  const disclosure = edge.disclosure === 'INDEX' ? 'INDEX' : 'FULL'

  if (edge.fragmentType === 'MEMORY') {
    const m = sources.memories.get(edge.fragmentId)
    if (!m) return null
    const renderable: RenderableMemory = {
      id: m.id,
      scope: m.scope,
      category: m.category,
      content: m.content,
      source: m.source,
    }
    return {
      edgeId: edge.id,
      text:
        disclosure === 'INDEX'
          ? memoryManifestLine(renderable)
          : renderMemoryItem(renderable),
      disclosure,
      hasInjectionSignal: m.signals > 0,
      // A memory a human typed is the trusted channel; an agent-distilled one
      // is derived from untrusted material and is NOT exempt.
      memberAuthored: m.member,
      sourceLabel: `MEMORY:${m.id}`,
    }
  }

  if (edge.fragmentType === 'PR') {
    const pr = sources.prs.get(edge.fragmentId)
    if (!pr) return null
    return {
      edgeId: edge.id,
      text: `PR #${pr.number} ${pr.title}\n${pr.url}\n${pr.repo} ${pr.headBranch}`,
      disclosure,
      hasInjectionSignal: false,
      // GitHub PR text is external: never exempt on authorship.
      memberAuthored: false,
      sourceLabel: `PR:${pr.repo}#${pr.number}`,
    }
  }

  if (edge.fragmentType === 'SLACK_CONTEXT') {
    const s = sources.slack.get(edge.fragmentId)
    if (!s) return null
    return {
      edgeId: edge.id,
      text: `${s.summary}\n${s.snapshot}`,
      disclosure,
      hasInjectionSignal: s.signals > 0,
      memberAuthored: false,
      sourceLabel: `SLACK:${edge.fragmentId}`,
    }
  }

  return null
}

export function signalCount(v: unknown): number {
  return isContentSignals(v) ? v.total : 0
}

// ─── Reading the action stream ────────────────────────────────────────────────

export function payloadText(payload: unknown): string {
  const p = payload as Record<string, unknown> | null
  const input = (p?.tool_input ?? {}) as Record<string, unknown>
  const parts: string[] = []
  for (const key of [
    'command',
    'file_path',
    'url',
    'query',
    'new_string',
    'content',
    'pattern',
    'path',
    'prompt',
  ]) {
    const v = input[key]
    if (typeof v === 'string') parts.push(v)
  }
  return parts.join('\n')
}

interface SessionStream {
  actions: AgentAction[]
  /** Every user prompt text of the session (the trusted channel). */
  prompts: string[]
  /** Prompt-submit events, ascending, used to derive a turn id per action. */
  promptTimes: { id: string; at: number }[]
}

/** Page size for the per-session event scan; keeps payload volume bounded. */
const PAGE = 400

async function loadSession(
  sessionId: string,
  crossingsByHookEvent: Map<string, string[]>
): Promise<SessionStream> {
  const events: {
    id: string
    type: string
    toolName: string | null
    createdAt: Date
    payload: unknown
  }[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.hookEvent.findMany({
      where: {
        sessionId,
        OR: [
          { type: 'POST_TOOL_USE', toolName: { in: ACTING_TOOLS } },
          { type: 'USER_PROMPT_SUBMIT' },
        ],
      },
      select: {
        id: true,
        type: true,
        toolName: true,
        createdAt: true,
        payload: true,
        // LUM-863: payloads may be stored encrypted.
        payloadEncrypted: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    events.push(...(await openHookPayloads(page)))
    if (page.length < PAGE) break
    cursor = page[page.length - 1].id
  }
  events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const prompts: string[] = []
  const promptTimes: { id: string; at: number }[] = []
  const raw: Omit<AgentAction, 'promptId'>[] = []

  for (const e of events) {
    if (e.type === 'USER_PROMPT_SUBMIT') {
      const p = (e.payload as Record<string, unknown> | null)?.prompt
      if (typeof p === 'string') prompts.push(p)
      promptTimes.push({ id: e.id, at: e.createdAt.getTime() })
      continue
    }
    const text = payloadText(e.payload)
    if (text === '') continue
    raw.push({
      hookEventId: e.id,
      sessionId,
      toolName: e.toolName,
      createdAt: e.createdAt,
      text,
      crossingCategories: crossingsByHookEvent.get(e.id) ?? [],
    })
  }

  // Turn id = the most recent user prompt at or before the action. Derived from
  // the event stream rather than the payload's `prompt_id`, which only ~27% of
  // historical rows carry.
  const actions: AgentAction[] = raw.map(a => {
    const at = a.createdAt.getTime()
    let id: string | null = null
    for (const p of promptTimes) {
      if (p.at <= at) id = p.id
      else break
    }
    return { ...a, promptId: id }
  })

  return { actions, prompts, promptTimes }
}

// ─── Tally ────────────────────────────────────────────────────────────────────

interface Tally {
  byTier: Record<Tier, number>
  byExemption: Record<string, number>
  reportable: number
  reportableByLiteralKind: Record<string, number>
  reportableByTool: Record<string, number>
}

function emptyTally(): Tally {
  return {
    byTier: { NONE: 0, TIME_ONLY: 0, ADVISORY: 0, MEDIUM: 0, HIGH: 0 },
    byExemption: {},
    reportable: 0,
    reportableByLiteralKind: {},
    reportableByTool: {},
  }
}

function isReportable(c: Candidate): boolean {
  return c.exemption === null && c.tier !== 'TIME_ONLY' && c.tier !== 'NONE'
}

function add(t: Tally, c: Candidate): void {
  t.byTier[c.tier] += 1
  const key = c.exemption ?? 'none'
  t.byExemption[key] = (t.byExemption[key] ?? 0) + 1
  if (isReportable(c)) {
    t.reportable += 1
    const k = c.reproduction.literal.kind
    t.reportableByLiteralKind[k] = (t.reportableByLiteralKind[k] ?? 0) + 1
    const tool = c.reproduction.action.toolName ?? 'unknown'
    t.reportableByTool[tool] = (t.reportableByTool[tool] ?? 0) + 1
  }
}

export function bucketLag(seconds: number): string {
  if (seconds < 60) return '<1m'
  if (seconds < 600) return '1-10m'
  if (seconds < 3600) return '10-60m'
  if (seconds < 6 * 3600) return '1-6h'
  if (seconds < 24 * 3600) return '6-24h'
  return '>24h'
}

export function bucketTurn(d: number | null): string {
  if (d == null) return 'unknown'
  if (d === 0) return 'same turn'
  if (d <= 2) return '1-2 turns'
  if (d <= 10) return '3-10 turns'
  return '>10 turns'
}

/** Deterministic PRNG so a re-run reproduces the same sample (mulberry32). */
export function makeRand(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const since = DAYS > 0 ? new Date(Date.now() - DAYS * 864e5) : null
  console.log(
    `LUM-786 backtest · window: ${since ? `last ${DAYS} days` : 'all history'}`
  )

  const rand = makeRand(786)
  const repoVocab = repoVocabulary()
  console.log(`repo vocabulary: ${repoVocab.known.size} known literals`)

  const edges = (await prisma.lineageEdge.findMany({
    where: {
      sessionId: { not: null },
      ...(since ? { includedAt: { gte: since } } : {}),
    },
    select: {
      id: true,
      sessionId: true,
      taskId: true,
      fragmentType: true,
      fragmentId: true,
      includedAt: true,
      disclosure: true,
    },
    orderBy: { includedAt: 'asc' },
  })) as unknown as EdgeRow[]

  const bySession = new Map<string, EdgeRow[]>()
  for (const e of edges) {
    const list = bySession.get(e.sessionId) ?? []
    list.push(e)
    bySession.set(e.sessionId, list)
  }
  console.log(
    `injections: ${edges.length} edges across ${bySession.size} sessions`
  )

  // Crossing categories, keyed by the hook event they were detected on.
  const crossings = await prisma.boundaryCrossing.findMany({
    where: { hookEventId: { not: null } },
    select: { hookEventId: true, category: true },
  })
  const crossingsByHookEvent = new Map<string, string[]>()
  for (const c of crossings) {
    if (!c.hookEventId) continue
    const list = crossingsByHookEvent.get(c.hookEventId) ?? []
    list.push(c.category)
    crossingsByHookEvent.set(c.hookEventId, list)
  }

  const real = emptyTally()
  const placebo = emptyTally()
  const lagHistogram: Record<string, number> = {}
  const turnHistogram: Record<string, number> = {}
  const samples: unknown[] = []
  /** Every MEDIUM/HIGH candidate, kept in full — the escalation set is tiny. */
  const escalated: unknown[] = []
  let advisorySeen = 0
  /** Donor pool for the matched placebo, indexed by literal-count bucket. */
  const donorsByBucket = new Map<string, InjectedFragment[]>()
  const placeboBuckets: Record<string, number> = {}

  let sessionsProcessed = 0
  let actionsScanned = 0
  let fragmentsReconstructed = 0
  let fragmentsWithLiterals = 0

  const sources = await loadSources(edges)
  console.log(
    `sources: ${sources.memories.size} memories · ${sources.prs.size} PRs · ${sources.slack.size} slack threads`
  )

  const sessionIds = [...bySession.keys()]
  let placeboPairs = 0
  for (const [index, sessionId] of sessionIds.entries()) {
    const stream = await loadSession(sessionId, crossingsByHookEvent)
    if (stream.actions.length === 0) continue
    sessionsProcessed += 1
    actionsScanned += stream.actions.length
    if (sessionsProcessed % 25 === 0) {
      console.log(
        `  … ${sessionsProcessed}/${sessionIds.length} sessions · ${actionsScanned} actions · reportable ${real.reportable}`
      )
    }

    // Every literal the human typed in this session, in any turn: the trusted
    // channel. A literal that appears there is not evidence of injection.
    const userLiterals = new Set(
      stream.prompts
        .flatMap(p => extractLiterals(p))
        .map(l => l.value.toLowerCase())
    )

    for (const edge of bySession.get(sessionId) ?? []) {
      const base = reconstruct(edge, sources)
      if (!base) continue
      fragmentsReconstructed += 1
      const fragment: InjectedFragment = {
        ...base,
        sessionId,
        includedAt: edge.includedAt,
      }
      const literalCount = extractLiterals(fragment.text).length
      if (literalCount === 0) continue
      fragmentsWithLiterals += 1
      const bucket = literalBucket(literalCount)

      // Anything the session already did BEFORE the injection is not novel.
      const priorVocab = buildVocabulary(
        stream.actions
          .filter(a => a.createdAt.getTime() < edge.includedAt.getTime())
          .map(a => a.text)
      )
      const vocab = mergeVocab(repoVocab, priorVocab)

      for (const c of correlate(fragment, stream.actions, vocab, {
        userAsked: userLiterals,
      })) {
        add(real, c)
        if (isReportable(c)) {
          const lag = bucketLag(c.reproduction.lagSeconds)
          lagHistogram[lag] = (lagHistogram[lag] ?? 0) + 1
          const turn = bucketTurn(c.reproduction.turnDistance)
          turnHistogram[turn] = (turnHistogram[turn] ?? 0) + 1
          // Every MEDIUM/HIGH candidate is kept (they are the only ones a
          // human would ever be shown); ADVISORY ones are reservoir-sampled so
          // the sample is not biased toward the earliest sessions.
          const row = {
            tier: c.tier,
            taskId: edge.taskId,
            source: fragment.sourceLabel,
            disclosure: fragment.disclosure,
            literal: c.reproduction.literal,
            alsoMatched: c.reproduction.alsoMatched.map(l => l.value),
            lagSeconds: c.reproduction.lagSeconds,
            turnDistance: c.reproduction.turnDistance,
            tool: c.reproduction.action.toolName,
            crossingCategories: c.reproduction.action.crossingCategories,
            injectedExcerpt: fragment.text.slice(0, EXCERPT),
            actionExcerpt: c.reproduction.action.text.slice(0, EXCERPT),
            adjudication: 'UNJUDGED',
          }
          if (c.tier === 'MEDIUM' || c.tier === 'HIGH') {
            escalated.push(row)
          } else {
            advisorySeen += 1
            if (samples.length < SAMPLE_SIZE) samples.push(row)
            else {
              const j = Math.floor(rand() * advisorySeen)
              if (j < SAMPLE_SIZE) samples[j] = row
            }
          }
        }
      }

      // ── Matched placebo control ─────────────────────────────────────────────
      // One fake pair per real pair: a fragment of the same literal-count
      // bucket that was injected into a DIFFERENT session, dropped into THIS
      // session at THIS instant with THIS vocabulary. Everything the real pair
      // has except the one thing being tested — that the injection actually
      // happened here. If the fake pairs score like the real ones, the
      // criterion is reading the repo's vocabulary, not a causal link.
      const pool = donorsByBucket
        .get(bucket)
        ?.filter(d => d.sessionId !== sessionId)
      if (pool && pool.length > 0) {
        const donor = pool[(index * 7919 + placeboPairs * 104729) % pool.length]
        placeboPairs += 1
        const fake: InjectedFragment = {
          ...donor,
          sessionId,
          includedAt: edge.includedAt,
        }
        for (const c of correlate(fake, stream.actions, vocab, {
          userAsked: userLiterals,
        })) {
          add(placebo, c)
        }
      }

      // Registered only after its own placebo draw, so a fragment is never its
      // own control.
      const donors = donorsByBucket.get(bucket) ?? []
      donors.push(fragment)
      donorsByBucket.set(bucket, donors)
      placeboBuckets[bucket] = (placeboBuckets[bucket] ?? 0) + 1
    }
  }

  const results = {
    generatedAt: new Date().toISOString(),
    window: {
      days: DAYS > 0 ? DAYS : null,
      label: since ? `last ${DAYS} days` : 'all history',
      scannedFrom: edges[0]?.includedAt?.toISOString() ?? null,
      scannedTo: edges[edges.length - 1]?.includedAt?.toISOString() ?? null,
      /**
       * The correlation window itself: injection → end of session, with no
       * upper time bound. Injected text stays in the context window until the
       * session ends, so a cutoff would only hide candidates, not exclude
       * irrelevant ones. Lag and turn distance are recorded per candidate as
       * attribution strength (see lagHistogram / turnHistogram).
       */
      correlationWindow: 'injection → end of session (no upper bound)',
    },
    corpus: {
      edges: edges.length,
      sessionsWithInjections: bySession.size,
      sessionsProcessed,
      actionsScanned,
      fragmentsReconstructed,
      fragmentsWithLiterals,
      repoVocabularySize: repoVocab.known.size,
      edgesByType: Object.fromEntries(
        Object.entries(
          edges.reduce<Record<string, number>>((acc, e) => {
            acc[e.fragmentType] = (acc[e.fragmentType] ?? 0) + 1
            return acc
          }, {})
        )
      ),
    },
    real,
    placebo: {
      ...placebo,
      pairsTried: placeboPairs,
      design:
        'matched 1:1 — same session, same injection instant, same vocabulary, donor fragment from the same literal-count bucket injected into a different session',
      pairsByLiteralBucket: placeboBuckets,
    },
    lagHistogram,
    turnHistogram,
    escalated,
    escalatedCount: escalated.length,
    samples,
    sampleOf: advisorySeen,
  }

  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`)
  console.log(`\n→ ${OUT}`)
  console.log(
    `TIME_ONLY (null model): ${real.byTier.TIME_ONLY}   REPORTABLE: ${real.reportable}   PLACEBO reportable: ${placebo.reportable} over ${placeboPairs} fake pairs`
  )
  console.log('by tier:', real.byTier)
  console.log('by exemption:', real.byExemption)
  await prisma.$disconnect()
}

// Guarded so the pure helpers above can be imported by
// `__tests__/backtest-helpers.test.ts` without opening a database connection
// and replaying production. An unguarded top-level `main()` makes a module
// unimportable, which is why nothing here had a test.
if (require.main === module) {
  main().catch(async err => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
}
