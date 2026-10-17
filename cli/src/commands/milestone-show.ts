import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { fmtCalendarDay, fmtDay, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'
import {
  formatHealth,
  milestoneState,
  type MilestoneHealth,
} from '../lib/milestone-labels'
import { renderListTable } from '../lib/list-table'
import {
  fieldLines,
  indentLines,
  sectionHeading,
  wrapLines,
  type DetailOptions,
  type Field,
} from '../lib/report-layout'
import { taskTableSection } from '../lib/detail-layout'
import {
  milestoneMetricsLines,
  type MilestoneMetricsData,
} from '../lib/milestone-metrics'
import { colorEnabled, DEFAULT_TERMINAL_WIDTH, terminalWidth } from '../lib/ui'

export interface ShowMilestoneOptions {
  project?: string
}

export interface MilestoneShowData extends MilestoneMetricsData {
  id: string
  name: string
  /** LUM-1230: the handle the milestone commands take; absent on an older server. */
  slug?: string | null
  /** LUM-714: derived completion stamp; non-null = the milestone is done. */
  completedAt: string | null
  startDate: string | null
  targetDate: string | null
  archivedAt: string | null
  description: string | null
  projectName: string
  taskCounts: {
    /** LUM-1057; absent on servers that predate BACKLOG. */
    BACKLOG?: number | undefined
    TODO: number
    IN_PROGRESS: number
    IN_REVIEW: number
    DONE: number
  }
  /** Target-date health light. Server-enriched; null when no light applies. */
  health?: MilestoneHealth | null | undefined
  /**
   * Staleness hints (LUM-624, LUM-714). `completionDrift` = the transition the
   * task counts call for when the stored `completedAt` disagrees with them
   * (the server self-heals it in the background); `datesMissing` = in-flight
   * milestone with no target date.
   */
  staleness?:
    | {
        completionDrift: 'complete' | 'reopen' | null
        datesMissing: boolean
      }
    | undefined
  /** Read-only sprint coverage derived from the milestone's tasks. */
  sprintCoverage?:
    | {
        sprints: Array<{
          sprintId: string
          number: number
          name: string
          status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
          taskCount: number
          doneCount: number
        }>
        unsprinted: number
      }
    | undefined
  /**
   * LUM-648: cross-milestone learning migration — how much of the learning
   * distilled from earlier milestones this milestone's steward sessions
   * actually used. `rate` is null when too few edges are judged (insufficient).
   */
  crossMilestoneLearning?:
    | {
        injected: number
        judged: number
        judgedUsed: number
        abstained: number
        sourceMilestones: number
        rate: number | null
      }
    | undefined
  /** LUM-1135: close gate (milestone test cases). Absent on older servers. */
  closeGate?:
    | {
        held: number
        cases: Array<{ state: 'open' | 'held'; reason: string | null }>
      }
    | null
    | undefined
}

const GATE_REASON_LABEL: Record<string, string> = {
  NOT_RUN: 'not run',
  FAILING: 'failing',
  PROVEN_DEFECT: 'proven defect',
  BLOCKED: 'blocked',
}

/** LUM-1135: `open` or `held (2 not run, 1 failing)`. */
export function formatCloseGate(
  gate: NonNullable<MilestoneShowData['closeGate']>
): string {
  if (gate.held === 0) return 'open'
  const counts = new Map<string, number>()
  for (const c of gate.cases) {
    if (c.state !== 'held' || !c.reason) continue
    const label = GATE_REASON_LABEL[c.reason] ?? c.reason.toLowerCase()
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const parts = [...counts].map(([label, n]) => `${n} ${label}`)
  return `held (${parts.join(', ')})`
}

function sprintCoverageLines(
  coverage: MilestoneShowData['sprintCoverage'],
  opts: DetailOptions
): string[] {
  if (!coverage) return []
  const lines = sectionHeading('Sprint coverage', opts)
  if (coverage.sprints.length === 0) {
    return [...lines, '  None — no task of this milestone is in a sprint.']
  }
  const rows = coverage.sprints.map(s => [
    `#${s.number}`,
    s.status,
    sanitizeField(s.name),
    `${s.doneCount}/${s.taskCount} done`,
  ])
  if (coverage.unsprinted > 0) {
    rows.push([
      'Unscheduled',
      '',
      '',
      `${coverage.unsprinted} task${coverage.unsprinted === 1 ? '' : 's'}`,
    ])
  }
  // LUM-1090: the LUM-1089 table (header on a TTY only, name cut to fit).
  const table = renderListTable(rows, {
    header: ['SPRINT', 'STATUS', 'NAME', 'PROGRESS'],
    flex: 2,
    tty: opts.tty === true,
    color: opts.color === true,
    width: (opts.width ?? DEFAULT_TERMINAL_WIDTH) - 2,
  })
  return [...lines, ...indentLines(table, 2)]
}

/**
 * LUM-648: the cross-milestone learning-migration read-out. Omitted entirely
 * when this milestone's stewards were injected no prior learning (injected=0) —
 * that's "nothing to migrate", not a 0% usage rate. When judged samples are too
 * thin the rate reads `insufficient` rather than a fabricated percentage.
 */
function crossMilestoneLearningLines(
  learning: MilestoneShowData['crossMilestoneLearning'],
  opts: DetailOptions
): string[] {
  if (!learning || learning.injected === 0) return []
  const { injected, judged, judgedUsed, sourceMilestones, rate } = learning
  const srcLabel = `${sourceMilestones} prior milestone${sourceMilestones === 1 ? '' : 's'}`
  const rateLabel =
    rate === null
      ? `insufficient (judged ${judged}, need ≥3)`
      : `${Math.round(rate * 100)}% (judged-used ${judgedUsed}/${judged})`
  return [
    ...sectionHeading('Cross-milestone learning', opts),
    ...fieldLines(
      [
        {
          label: 'Injected',
          value: `${injected} prior learning${injected === 1 ? '' : 's'} (from ${srcLabel})`,
        },
        { label: 'Usage rate', value: rateLabel },
      ],
      2,
      opts
    ),
  ]
}

/**
 * LUM-1090: the task counts as labelled rows — done over the progress total,
 * the per-status breakdown, and BACKLOG (unscheduled work, LUM-1057) on a row
 * of its own because it stays out of the total.
 */
function progressLines(
  counts: MilestoneShowData['taskCounts'],
  opts: DetailOptions
): string[] {
  const backlog = counts.BACKLOG ?? 0
  const total =
    counts.TODO + counts.IN_PROGRESS + counts.IN_REVIEW + counts.DONE
  const fields: Field[] = [
    { label: 'Done', value: `${counts.DONE} / ${total}` },
    {
      label: 'By status',
      value: `TODO ${counts.TODO} · IN_PROGRESS ${counts.IN_PROGRESS} · IN_REVIEW ${counts.IN_REVIEW} · DONE ${counts.DONE}`,
    },
  ]
  if (backlog > 0) {
    fields.push({ label: 'Backlog', value: `${backlog} (not in the total)` })
  }
  return [...sectionHeading('Progress', opts), ...fieldLines(fields, 2, opts)]
}

/**
 * LUM-1090 — `milestone show` as a detail view: `Label:  value` rows padded to
 * the widest label, then one headed section each for the description (wrapped
 * at the report width, every line indented), progress, metrics, sprint coverage,
 * cross-milestone learning and the task table. Plain text unless `opts`
 * turns colour on (the command entry does, on a TTY).
 */
export function formatMilestoneShow(
  m: MilestoneShowData,
  tasks: TaskRow[],
  opts: DetailOptions = {}
): string {
  // LUM-714: state is derived, so the line reports what the two timestamps
  // say — and, when the tasks disagree with the stored stamp, what the rollup
  // is about to do about it.
  // LUM-1089: same upper-case words as `milestone list`'s STATE column.
  const state = milestoneState(m)
  const drift = m.staleness?.completionDrift
  const stateValue = drift
    ? `${state}  (stale — task progress indicates ${drift === 'complete' ? 'COMPLETED' : 'ACTIVE'}; auto-updating)`
    : state
  const targetValue = m.staleness?.datesMissing
    ? `${fmtCalendarDay(m.targetDate)}  (no target date — schedule health unavailable)`
    : fmtCalendarDay(m.targetDate)
  const lines = fieldLines(
    [
      { label: 'Milestone', value: sanitizeField(m.name) },
      ...(m.slug ? [{ label: 'Slug', value: sanitizeField(m.slug) }] : []),
      { label: 'State', value: stateValue },
      // null = the server could not read the gate; absent = an older server.
      ...(m.closeGate === null
        ? [{ label: 'Close gate', value: 'unknown (could not read)' }]
        : m.closeGate
          ? [{ label: 'Close gate', value: formatCloseGate(m.closeGate) }]
          : []),
      {
        label: 'Completed',
        value: fmtDay(m.completedAt),
      },
      {
        label: 'Archived',
        value: fmtDay(m.archivedAt),
      },
      { label: 'Health', value: formatHealth(m.health) },
      { label: 'Start', value: fmtCalendarDay(m.startDate) },
      { label: 'Target', value: targetValue },
      { label: 'Project', value: sanitizeField(m.projectName) },
    ],
    0,
    opts
  )
  lines.push(...sectionHeading('Description', opts))
  const description = m.description ? sanitizeField(m.description).trim() : ''
  lines.push(...(description ? wrapLines(description, 2, opts) : ['  -']))
  lines.push(...progressLines(m.taskCounts, opts))
  // LUM-1190: the web metric strip (tokens · budget · active time · PRs).
  lines.push(...milestoneMetricsLines(m, opts))
  lines.push(...sprintCoverageLines(m.sprintCoverage, opts))
  lines.push(...crossMilestoneLearningLines(m.crossMilestoneLearning, opts))
  lines.push(
    ...taskTableSection(tasks, 'None — no task is in this milestone.', opts)
  )
  return lines.join('\n')
}

export async function milestoneShow(
  identifier: string,
  opts: ShowMilestoneOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fetch the milestone (with taskCounts) and the task list in parallel.
  let milestoneRes: Response
  let tasksRes: Response
  try {
    ;[milestoneRes, tasksRes] = await Promise.all([
      fetch(`${base}/api/milestones/${milestoneId}`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
      fetch(`${base}/api/milestones/${milestoneId}/tasks`, {
        headers: { Authorization: `Bearer ${creds.token}` },
      }),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (milestoneRes.status === 401 || tasksRes.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!milestoneRes.ok) {
    console.error(errHttp('milestone show', milestoneRes.status))
    return 1
  }
  if (!tasksRes.ok) {
    console.error(errHttp('milestone tasks', tasksRes.status))
    return 1
  }

  const { milestone } = (await milestoneRes.json()) as {
    milestone: {
      id: string
      name: string
      slug?: string | null
      completedAt: string | null
      startDate: string | null
      targetDate: string | null
      archivedAt: string | null
      description: string | null
      projectId: string
      taskCounts: MilestoneShowData['taskCounts']
      health?: MilestoneHealth | null
      staleness?: MilestoneShowData['staleness']
      sprintCoverage?: MilestoneShowData['sprintCoverage']
      crossMilestoneLearning?: MilestoneShowData['crossMilestoneLearning']
      closeGate?: MilestoneShowData['closeGate']
      costRollup?: MilestoneShowData['costRollup']
      budget?: MilestoneShowData['budget']
      deliveryStats?: MilestoneShowData['deliveryStats']
    }
  }
  const { tasks } = (await tasksRes.json()) as { tasks: TaskRow[] }

  // Look up project display name. If the caller passed `--project <ref>`
  // we already know it; otherwise hit /api/projects once.
  let projectName = opts.project ?? ''
  if (!projectName) {
    const pr = await fetch(`${base}/api/projects`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
    if (pr.ok) {
      const { projects } = (await pr.json()) as {
        projects: { id: string; name: string }[]
      }
      projectName = projects.find(p => p.id === milestone.projectId)?.name ?? ''
    }
  }

  process.stdout.write(
    formatMilestoneShow(
      {
        id: milestone.id,
        name: milestone.name,
        slug: milestone.slug ?? null,
        completedAt: milestone.completedAt,
        startDate: milestone.startDate,
        targetDate: milestone.targetDate,
        archivedAt: milestone.archivedAt,
        description: milestone.description,
        projectName,
        taskCounts: milestone.taskCounts,
        health: milestone.health,
        staleness: milestone.staleness,
        sprintCoverage: milestone.sprintCoverage,
        crossMilestoneLearning: milestone.crossMilestoneLearning,
        closeGate: milestone.closeGate,
        costRollup: milestone.costRollup,
        budget: milestone.budget,
        deliveryStats: milestone.deliveryStats,
      },
      tasks,
      {
        width: terminalWidth(),
        color: colorEnabled(),
        tty: Boolean(process.stdout.isTTY),
      }
    ) + '\n'
  )
}
