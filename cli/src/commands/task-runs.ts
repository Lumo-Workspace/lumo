import { EXIT_USAGE } from '../lib/exit-codes'
import { emitJson, withVersion } from '../lib/json-output'
import {
  NONE,
  fmtCount,
  fmtTimestamp,
  fmtTokens,
  formatDuration,
  formatDurationSec,
} from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { hint } from '../lib/feedback'
import { nextStepsSilenced } from '../lib/next-steps'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { apiCall, apiContext } from '../lib/test-case-api'
import {
  SESSION_RECAP_FENCE,
  SESSION_RECAP_PREAMBLE,
  renderUntrustedFence,
} from '../../../shared/src/untrusted-fence'
import { neutralizeWrapperEscapes } from '../../../shared/src/untrusted-content'

/**
 * LUM-1188 — `lumo task runs`: the task dossier's "Agent runs" section in the
 * terminal. Every number comes from GET /api/tasks/[id]/agent-runs/report,
 * which derives it the same way the web page does; this file only renders.
 *
 * Local copy of the wire shape — the CLI is a separate package and must not
 * import from the app.
 */

type Confidence = 'EXPLICIT' | 'HIGH' | 'MEDIUM'
type Source = 'SESSION_ATTACH' | 'SUBAGENT_ATTACH' | 'INHERITED' | 'INFERRED'
type Mode = 'EXPLICIT' | 'INFERRED' | 'HOST'

interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}
interface Evidence {
  kind: string
  identifier: string
  at: string
  count: number
}
interface Interval {
  p25: number
  median: number
  p75: number
}
interface ProgressMetric {
  forecast: Interval | null
  actual: number | null
  deltaPct: number | null
  band: 'on-track' | 'over' | null
}
interface TaskForecast {
  insufficientData: boolean
  cohortSize: number
  iterations: Interval | null
  mergedPrs: Interval | null
  cycleHours: Interval | null
  tokenCost: Interval | null
  tokenCostBasis: number
  interactionRounds: Interval | null
  confidence: 'low' | 'medium' | 'high'
}

export interface RunReportRun {
  runNumber: number
  sessionId: string | null
  agent: string
  member: string | null
  startedAt: string
  durationMs: number
  turnCount: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  summary: string | null
  digest: string[]
  cost: { byModel: ModelCost[]; total: number; loopCount: number | null } | null
  preDedupe: boolean
  attribution: {
    mode: Mode
    weakestConfidence: Confidence | null
    approximate: boolean
    segments: Array<{
      source: Source
      confidence: Confidence
      fromTurn: number
      toTurn: number
      evidence: Evidence[]
    }>
    subagents: Array<{
      agentType: string | null
      count: number
      source: Source
      confidence: Confidence
      followsParent: boolean
      evidence: Evidence[]
    }>
  } | null
  memories: Array<{ category: string; headline: string }>
}

export interface RunReport {
  overview: {
    sessions: { explicit: number; inferred: number } | null
    approximate: boolean
    preDedupe: boolean
  }
  totals: {
    runCount: number
    loopCount: number | null
    byModel: ModelCost[]
    total: number
  }
  perMember: Array<{
    name: string
    runCount: number
    loopCount: number
    byModel: ModelCost[]
    total: number
  }>
  progress: {
    sessionCount: number
    forecast: TaskForecast
    tokenCost: ProgressMetric
    iterations: ProgressMetric
    interactionRounds: ProgressMetric
    totalDuration: ProgressMetric
  } | null
  runs: RunReportRun[]
}

// Same wording as the web labels (attribution-labels.ts / en.json).
const MODE_LABEL: Record<Mode, string> = {
  EXPLICIT: 'Bound',
  INFERRED: 'Auto-detected',
  HOST: 'Hosts subagents',
}
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  EXPLICIT: 'Explicit',
  HIGH: 'High confidence',
  MEDIUM: 'Medium confidence',
}
const SOURCE_LABEL: Record<Source, string> = {
  SESSION_ATTACH: 'Session attached with lumo session attach',
  SUBAGENT_ATTACH: 'Subagent attached with lumo session attach',
  INHERITED: "Inherited from the parent session's binding",
  INFERRED: 'Auto-detected from signals',
}
const SIGNAL_LABEL: Record<string, string> = {
  BRANCH: 'Branch name',
  LUMO_CMD: 'Lumo command',
  COMMIT: 'Commit message',
  PR_CREATE: 'Pull request created',
  PROMPT: 'Mentioned in the prompt',
  GIT_HINT: 'Git state at session start',
  AGENT_PROMPT: 'Subagent dispatch prompt',
}
const APPROXIMATE = '≈ approximate'
const APPROXIMATE_NOTICE =
  "Measurement may be inaccurate: this work wasn't bound with lumo session attach, so its time and token cost were split by auto-detection. Attach the session or subagent for exact numbers."
const PRE_DEDUPE = '≈2× overstated'
const PRE_DEDUPE_NOTICE =
  'Token figures recorded before Oct 3, 2026 are overstated by about 2× (an older CLI counted each message several times). Newer figures are accurate.'

/** One line of free text: control chars stripped, newlines folded, fence-shaped tags defanged. */
function line(text: string): string {
  return neutralizeWrapperEscapes(
    sanitizeField(text).replace(/\s*[\r\n\v\f]+\s*/g, ' ')
  )
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function modelName(model: string): string {
  return model === '__in_flight__'
    ? 'in progress'
    : line(model).replace(/^claude-/, '')
}

/** The web header's token cell: `450K tok` for one model, else per model. */
function tokenCell(byModel: ModelCost[]): string {
  if (byModel.length === 1) return `${fmtTokens(byModel[0]!.total)} tok`
  return byModel
    .map(m => `${modelName(m.model)} ${fmtTokens(m.total)}`)
    .join(' · ')
}

function modelBreakdown(byModel: ModelCost[], indent: string): string[] {
  return byModel.map(
    m =>
      `${indent}${modelName(m.model)}: ${fmtCount(m.total)} (in ${fmtCount(m.input)} · out ${fmtCount(m.output)} · cache-read ${fmtCount(m.cacheRead)} · cache-create ${fmtCount(m.cacheCreation)})`
  )
}

function range(i: Interval | null, fmt: (n: number) => string): string {
  return i ? `${fmt(i.p25)}–${fmt(i.p75)} (median ${fmt(i.median)})` : NONE
}

function orDash(n: number | null, fmt: (n: number) => string = String): string {
  return n === null ? NONE : fmt(n)
}

function overviewLines(r: RunReport): string[] {
  const out: string[] = []
  const s = r.overview.sessions
  const marks = [
    r.overview.approximate ? APPROXIMATE : null,
    r.overview.preDedupe ? PRE_DEDUPE : null,
  ].filter(Boolean)
  out.push(
    `Sessions: ${s ? `${s.explicit} bound · ${s.inferred} auto-detected` : NONE}`
  )
  const t = r.totals
  out.push(
    // LUM-1232 N-1: one model → the total once (it IS that model's figure);
    // several → total plus the per-model split.
    `Tokens: ${t.byModel.length === 0 ? NONE : t.byModel.length === 1 ? fmtTokens(t.total) : `${fmtTokens(t.total)} (${tokenCell(t.byModel)})`} · ` +
      `loops ${orDash(t.loopCount)} · ${plural(t.runCount, 'run')}` +
      (marks.length > 0 ? `  [${marks.join('] [')}]` : '')
  )
  if (r.perMember.length > 0) {
    out.push(
      `By member: ${r.perMember
        .map(
          m =>
            `${line(m.name)} ${fmtTokens(m.total)} (${plural(m.runCount, 'run')}, ${plural(m.loopCount, 'loop')})`
        )
        .join(' · ')}`
    )
  }
  return out
}

function progressLines(r: RunReport, full: boolean): string[] {
  const p = r.progress
  if (!p) return []
  if (p.sessionCount === 0) {
    const f = p.forecast
    if (f.insufficientData)
      return ['Delivery forecast: not enough history for a reliable forecast']
    const out = [
      `Delivery forecast (${f.confidence} confidence, ${plural(f.cohortSize, 'similar task')}):`,
      `  runs ${range(f.iterations, String)} · merged PRs ${range(f.mergedPrs, String)} · cycle ${range(f.cycleHours, h => `${Math.round(h)}h`)}`,
      `  tokens ${range(f.tokenCost, fmtTokens)}${f.tokenCost ? ` · based on ${plural(f.tokenCostBasis, 'task')} with cost data` : ''} · interaction rounds ${range(f.interactionRounds, String)}`,
    ]
    return full ? out : out.slice(0, 2)
  }
  const tc = p.tokenCost
  const tokens =
    tc.actual === null
      ? NONE
      : `${fmtTokens(tc.actual)} used` +
        (tc.forecast
          ? ` · forecast median ${fmtTokens(tc.forecast.median)}`
          : '') +
        (tc.band === 'over'
          ? ` · ${tc.deltaPct ?? 0}% over budget`
          : tc.forecast
            ? ' · within range'
            : '')
  return [
    `Delivery in progress: tokens ${tokens}`,
    `  runs ${orDash(p.iterations.actual)} · interaction rounds ${orDash(p.interactionRounds.actual)} · active ${orDash(p.totalDuration.actual, formatDurationSec)}`,
  ]
}

function evidenceLines(evidence: Evidence[], indent: string): string[] {
  return evidence.map(e => {
    const label = `${SIGNAL_LABEL[e.kind] ?? line(e.kind)} · ${line(e.identifier)}`
    return `${indent}${e.count > 1 ? `${label} ×${e.count}` : label} · ${fmtTimestamp(e.at)}`
  })
}

function attributionLines(
  a: NonNullable<RunReportRun['attribution']>
): string[] {
  const out = ['  Why this run is on this task:']
  if (a.approximate) out.push(`    ${APPROXIMATE_NOTICE}`)
  if (a.mode === 'EXPLICIT' && a.segments.length === 0) {
    out.push(
      `    ${SOURCE_LABEL.SESSION_ATTACH} · ${CONFIDENCE_LABEL.EXPLICIT}`
    )
  }
  for (const s of a.segments) {
    const turns =
      s.fromTurn === s.toTurn
        ? `Turn ${s.fromTurn}`
        : `Turns ${s.fromTurn}–${s.toTurn}`
    out.push(
      `    ${turns} · ${SOURCE_LABEL[s.source]} · ${CONFIDENCE_LABEL[s.confidence]}`
    )
    if (s.evidence.length > 0) out.push(...evidenceLines(s.evidence, '      '))
    else if (s.source === 'INFERRED' && s.confidence !== 'HIGH')
      out.push('      No recorded signal')
  }
  if (a.subagents.length > 0) {
    out.push('    Subagents:')
    for (const g of a.subagents) {
      const label = g.agentType ? line(g.agentType) : 'subagent'
      out.push(
        `      ${g.count > 1 ? `${label} ×${g.count}` : label} · ${SOURCE_LABEL[g.source]} · ${CONFIDENCE_LABEL[g.confidence]}`
      )
      if (g.followsParent)
        out.push("        Follows the parent session's attribution")
      if (g.evidence.length > 0)
        out.push(...evidenceLines(g.evidence, '        '))
      else if (g.source === 'INFERRED') out.push('        No recorded signal')
    }
  }
  return out
}

function runLines(run: RunReportRun, full: boolean): string[] {
  const out: string[] = []
  const a = run.attribution
  const badge = a
    ? MODE_LABEL[a.mode] +
      (a.mode === 'INFERRED' && a.weakestConfidence
        ? ` · ${CONFIDENCE_LABEL[a.weakestConfidence]}`
        : '') +
      (a.approximate ? ` · ${APPROXIMATE}` : '')
    : 'Unlinked'
  const session = run.sessionId
    ? full
      ? run.sessionId
      : run.sessionId.slice(0, 8)
    : NONE
  out.push(
    `Run #${run.runNumber} · ${run.member ? line(run.member) : NONE} · ${run.agent} · ${badge} · ${fmtTimestamp(run.startedAt)} · session ${session}`
  )
  const cost = run.cost
    ? `${tokenCell(run.cost.byModel)}${run.preDedupe ? ` [${PRE_DEDUPE}]` : ''} · loops ${orDash(run.cost.loopCount)}`
    : `tokens ${NONE}`
  out.push(
    `  ${formatDuration(run.durationMs)} · ${plural(run.turnCount, 'turn')} · ${plural(run.toolCallCount, 'tool call')} · ${plural(run.memoryCount, 'memory', 'memories')} · ${cost}`
  )
  if (run.summary) out.push(`  Summary: ${line(run.summary)}`)
  else for (const d of run.digest) out.push(`  - ${line(d)}`)

  if (!full) return out
  if (a) out.push(...attributionLines(a))
  if (run.cost) {
    out.push('  Tokens by model:')
    if (run.preDedupe) out.push(`    ${PRE_DEDUPE_NOTICE}`)
    out.push(...modelBreakdown(run.cost.byModel, '    '))
  }
  if (run.memories.length > 0) {
    out.push('  Injected memories:')
    for (const m of run.memories)
      out.push(`    - [${line(m.category)}] ${line(m.headline)}`)
  }
  return out
}

/**
 * Render the report. Pure (no clock / env) so the output is deterministic and
 * unit-testable. The run list is agent-produced history, so it prints inside
 * the session-recap fence.
 */
export function formatRunReport(
  identifier: string,
  r: RunReport,
  opts: {
    full?: boolean
    /** Print the trailing hint (default: unless `--no-hints` / `LUMO_NO_HINTS`). */
    hints?: boolean
  } = {}
): string {
  const full = opts.full === true
  const hints = opts.hints ?? !nextStepsSilenced()
  // LUM-1232 batch B (D-1, Q7): a plain `<ref>  <title>` line, not Markdown.
  const out: string[] = [`${line(identifier)}  Agent runs`, '']
  out.push(...overviewLines(r))
  if (full && r.perMember.length > 0) {
    for (const m of r.perMember) {
      out.push(`  ${line(m.name)}:`)
      out.push(...modelBreakdown(m.byModel, '    '))
    }
  }
  if (full && r.totals.byModel.length > 0) {
    out.push('Tokens by model:')
    out.push(...modelBreakdown(r.totals.byModel, '  '))
  }
  if (r.overview.approximate && full) out.push(APPROXIMATE_NOTICE)
  if (r.overview.preDedupe && full) out.push(PRE_DEDUPE_NOTICE)
  const progress = progressLines(r, full)
  if (progress.length > 0) out.push(...progress)
  out.push('')

  if (r.runs.length === 0) {
    out.push('No agent runs on this task yet.')
    return out.join('\n') + '\n'
  }
  const body = r.runs.flatMap((run, i) => [
    ...(i > 0 ? [''] : []),
    ...runLines(run, full),
  ])
  out.push(
    renderUntrustedFence({
      tag: SESSION_RECAP_FENCE,
      notices: [],
      preamble: SESSION_RECAP_PREAMBLE,
      body: body.join('\n'),
    })
  )
  // LUM-1232 H-1/H-2: one hint spelling, and `--no-hints` drops it.
  if (!full && hints) {
    out.push('')
    out.push(
      hint(
        '`--full` adds attribution signals, subagents, per-model tokens and injected memories; `--json` prints the raw report.'
      )
    )
  }
  return out.join('\n') + '\n'
}

export async function taskRuns(
  identifierArg: string | undefined,
  opts: { full?: boolean; json?: boolean } = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const identifier =
    identifierArg ?? (await resolveBoundTaskIdentifier(ctx.base, ctx.token))
  if (!identifier) {
    console.error(
      'Error: no <LUM-N> given and no task bound to this session.\nPass it explicitly or run `lumo session attach <LUM-N>`.'
    )
    return EXIT_USAGE
  }

  const r = await apiCall<RunReport>(
    ctx,
    `/api/tasks/${encodeURIComponent(identifier)}/agent-runs/report`,
    {},
    'agent runs fetch'
  )
  if (!r.ok || !r.data) return 1

  if (opts.json) {
    emitJson(withVersion(r.data))
    return
  }
  process.stdout.write(
    formatRunReport(identifier, r.data, { full: opts.full === true })
  )
}
