/**
 * LUM-404: first quantitative validation of the memory flywheel's
 * "experience reuse lowers cost" claim (read-only, measure-first — the audit
 * itself is the deliverable, lum392/lum395/lum403 mode).
 *
 * EET (Guo et al., ACL 2026 Findings, arXiv 2601.05777) showed on SWE-bench
 * Verified that injecting historical success experience + early-stopping cuts
 * total cost 19.3–55.1% (mean −31.8%) with ≤0.2% solve-rate loss, and ablates
 * the two factors apart: experience-injection raises quality, early-stopping
 * lowers cost, decoupled. That is the first *external* quantification of the
 * exact claim Lumo's flywheel rests on — which Lumo had never measured on its
 * own data. This script borrows EET's measurement frame (same task population,
 * ±experience, compare cost AND outcome) and runs it OBSERVATIONALLY on prod
 * lineage:
 *
 *   cohort = did the task actually REUSE injected experience?
 *     USED  — ≥1 injected fragment was voted used (LUM-300/314 `used=true`)
 *     ZERO  — 0 injected fragments voted used (the ±experience contrast)
 *   outcome  = LUM-397 strength (MERGED_VERIFIED / MERGED / UNRESOLVED)
 *   cost     = Σ per-turn token deltas over the task's STOP turns (LUM-298/301,
 *              the same bounded per-task caliber lineage.service uses — NOT the
 *              cumulative Session columns, which keep growing post-merge)
 *   loops    = count of STOP/STOP_FAILURE turns tagged to the task
 *   complexity proxy = POST_TOOL action count and changed-file count
 *
 * The cohort cost gap is reported WITHIN complexity buckets (terciles), never
 * pooled — complex tasks may both attract more injection AND naturally burn
 * more, so a pooled mean would confound experience-reuse with task size. The
 * within-bucket contrast controls that confound; the pooled number is reported
 * too, explicitly flagged as confounded, only as a foil.
 *
 * RED LINES (from the task):
 *   • Observational only — association, never causation. Within-bucket
 *     stratification controls the size confound but residual confounding
 *     remains (the `used` vote is itself outcome-adjacent). No causal claim.
 *   • EET's early-stopping mechanism is NOT built here — it's parked on the F
 *     queue (trigger = verify-round sample size sufficient for offline
 *     calibration). This task ships a report, no online rule.
 *
 * Labeling: tasks are joined at the EVENT level via COALESCE(HookEvent.taskId,
 * Session.taskId) — the same caliber as hook-event.repository.findTurnUsageByTask.
 * Session.taskId alone is systematically biased (LUM-403): event-level taskId
 * is primary, session is fallback only for events that carry none.
 *
 * Run:    npx tsx scripts/analysis/lum404-eet-reuse/analyze.ts
 * Check:  npx tsx scripts/analysis/lum404-eet-reuse/analyze.ts --check
 *
 * Loads .env.production by default (pre-set DATABASE_URL wins — dotenv never
 * overrides). Only SELECTs are issued; no row is ever written.
 *
 * Output: stdout summary + scripts/analysis/lum404-eet-reuse/out/report.json
 */
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

/** Same write-tool classification the AgentRunTimeline / LUM-403 use. */
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
/** Action events that count toward the complexity proxy (one row per completed
 * tool call; PRE duplicates it, POST_TOOL_BATCH is a mid-turn usage snapshot). */
const ACTION_TYPES = ['POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'] as const
/** A task enters the analysis only with at least this many action events —
 * below it the trajectory is too thin to have a stable complexity/cost reading
 * (and is almost always an aborted/empty session). Locally chosen floor. */
const MIN_ACTIONS = 5

type Cohort = 'USED' | 'ZERO'
const COHORTS: Cohort[] = ['USED', 'ZERO']
type Stratum = 'MERGED_VERIFIED' | 'MERGED' | 'UNRESOLVED'
const STRATA: Stratum[] = ['MERGED_VERIFIED', 'MERGED', 'UNRESOLVED']

interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

interface TaskRecord {
  taskId: string
  identifier: string
  projectId: string
  cohort: Cohort
  stratum: Stratum
  injected: number
  usedTrue: number
  /** total action events (complexity proxy A) */
  actions: number
  /** distinct files written (complexity proxy B) */
  changedFiles: number
  /** Σ token cost over the task's STOP turns; null if no usage was captured */
  tokenCost: number | null
  /** STOP/STOP_FAILURE turns tagged to the task */
  loops: number
}

// ── tiny stats helpers (shared shape with LUM-403) ───────────────────────────

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[idx] ?? null
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function round(v: number | null, digits = 4): number | null {
  return v === null ? null : Number(v.toFixed(digits))
}

function distStats(values: number[]) {
  return {
    n: values.length,
    median: round(quantile(values, 0.5)),
    p90: round(quantile(values, 0.9)),
    mean: round(mean(values)),
  }
}

/**
 * Cliff's delta: P(a > b) − P(a < b) over all cross pairs. δ > 0 means group A
 * stochastically larger. AUC = (δ + 1) / 2. O(n·m) — fine at this scale. For
 * the cost contrast we pass (USED, ZERO): δ < 0 means USED burns less.
 */
function cliffsDelta(a: number[], b: number[]) {
  if (a.length === 0 || b.length === 0) return null
  let gt = 0
  let lt = 0
  for (const x of a)
    for (const y of b) {
      if (x > y) gt++
      else if (x < y) lt++
    }
  return (gt - lt) / (a.length * b.length)
}

/**
 * Two-sided Mann-Whitney U p-value via normal approximation with tie
 * correction. Indicative only at these sample sizes — effect size (Cliff's
 * delta) is the headline, p is a sanity companion.
 */
function mannWhitneyP(a: number[], b: number[]): number | null {
  const n1 = a.length
  const n2 = b.length
  if (n1 === 0 || n2 === 0) return null
  const all = [...a.map(v => ({ v, g: 0 })), ...b.map(v => ({ v, g: 1 }))]
  all.sort((x, y) => x.v - y.v)
  const ranks = new Array<number>(all.length)
  const tieGroups: number[] = []
  let i = 0
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++
    const avgRank = (i + j + 2) / 2
    for (let k = i; k <= j; k++) ranks[k] = avgRank
    if (j > i) tieGroups.push(j - i + 1)
    i = j + 1
  }
  let r1 = 0
  for (let k = 0; k < all.length; k++) if (all[k]!.g === 0) r1 += ranks[k]!
  const u1 = r1 - (n1 * (n1 + 1)) / 2
  const n = n1 + n2
  const tieTerm = tieGroups.reduce((s, t) => s + (t ** 3 - t), 0)
  const sigma2 = ((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1)))
  if (sigma2 <= 0) return null
  const z = (u1 - (n1 * n2) / 2) / Math.sqrt(sigma2)
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erfc = poly * Math.exp(-(z * z) / 2)
  return Math.min(1, erfc)
}

/** Σ token cost (input+output+cacheRead+cacheCreation) over a usageByModel map. */
function usageCost(byModel: unknown): number {
  if (!byModel || typeof byModel !== 'object') return 0
  let total = 0
  for (const u of Object.values(byModel as Record<string, ModelUsage>)) {
    const n = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0
    total += n(u?.input) + n(u?.output) + n(u?.cacheRead) + n(u?.cacheCreation)
  }
  return total
}

// ── cohort × outcome comparison ──────────────────────────────────────────────

/** Outcome distribution + the two EET-relevant rates over a task set. */
function outcomeBlock(tasks: TaskRecord[]) {
  const counts: Record<string, number> = {}
  for (const s of STRATA) counts[s] = 0
  for (const t of tasks) counts[t.stratum]!++
  const n = tasks.length
  const done = counts.MERGED_VERIFIED! + counts.MERGED!
  return {
    n,
    counts,
    // the "did not lower outcome" half of the EET claim
    doneRate: n > 0 ? round(done / n) : null,
    verifiedRate: n > 0 ? round(counts.MERGED_VERIFIED! / n) : null,
  }
}

/** cost+loops distribution per cohort over a task set (one complexity bucket). */
function cohortBlock(tasks: TaskRecord[]) {
  const byCohort: Record<string, ReturnType<typeof perCohort>> = {}
  for (const c of COHORTS)
    byCohort[c] = perCohort(tasks.filter(t => t.cohort === c))
  return byCohort
}

function perCohort(tasks: TaskRecord[]) {
  const costs = tasks.flatMap(t => (t.tokenCost === null ? [] : [t.tokenCost]))
  return {
    n: tasks.length,
    nWithCost: costs.length,
    cost: distStats(costs),
    loops: distStats(tasks.map(t => t.loops)),
    outcome: outcomeBlock(tasks),
    actions: distStats(tasks.map(t => t.actions)),
    changedFiles: distStats(tasks.map(t => t.changedFiles)),
  }
}

/** USED-vs-ZERO effect sizes on cost and loops for one bucket. */
function effectSizes(tasks: TaskRecord[]) {
  const used = tasks.filter(t => t.cohort === 'USED')
  const zero = tasks.filter(t => t.cohort === 'ZERO')
  const usedCost = used.flatMap(t => (t.tokenCost === null ? [] : [t.tokenCost]))
  const zeroCost = zero.flatMap(t => (t.tokenCost === null ? [] : [t.tokenCost]))
  const pair = (a: number[], b: number[]) => {
    const delta = cliffsDelta(a, b)
    return {
      note: 'Cliff\'s delta(USED, ZERO); δ<0 ⇒ USED stochastically smaller',
      nUsed: a.length,
      nZero: b.length,
      cliffsDelta: round(delta),
      auc: delta === null ? null : round((delta + 1) / 2),
      pMannWhitney: round(mannWhitneyP(a, b), 4),
    }
  }
  return {
    costUsedVsZero: pair(usedCost, zeroCost),
    loopsUsedVsZero: pair(
      used.map(t => t.loops),
      zero.map(t => t.loops)
    ),
  }
}

/** Tercile bucketing over a numeric key; returns labeled buckets in order. */
function tercileBuckets(
  tasks: TaskRecord[],
  key: (t: TaskRecord) => number,
  label: string
) {
  const sorted = [...tasks].sort((a, b) => key(a) - key(b))
  const values = sorted.map(key)
  const q1 = quantile(values, 1 / 3)
  const q2 = quantile(values, 2 / 3)
  const bucketOf = (v: number): 'low' | 'mid' | 'high' => {
    if (q1 === null || q2 === null) return 'mid'
    if (v <= q1) return 'low'
    if (v <= q2) return 'mid'
    return 'high'
  }
  const groups = new Map<string, TaskRecord[]>()
  for (const t of tasks) {
    const b = bucketOf(key(t))
    groups.set(b, [...(groups.get(b) ?? []), t])
  }
  return (['low', 'mid', 'high'] as const).map(b => {
    const members = groups.get(b) ?? []
    const vals = members.map(key)
    return {
      key: `${label}:${b}`,
      proxy: label,
      range: {
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
      },
      n: members.length,
      byCohort: cohortBlock(members),
      effectSizes: effectSizes(members),
    }
  })
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const check = process.argv.includes('--check')
  const { prisma } = await import('@/lib/db/prisma')
  const { verificationRunRepository } = await import(
    '@/lib/repositories/verification-run.repository'
  )

  // 1. Action stream → per-task complexity proxies (event count, changed files).
  //    Event-level taskId primary, session.taskId fallback (LUM-403 caliber).
  const actionRows = await prisma.hookEvent.findMany({
    where: {
      type: { in: [...ACTION_TYPES] },
      OR: [{ taskId: { not: null } }, { session: { taskId: { not: null } } }],
    },
    select: {
      taskId: true,
      toolName: true,
      filePath: true,
      session: { select: { taskId: true } },
    },
  })

  // 2. STOP turns → per-task token cost + loop count (LUM-298/301 caliber:
  //    the same OR(event.taskId, session.taskId) filter findTurnUsageByTask
  //    uses; each STOP turn is one loop; cost = Σ per-turn usageByModel deltas).
  const turnRows = await prisma.hookEvent.findMany({
    where: {
      type: { in: ['STOP', 'STOP_FAILURE'] },
      OR: [{ taskId: { not: null } }, { session: { taskId: { not: null } } }],
    },
    select: {
      taskId: true,
      usageByModel: true,
      session: { select: { taskId: true } },
    },
  })

  // 3. Lineage edges → per-task injection presence + used-vote count.
  const edgeRows = await prisma.lineageEdge.findMany({
    select: { taskId: true, used: true },
  })

  const effTask = (r: {
    taskId: string | null
    session: { taskId: string | null } | null
  }): string | null => r.taskId ?? r.session?.taskId ?? null

  // Per-task accumulation.
  interface Acc {
    actions: number
    changedFiles: Set<string>
    tokenCost: number
    hasUsage: boolean
    loops: number
    injected: number
    usedTrue: number
  }
  const acc = new Map<string, Acc>()
  const blank = (): Acc => ({
    actions: 0,
    changedFiles: new Set(),
    tokenCost: 0,
    hasUsage: false,
    loops: 0,
    injected: 0,
    usedTrue: 0,
  })

  for (const r of actionRows) {
    const id = effTask(r)
    if (!id) continue
    const a = acc.get(id) ?? blank()
    a.actions++
    if (r.toolName && WRITE_TOOLS.has(r.toolName) && r.filePath)
      a.changedFiles.add(r.filePath)
    acc.set(id, a)
  }
  for (const r of turnRows) {
    const id = effTask(r)
    if (!id) continue
    const a = acc.get(id) ?? blank()
    a.loops++
    const c = usageCost(r.usageByModel)
    if (c > 0) {
      a.tokenCost += c
      a.hasUsage = true
    }
    acc.set(id, a)
  }
  // Edge taskId is non-null in schema; group all edges, count used votes.
  const edgeByTask = new Map<string, { injected: number; usedTrue: number }>()
  for (const e of edgeRows) {
    const g = edgeByTask.get(e.taskId) ?? { injected: 0, usedTrue: 0 }
    g.injected++
    if (e.used === true) g.usedTrue++
    edgeByTask.set(e.taskId, g)
  }
  for (const [id, g] of edgeByTask) {
    const a = acc.get(id) ?? blank()
    a.injected = g.injected
    a.usedTrue = g.usedTrue
    acc.set(id, a)
  }

  // Universe = tasks with ≥ MIN_ACTIONS action events (complexity defined).
  const universeIds = [...acc.entries()]
    .filter(([, a]) => a.actions >= MIN_ACTIONS)
    .map(([id]) => id)

  const taskMeta = await prisma.task.findMany({
    where: { id: { in: universeIds } },
    select: {
      id: true,
      number: true,
      status: true,
      projectId: true,
      team: { select: { identifier: true } },
    },
  })
  const verifiedTaskIds =
    await verificationRunRepository.taskIdsWithAllPassRound(universeIds)
  const metaById = new Map(taskMeta.map(t => [t.id, t]))

  const stratumOf = (id: string, status: string): Stratum => {
    if (status === 'DONE')
      return verifiedTaskIds.has(id) ? 'MERGED_VERIFIED' : 'MERGED'
    return 'UNRESOLVED'
  }

  const records: TaskRecord[] = []
  for (const id of universeIds) {
    const meta = metaById.get(id)
    if (!meta) continue // task row gone (deleted) — skip rather than mislabel
    const a = acc.get(id)!
    records.push({
      taskId: id,
      identifier: `${meta.team.identifier}-${meta.number}`,
      projectId: meta.projectId,
      cohort: a.usedTrue >= 1 ? 'USED' : 'ZERO',
      stratum: stratumOf(id, meta.status),
      injected: a.injected,
      usedTrue: a.usedTrue,
      actions: a.actions,
      changedFiles: a.changedFiles.size,
      tokenCost: a.hasUsage ? a.tokenCost : null,
      loops: a.loops,
    })
  }

  // ── buckets ──────────────────────────────────────────────────────────────
  // Headline: complexity = action count terciles. Variant: changed-file terciles.
  const buckets = tercileBuckets(records, t => t.actions, 'actions')
  const bucketsByChangedFiles = tercileBuckets(
    records,
    t => t.changedFiles,
    'changedFiles'
  )

  // ── pooled (CONFOUNDED — foil only) ────────────────────────────────────────
  const pooled = {
    note: 'Pooled across all complexity — CONFOUNDED (complex tasks attract more injection AND burn more). Shown only as a foil; read the within-bucket buckets[] instead.',
    byCohort: cohortBlock(records),
    effectSizes: effectSizes(records),
  }

  // ── presence-based sensitivity ─────────────────────────────────────────────
  // The `used` vote is sparse (LUM-314 auto-voting is true-only, evidence-gated),
  // so the ZERO cohort conflates "no injection" with "injected, never voted".
  // Re-bucket on mere presence (injected≥1 vs 0) to bound how much the headline
  // depends on the vote signal vs raw injection.
  const presenceRecords: TaskRecord[] = records.map(t => ({
    ...t,
    cohort: t.injected >= 1 ? 'USED' : 'ZERO',
  }))
  const presenceSensitivity = {
    note: 'cohort re-defined as injected≥1 (presence) vs 0, NOT the used vote — bounds dependence on the sparse used signal',
    buckets: tercileBuckets(presenceRecords, t => t.actions, 'actions'),
    pooled: {
      byCohort: cohortBlock(presenceRecords),
      effectSizes: effectSizes(presenceRecords),
    },
  }

  // ── coverage / honesty counters ────────────────────────────────────────────
  const cohortCounts: Record<string, number> = { USED: 0, ZERO: 0 }
  for (const t of records) cohortCounts[t.cohort]!++
  const tasksWithCost = records.filter(t => t.tokenCost !== null).length
  // ZERO cohort tasks that DID receive injection but no used vote — the
  // conflation the presence sensitivity guards against.
  const zeroButInjected = records.filter(
    t => t.cohort === 'ZERO' && t.injected >= 1
  ).length
  const strataCounts: Record<string, number> = {}
  for (const s of STRATA) strataCounts[s] = records.filter(t => t.stratum === s).length

  const report = {
    generatedFor: 'LUM-404',
    generatedAt: new Date().toISOString(),
    params: {
      MIN_ACTIONS,
      unitOfAnalysis: 'task',
      cohortDefinition:
        'USED = ≥1 injected fragment voted used (LineageEdge.used=true, LUM-300/314); ZERO = 0 used votes',
      labelSourceNote:
        'tasks joined via COALESCE(HookEvent.taskId, Session.taskId) — the findTurnUsageByTask caliber; event-level taskId primary, session fallback only for null-taskId events (LUM-403 anti-bias).',
      costCaliber:
        'Σ per-turn token deltas (HookEvent.usageByModel on STOP/STOP_FAILURE, LUM-298/301) — bounded per-task, NOT cumulative Session columns',
      complexityProxies: ['action count (POST_TOOL_USE/_FAILURE)', 'changed-file count (distinct write filePath)'],
      strata: {
        MERGED_VERIFIED: 'task DONE with ≥1 all-PASS verification round',
        MERGED: 'task DONE without an all-PASS round',
        UNRESOLVED: 'task not DONE',
      },
      redLines: [
        'observational — association only, no causal claim (within-bucket controls size; residual confounding remains, the used vote is outcome-adjacent)',
        'no early-stopping mechanism ships — report only (EET early-stop parked on F queue)',
      ],
    },
    coverage: {
      tasksInUniverse: records.length,
      tasksWithCost,
      tasksWithoutCost: records.length - tasksWithCost,
      cohortCounts,
      zeroCohortButInjected: zeroButInjected,
      strataCounts,
      totalActionEvents: actionRows.length,
      totalStopTurns: turnRows.length,
      totalEdges: edgeRows.length,
    },
    // PRIMARY deliverable: within-complexity-bucket cohort cost/loop contrast.
    buckets,
    bucketsByChangedFiles,
    pooled,
    sensitivity: { presenceBased: presenceSensitivity },
    tasks: records
      .slice()
      .sort((a, b) => (b.tokenCost ?? -1) - (a.tokenCost ?? -1))
      .map(t => ({ ...t, tokenCost: round(t.tokenCost, 0) })),
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  // ── stdout summary ─────────────────────────────────────────────────────────
  const fmtBucket = (b: (typeof buckets)[number]) => {
    const lines = [
      `  ${b.key.padEnd(18)} n=${b.n}  (actions ${b.range.min}…${b.range.max})`,
    ]
    for (const c of COHORTS) {
      const pc = b.byCohort[c]!
      lines.push(
        `      ${c.padEnd(4)} n=${pc.n} cost[n=${pc.nWithCost}]: med=${pc.cost.median} p90=${pc.cost.p90}  loops: med=${pc.loops.median}  done=${pc.outcome.doneRate} verified=${pc.outcome.verifiedRate}`
      )
    }
    const e = b.effectSizes.costUsedVsZero
    lines.push(
      `      cost δ(USED,ZERO)=${e.cliffsDelta} AUC=${e.auc} p≈${e.pMannWhitney} (n=${e.nUsed}/${e.nZero})  ${e.cliffsDelta !== null && e.cliffsDelta < 0 ? '↓ USED cheaper' : e.cliffsDelta !== null && e.cliffsDelta > 0 ? '↑ USED pricier' : '—'}`
    )
    return lines.join('\n')
  }

  console.log(
    [
      `LUM-404 EET experience-reuse cost EDA — ${report.generatedAt}`,
      ``,
      `Coverage: ${records.length} tasks (≥${MIN_ACTIONS} actions), ${tasksWithCost} with token cost; cohorts ${JSON.stringify(cohortCounts)}; strata ${JSON.stringify(strataCounts)}`,
      `  ZERO cohort but injected≥1 (no used vote): ${zeroButInjected} — sparse-vote conflation, see sensitivity.presenceBased`,
      `  ${actionRows.length} action events, ${turnRows.length} STOP turns, ${edgeRows.length} lineage edges`,
      ``,
      `Within-complexity-bucket cohort cost contrast (headline; δ<0 ⇒ USED cheaper):`,
      ...buckets.map(fmtBucket),
      ``,
      `Pooled (CONFOUNDED foil): cost δ(USED,ZERO)=${pooled.effectSizes.costUsedVsZero.cliffsDelta} (n=${pooled.effectSizes.costUsedVsZero.nUsed}/${pooled.effectSizes.costUsedVsZero.nZero})`,
      `Presence sensitivity pooled: cost δ=${presenceSensitivity.pooled.effectSizes.costUsedVsZero.cliffsDelta}`,
      ``,
      `Outcome (EET "no solve-rate loss" half) by cohort:`,
      ...COHORTS.map(c => {
        const o = pooled.byCohort[c]!.outcome
        return `  ${c.padEnd(4)} n=${o.n} done=${o.doneRate} verified=${o.verifiedRate}  ${JSON.stringify(o.counts)}`
      }),
      ``,
      `Full detail: ${join(outDir, 'report.json')}`,
    ].join('\n')
  )

  // ── --check: validate the report satisfies the acceptance contract ──────────
  if (check) {
    const problems: string[] = []
    if (!Array.isArray(report.buckets) || report.buckets.length === 0)
      problems.push('no complexity buckets')
    for (const b of report.buckets) {
      for (const c of COHORTS) {
        if (typeof b.byCohort[c]?.n !== 'number')
          problems.push(`${b.key}.byCohort.${c}.n missing`)
        if (!b.byCohort[c]?.cost) problems.push(`${b.key}.byCohort.${c}.cost missing`)
        if (!b.byCohort[c]?.loops) problems.push(`${b.key}.byCohort.${c}.loops missing`)
        if (!b.byCohort[c]?.outcome) problems.push(`${b.key}.byCohort.${c}.outcome missing`)
      }
      if (!b.effectSizes?.costUsedVsZero)
        problems.push(`${b.key}.effectSizes.costUsedVsZero missing`)
    }
    if (records.length === 0) problems.push('no tasks in universe')
    if (tasksWithCost === 0) problems.push('no tasks carry token cost')
    console.log(problems.length === 0 ? 'CHECK PASS' : 'CHECK FAIL')
    for (const p of problems) console.error(`  - ${p}`)
    if (problems.length > 0) process.exitCode = 1
  }

  await prisma.$disconnect()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
