/**
 * LUM-403: trajectory failure-signal discriminative-power EDA (read-only,
 * measure-first — the audit itself is the deliverable, lum392/lum395 mode).
 *
 * Two independent papers (Bouzenia & Pradel, TAR Trajectories ASE'25;
 * Majgaonkar et al. arXiv 2511.00197) converge on cheap, tool-stream-only
 * failure signals: failing trajectories are longer and loop — the strongest
 * cheap discriminator is the consecutive-repeated-action ratio. This script
 * recomputes three such features on Lumo's own prod HookEvent data and
 * measures their discriminative power against LUM-397 outcome strata
 * (MERGED_VERIFIED / MERGED-unverified / UNRESOLVED), which the papers did
 * not have:
 *
 *   ① repeated-action n-gram rate (consecutive repeat + 2/3-gram loop rate,
 *     over an action key of toolName + core argument)
 *   ② same-file repeated-read-without-write ratio
 *   ③ step/event count, absolute and relative to the project baseline
 *
 * Unit of analysis: the (session × task) SEGMENT, labeled by the
 * event-level HookEvent.taskId — NOT by Session.taskId. Session-level
 * binding is systematically biased (discovered during this EDA): sessions
 * before ~06-06 frequently kept taskId NULL or were re-bound during the
 * 06-10 closure sweep, so labeling via Session.taskId makes the
 * MERGED_VERIFIED stratum consist exclusively of same-day closure sessions
 * (a pure time/process confound). Event-level taskId covers ~97% of action
 * events back to 2026-05-06 and survives mid-session rebinds.
 *
 * Red lines (from the task): absolute thresholds are NEVER imported from the
 * papers (both show they don't transfer across agents), and nothing here
 * ships an online rule — the output is a report quantifying whether each
 * signal discriminates at all in our data.
 *
 * Run:    npx tsx scripts/analysis/lum403-trajectory-signals/analyze.ts
 * Check:  npx tsx scripts/analysis/lum403-trajectory-signals/analyze.ts --check
 *
 * Loads .env.production by default (pre-set DATABASE_URL wins — dotenv never
 * overrides). Only SELECTs are issued; no row is ever written.
 *
 * Output: stdout summary + scripts/analysis/lum403-trajectory-signals/out/report.json
 */
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

config({ path: process.env.DOTENV_CONFIG_PATH ?? '.env.production' })

/**
 * Ratio features are unstable on tiny trajectories (1 repeat in 4 actions =
 * 33%); segments below this action count are excluded from ratio strata but
 * still counted in coverage and in task-grain sums. Locally chosen
 * denominator floor, not a paper-imported threshold.
 */
const MIN_ACTIONS = 10
/** Same classification the AgentRunTimeline categorizer uses. */
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
/** Commands whose first argument is part of the action identity (git status
 * vs git commit are different actions; a bare `git` key would over-merge). */
const TWO_TOKEN_COMMANDS = new Set([
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'lumo',
  'gh',
])

type Stratum = 'MERGED_VERIFIED' | 'MERGED' | 'UNRESOLVED'
const STRATA: Stratum[] = ['MERGED_VERIFIED', 'MERGED', 'UNRESOLVED']

interface ActionRow {
  id: string
  sessionId: string | null
  taskId: string
  type: string
  toolName: string | null
  filePath: string | null
  command: string | null
  createdAt: Date
}

interface SegmentFeatures {
  sessionId: string
  taskId: string
  taskIdentifier: string
  stratum: Stratum
  projectId: string
  firstActionAt: Date
  actions: number
  /** consecutive same-action rate over toolName+arg keys */
  repeat1Arg: number | null
  /** consecutive same-action rate over toolName only */
  repeat1Tool: number | null
  /** immediate 2-gram loop rate (A B A B …) */
  bigramLoop: number | null
  /** immediate 3-gram loop rate */
  trigramLoop: number | null
  /** files read ≥2× and never written / files read ≥2× */
  rereadNoWriteFileRatio: number | null
  /** redundant Read events on never-written files / all Read events */
  redundantReadEventRatio: number | null
  filesRereadCount: number
  readEvents: number
  failureEvents: number
  /** actions / per-project median segment actions */
  stepsVsProjectBaseline: number | null
}

// ── tiny stats helpers ───────────────────────────────────────────────────────

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
 * Cliff's delta: P(a > b) − P(a < b) over all cross pairs. δ > 0 means group
 * A stochastically larger. AUC = (δ + 1) / 2. O(n·m) — fine at this scale.
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
  const total = a.length * b.length
  return (gt - lt) / total
}

/**
 * Two-sided Mann-Whitney U p-value via normal approximation with tie
 * correction. Indicative only at these sample sizes — effect size (Cliff's
 * delta) is the headline number, p is a sanity companion.
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
  // two-sided normal tail via erfc approximation (Abramowitz-Stegun 7.1.26)
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

// ── feature computation ──────────────────────────────────────────────────────

function normalizeCommand(command: string): string {
  const tokens = command.trim().split(/\s+/)
  const head = tokens[0] ?? ''
  if (TWO_TOKEN_COMMANDS.has(head) && tokens.length > 1)
    return `${head} ${tokens[1]}`
  return head
}

function actionKey(row: ActionRow): string {
  const tool = row.toolName ?? 'unknown'
  if (row.filePath) return `${tool}:${row.filePath}`
  if (tool === 'Bash' && row.command)
    return `Bash:${normalizeCommand(row.command)}`
  return tool
}

/** Fraction of positions i ≥ g where seq[i−g..i) == seq[i..i+g). */
function ngramLoopRate(keys: string[], g: number): number | null {
  const positions = keys.length - 2 * g + 1
  if (positions <= 0) return null
  let loops = 0
  for (let i = g; i + g <= keys.length; i++) {
    let equal = true
    for (let k = 0; k < g; k++) {
      if (keys[i + k] !== keys[i - g + k]) {
        equal = false
        break
      }
    }
    if (equal) loops++
  }
  return loops / positions
}

function consecutiveRepeatRate(keys: string[]): number | null {
  if (keys.length < 2) return null
  let repeats = 0
  for (let i = 1; i < keys.length; i++) if (keys[i] === keys[i - 1]) repeats++
  return repeats / (keys.length - 1)
}

// ── stratified reporting ─────────────────────────────────────────────────────

interface Labeled {
  stratum: Stratum
  value: number
}

function featureBlock(points: Labeled[]) {
  const byStratum: Record<string, ReturnType<typeof distStats>> = {}
  const grouped = new Map<Stratum, number[]>()
  for (const s of STRATA) grouped.set(s, [])
  for (const p of points) grouped.get(p.stratum)!.push(p.value)
  for (const s of STRATA) byStratum[s] = distStats(grouped.get(s)!)

  const verified = grouped.get('MERGED_VERIFIED')!
  const mergedUnverified = grouped.get('MERGED')!
  const unresolved = grouped.get('UNRESOLVED')!
  const done = [...verified, ...mergedUnverified]

  const pair = (label: string, a: number[], b: number[]) => {
    const delta = cliffsDelta(a, b)
    return {
      pair: label,
      nA: a.length,
      nB: b.length,
      cliffsDelta: round(delta),
      auc: delta === null ? null : round((delta + 1) / 2),
      pMannWhitney: round(mannWhitneyP(a, b), 4),
    }
  }
  return {
    byStratum,
    effectSizes: {
      verifiedVsMergedUnverified: pair(
        'MERGED_VERIFIED vs MERGED(unverified)',
        verified,
        mergedUnverified
      ),
      doneVsUnresolved: pair('DONE(all) vs UNRESOLVED', done, unresolved),
    },
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const check = process.argv.includes('--check')
  const { prisma } = await import('@/lib/db/prisma')
  const { openHookPayloads } = await import('@/lib/hook-event/payload-cipher')
  const { verificationRunRepository } =
    await import('@/lib/repositories/verification-run.repository')

  // Action stream labeled at the EVENT level (see header for why not
  // Session.taskId). POST_TOOL_USE(+FAILURE) only — one row per completed
  // tool call. PRE_TOOL_USE duplicates it; POST_TOOL_BATCH is a mid-turn
  // usage snapshot (LUM-345), not an extra action. LUM-863: payloads may be
  // encrypted, so the Bash command head is projected in JS after decryption
  // (keyset pages keep the payload volume per round trip bounded).
  const rows: ActionRow[] = []
  let cursor: string | null = null
  for (;;) {
    const page = await prisma.hookEvent.findMany({
      where: {
        taskId: { not: null },
        type: { in: ['POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'] },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        sessionId: true,
        taskId: true,
        type: true,
        toolName: true,
        filePath: true,
        createdAt: true,
        payload: true,
        workspaceId: true,
        payloadEncrypted: true,
      },
      orderBy: { id: 'asc' },
      take: 500,
    })
    for (const r of await openHookPayloads(page)) {
      const command = (
        r.payload as { tool_input?: { command?: unknown } } | null
      )?.tool_input?.command
      rows.push({
        id: r.id,
        sessionId: r.sessionId,
        taskId: r.taskId!,
        type: r.type,
        toolName: r.toolName,
        filePath: r.filePath,
        command: typeof command === 'string' ? command.slice(0, 200) : null,
        createdAt: r.createdAt,
      })
    }
    if (page.length < 500) break
    cursor = page[page.length - 1]!.id
  }
  rows.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  const unlabeledActionEvents = await prisma.hookEvent.count({
    where: {
      taskId: null,
      type: { in: ['POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'] },
    },
  })

  // Labels: the task's LUM-397 stratum.
  const taskIds = [...new Set(rows.map(r => r.taskId))]
  const taskRows = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      number: true,
      status: true,
      projectId: true,
      team: { select: { identifier: true } },
    },
  })
  const verifiedTaskIds =
    await verificationRunRepository.taskIdsWithAllPassRound(taskIds)
  const taskById = new Map(
    taskRows.map(t => [
      t.id,
      {
        id: t.id,
        identifier: `${t.team.identifier}-${t.number}`,
        status: t.status,
        projectId: t.projectId,
      },
    ])
  )
  const stratumOfTask = (taskId: string): Stratum => {
    const task = taskById.get(taskId)
    if (task?.status === 'DONE')
      return verifiedTaskIds.has(taskId) ? 'MERGED_VERIFIED' : 'MERGED'
    return 'UNRESOLVED'
  }

  // Segment the stream by (session × task). Events within a session that
  // belong to the same task form one ordered sequence even if another task's
  // events are interleaved between them (mid-session rebind) — the sequence
  // is still that task's trajectory through the session.
  const segments = new Map<string, ActionRow[]>()
  for (const row of rows) {
    const key = `${row.sessionId ?? 'nosession'}\u0000${row.taskId}`
    const list = segments.get(key) ?? []
    list.push(row)
    segments.set(key, list)
  }

  // Per-segment features.
  const features: SegmentFeatures[] = []
  for (const [key, actions] of segments) {
    const taskId = actions[0]!.taskId
    const task = taskById.get(taskId)
    if (!task) continue
    const argKeys = actions.map(actionKey)
    const toolKeys = actions.map(a => a.toolName ?? 'unknown')

    const reads = new Map<string, number>()
    const writes = new Map<string, number>()
    let readEvents = 0
    for (const a of actions) {
      if (!a.filePath) continue
      if (a.toolName === 'Read') {
        reads.set(a.filePath, (reads.get(a.filePath) ?? 0) + 1)
        readEvents++
      } else if (a.toolName && WRITE_TOOLS.has(a.toolName)) {
        writes.set(a.filePath, (writes.get(a.filePath) ?? 0) + 1)
      }
    }
    const reread = [...reads.entries()].filter(([, n]) => n >= 2)
    const rereadNoWrite = reread.filter(([path]) => !writes.has(path))
    const redundantReads = rereadNoWrite.reduce((s, [, n]) => s + (n - 1), 0)

    features.push({
      sessionId: key.split('\u0000')[0]!,
      taskId,
      taskIdentifier: task.identifier,
      stratum: stratumOfTask(taskId),
      projectId: task.projectId,
      firstActionAt: actions[0]!.createdAt,
      actions: actions.length,
      repeat1Arg: consecutiveRepeatRate(argKeys),
      repeat1Tool: consecutiveRepeatRate(toolKeys),
      bigramLoop: ngramLoopRate(argKeys, 2),
      trigramLoop: ngramLoopRate(argKeys, 3),
      rereadNoWriteFileRatio:
        reread.length > 0 ? rereadNoWrite.length / reread.length : null,
      redundantReadEventRatio:
        readEvents > 0 ? redundantReads / readEvents : null,
      filesRereadCount: reread.length,
      readEvents,
      failureEvents: actions.filter(a => a.type === 'POST_TOOL_USE_FAILURE')
        .length,
      stepsVsProjectBaseline: null, // filled after project medians exist
    })
  }

  // Project baseline for step counts (median segment action count).
  const byProject = new Map<string, number[]>()
  for (const f of features) {
    const list = byProject.get(f.projectId) ?? []
    list.push(f.actions)
    byProject.set(f.projectId, list)
  }
  const projectMedian = new Map<string, number>()
  for (const [projectId, counts] of byProject)
    projectMedian.set(projectId, quantile(counts, 0.5) ?? 0)
  for (const f of features) {
    const base = projectMedian.get(f.projectId) ?? 0
    f.stepsVsProjectBaseline = base > 0 ? f.actions / base : null
  }

  // Ratio features only over segments with enough actions to be stable.
  const eligible = features.filter(f => f.actions >= MIN_ACTIONS)
  const points = (
    pool: SegmentFeatures[],
    pick: (f: SegmentFeatures) => number | null
  ): Labeled[] =>
    pool.flatMap(f => {
      const value = pick(f)
      return value === null ? [] : [{ stratum: f.stratum, value }]
    })

  // Task-grain aggregation: outcome is a task-level label, and the papers
  // measure whole trajectories — a task's trajectory spans all its segments.
  interface TaskAgg {
    taskId: string
    identifier: string
    stratum: Stratum
    projectId: string
    segments: number
    actions: number
    firstActionAt: Date
    repeatNumer: number
    repeatDenom: number
    redundantReads: number
    readEvents: number
  }
  const taskAgg = new Map<string, TaskAgg>()
  for (const f of features) {
    const agg = taskAgg.get(f.taskId) ?? {
      taskId: f.taskId,
      identifier: f.taskIdentifier,
      stratum: f.stratum,
      projectId: f.projectId,
      segments: 0,
      actions: 0,
      firstActionAt: f.firstActionAt,
      repeatNumer: 0,
      repeatDenom: 0,
      redundantReads: 0,
      readEvents: 0,
    }
    agg.segments++
    agg.actions += f.actions
    if (f.firstActionAt < agg.firstActionAt) agg.firstActionAt = f.firstActionAt
    if (f.repeat1Arg !== null && f.actions >= 2) {
      agg.repeatNumer += f.repeat1Arg * (f.actions - 1)
      agg.repeatDenom += f.actions - 1
    }
    if (f.redundantReadEventRatio !== null) {
      agg.redundantReads += f.redundantReadEventRatio * f.readEvents
      agg.readEvents += f.readEvents
    }
    taskAgg.set(f.taskId, agg)
  }
  const taskProjectCounts = new Map<string, number[]>()
  for (const t of taskAgg.values()) {
    const list = taskProjectCounts.get(t.projectId) ?? []
    list.push(t.actions)
    taskProjectCounts.set(t.projectId, list)
  }
  const taskProjectMedian = new Map<string, number>()
  for (const [projectId, counts] of taskProjectCounts)
    taskProjectMedian.set(projectId, quantile(counts, 0.5) ?? 0)
  const taskPoints = (pick: (t: TaskAgg) => number | null): Labeled[] =>
    [...taskAgg.values()].flatMap(t => {
      const value = pick(t)
      return value === null ? [] : [{ stratum: t.stratum, value }]
    })

  // Temporal-confound sensitivity: MERGED_VERIFIED only exists after the
  // verify CLI shipped (LUM-343) — the team completes tasks same-day, so the
  // verified stratum is structurally concentrated in the post-ship hours and
  // the all-era contrast confounds outcome with process drift. Re-run the
  // headline contrasts restricting MERGED(unverified) segments to the same
  // UTC calendar day as the earliest MERGED_VERIFIED segment: same day, same
  // CLI/agent era, only hours apart — the cleanest available control group.
  const verifiedStarts = eligible
    .filter(f => f.stratum === 'MERGED_VERIFIED')
    .map(f => f.firstActionAt.getTime())
  const windowStart =
    verifiedStarts.length > 0
      ? new Date(Math.min(...verifiedStarts)).setUTCHours(0, 0, 0, 0)
      : null
  const timeMatched =
    windowStart === null
      ? null
      : eligible.filter(
          f =>
            f.stratum === 'MERGED_VERIFIED' ||
            (f.stratum === 'MERGED' && f.firstActionAt.getTime() >= windowStart)
        )
  const timeMatchedSensitivity =
    timeMatched === null
      ? null
      : {
          windowStart: new Date(windowStart!).toISOString(),
          note: 'MERGED(unverified) restricted to segments starting on the same UTC day as the earliest MERGED_VERIFIED segment (same day, same process era, hours apart) — guards the headline contrast against process drift over time',
          repeat1Arg: featureBlock(points(timeMatched, f => f.repeat1Arg)),
          redundantReadEventRatio: featureBlock(
            points(timeMatched, f => f.redundantReadEventRatio)
          ),
          actions: featureBlock(
            points(
              timeMatched.filter(f => f.actions > 0),
              f => f.actions
            )
          ),
        }

  // ── assemble report ────────────────────────────────────────────────────────
  const strataCounts: Record<string, number> = {}
  for (const s of STRATA)
    strataCounts[s] = features.filter(f => f.stratum === s).length
  const taskStrataCounts: Record<string, number> = {}
  for (const s of STRATA)
    taskStrataCounts[s] = [...taskAgg.values()].filter(
      t => t.stratum === s
    ).length
  const unresolvedStatusDist: Record<string, number> = {}
  for (const t of taskById.values())
    if (t.status !== 'DONE')
      unresolvedStatusDist[t.status] = (unresolvedStatusDist[t.status] ?? 0) + 1

  const report = {
    generatedFor: 'LUM-403',
    generatedAt: new Date().toISOString(),
    params: {
      MIN_ACTIONS,
      unitOfAnalysis:
        '(session × task) segment, labeled by event-level HookEvent.taskId',
      labelSourceNote:
        'Session.taskId binding is systematically biased (pre-06-06 sessions often unbound; 06-10 closure sweep re-bound sessions), which made the MERGED_VERIFIED stratum 100% same-day sessions. Event-level taskId covers ~97% of action events back to 2026-05-06.',
      actionEventTypes: ['POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'],
      actionKey:
        'toolName + filePath (file tools) | toolName + command head (Bash) | toolName',
      strata: {
        MERGED_VERIFIED: 'task DONE with ≥1 all-PASS verification round',
        MERGED: 'task DONE without an all-PASS round',
        UNRESOLVED: 'task not DONE (statuses listed in coverage)',
      },
      redLines: [
        'no thresholds imported from the papers (they do not transfer across agents)',
        'no online rule ships from this task — report only',
      ],
    },
    coverage: {
      actionEventsLabeled: rows.length,
      actionEventsUnlabeled: unlabeledActionEvents,
      segments: features.length,
      segmentsEligibleForRatios: eligible.length,
      tasks: taskAgg.size,
      segmentStrata: strataCounts,
      taskStrata: taskStrataCounts,
      unresolvedTaskStatuses: unresolvedStatusDist,
      timeRange:
        rows.length > 0
          ? {
              from: rows[0]!.createdAt.toISOString(),
              to: rows[rows.length - 1]!.createdAt.toISOString(),
            }
          : null,
    },
    features: {
      repeatedActionNgram: {
        primary: `repeat1Arg — consecutive same-action rate (tool+arg key), segments with ≥${MIN_ACTIONS} actions`,
        ...featureBlock(points(eligible, f => f.repeat1Arg)),
        variants: {
          repeat1Tool: featureBlock(points(eligible, f => f.repeat1Tool)),
          bigramLoop: featureBlock(points(eligible, f => f.bigramLoop)),
          trigramLoop: featureBlock(points(eligible, f => f.trigramLoop)),
          taskGrainRepeat1Arg: featureBlock(
            taskPoints(t =>
              t.repeatDenom > 0 ? t.repeatNumer / t.repeatDenom : null
            )
          ),
        },
      },
      sameFileReadNoWrite: {
        primary: `redundantReadEventRatio — redundant Reads on never-written files / all Reads, segments with ≥${MIN_ACTIONS} actions`,
        ...featureBlock(points(eligible, f => f.redundantReadEventRatio)),
        variants: {
          rereadNoWriteFileRatio: featureBlock(
            points(eligible, f => f.rereadNoWriteFileRatio)
          ),
          taskGrainRedundantReadRatio: featureBlock(
            taskPoints(t =>
              t.readEvents > 0 ? t.redundantReads / t.readEvents : null
            )
          ),
        },
      },
      stepCount: {
        primary: 'actions per segment (absolute) — all segments with ≥1 action',
        ...featureBlock(
          points(
            features.filter(f => f.actions > 0),
            f => f.actions
          )
        ),
        variants: {
          vsProjectBaseline: featureBlock(
            points(
              features.filter(f => f.actions > 0),
              f => f.stepsVsProjectBaseline
            )
          ),
          taskGrainActions: featureBlock(
            taskPoints(t => (t.actions > 0 ? t.actions : null))
          ),
          taskGrainVsProjectBaseline: featureBlock(
            taskPoints(t => {
              const base = taskProjectMedian.get(t.projectId) ?? 0
              return base > 0 && t.actions > 0 ? t.actions / base : null
            })
          ),
          segmentsPerTask: featureBlock(taskPoints(t => t.segments)),
        },
      },
    },
    sensitivity: { timeMatchedVerifiedVsMerged: timeMatchedSensitivity },
    // Qualitative spot-check hooks: the loopiest eligible segments.
    topRepeatSegments: eligible
      .filter(f => f.repeat1Arg !== null)
      .sort((a, b) => (b.repeat1Arg ?? 0) - (a.repeat1Arg ?? 0))
      .slice(0, 12)
      .map(f => ({
        sessionId: f.sessionId,
        task: f.taskIdentifier,
        stratum: f.stratum,
        actions: f.actions,
        repeat1Arg: round(f.repeat1Arg),
        bigramLoop: round(f.bigramLoop),
        failureEvents: f.failureEvents,
      })),
    segments: features.map(f => ({
      ...f,
      firstActionAt: f.firstActionAt.toISOString(),
      repeat1Arg: round(f.repeat1Arg),
      repeat1Tool: round(f.repeat1Tool),
      bigramLoop: round(f.bigramLoop),
      trigramLoop: round(f.trigramLoop),
      rereadNoWriteFileRatio: round(f.rereadNoWriteFileRatio),
      redundantReadEventRatio: round(f.redundantReadEventRatio),
      stepsVsProjectBaseline: round(f.stepsVsProjectBaseline),
    })),
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))

  // ── stdout summary ─────────────────────────────────────────────────────────
  const fmtBlock = (
    name: string,
    block: { byStratum: Record<string, ReturnType<typeof distStats>> }
  ) =>
    `  ${name.padEnd(28)} ` +
    STRATA.map(s => {
      const st = block.byStratum[s]!
      return `${s.slice(0, 8)}: n=${st.n} med=${st.median} p90=${st.p90}`
    }).join('  |  ')
  const fmtEffect = (block: {
    effectSizes: Record<
      string,
      {
        pair: string
        cliffsDelta: number | null
        auc: number | null
        pMannWhitney: number | null
        nA: number
        nB: number
      }
    >
  }) =>
    Object.values(block.effectSizes)
      .map(
        e =>
          `    ${e.pair}: δ=${e.cliffsDelta} AUC=${e.auc} p≈${e.pMannWhitney} (n=${e.nA}/${e.nB})`
      )
      .join('\n')

  const f = report.features
  console.log(
    [
      `LUM-403 trajectory-signal EDA — ${report.generatedAt}`,
      ``,
      `Coverage: ${rows.length} labeled action events (${unlabeledActionEvents} unlabeled), ${features.length} (session×task) segments, ${taskAgg.size} tasks, ${report.coverage.timeRange?.from} → ${report.coverage.timeRange?.to}`,
      `  segment strata: ${JSON.stringify(strataCounts)}  (ratio-eligible ≥${MIN_ACTIONS} actions: ${eligible.length})`,
      `  task strata:    ${JSON.stringify(taskStrataCounts)}  unresolved statuses: ${JSON.stringify(unresolvedStatusDist)}`,
      ``,
      `① repeated-action n-gram (primary: repeat1Arg, segment grain)`,
      fmtBlock('repeat1Arg', f.repeatedActionNgram),
      fmtEffect(f.repeatedActionNgram),
      `② same-file read-no-write (primary: redundantReadEventRatio)`,
      fmtBlock('redundantReadEventRatio', f.sameFileReadNoWrite),
      fmtEffect(f.sameFileReadNoWrite),
      `③ step count (primary: actions/segment)`,
      fmtBlock('actions', f.stepCount),
      fmtEffect(f.stepCount),
      ``,
      ...(timeMatchedSensitivity
        ? [
            `Sensitivity — time-matched MERGED window (≥ ${timeMatchedSensitivity.windowStart}):`,
            fmtBlock('repeat1Arg (matched)', timeMatchedSensitivity.repeat1Arg),
            fmtEffect(timeMatchedSensitivity.repeat1Arg),
            fmtBlock('actions (matched)', timeMatchedSensitivity.actions),
            fmtEffect(timeMatchedSensitivity.actions),
            ``,
          ]
        : []),
      `Full detail: ${join(outDir, 'report.json')}`,
    ].join('\n')
  )

  // ── --check: validate the report satisfies the acceptance contract ────────
  if (check) {
    const problems: string[] = []
    for (const key of [
      'repeatedActionNgram',
      'sameFileReadNoWrite',
      'stepCount',
    ] as const) {
      const block = report.features[key]
      if (!block) {
        problems.push(`missing feature block ${key}`)
        continue
      }
      for (const s of STRATA) {
        if (typeof block.byStratum[s]?.n !== 'number')
          problems.push(`${key}.byStratum.${s}.n missing`)
      }
      if (!block.effectSizes) problems.push(`${key}.effectSizes missing`)
    }
    if (rows.length === 0) problems.push('no action events fetched')
    if (eligible.length === 0) problems.push('no ratio-eligible segments')
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
