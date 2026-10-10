import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { formatTaskListTable, type TaskRow } from '../lib/format'
import { sanitizeField } from '../lib/sanitize'

export interface ShowMilestoneOptions {
  project?: string
}

type MilestoneHealth = 'on-track' | 'at-risk' | 'overdue'

export interface MilestoneShowData {
  id: string
  name: string
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
}

const HEALTH_LABEL: Record<MilestoneHealth, string> = {
  'on-track': 'ON-TRACK',
  'at-risk': 'AT-RISK',
  overdue: 'OVERDUE',
}

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-'
}

function fmtHealth(health: MilestoneHealth | null | undefined): string {
  return health ? HEALTH_LABEL[health] : '-'
}

function sprintCoverageLines(
  coverage: MilestoneShowData['sprintCoverage']
): string[] {
  if (!coverage) return []
  if (coverage.sprints.length === 0) {
    return ['', 'Sprint coverage: (no sprint coverage)']
  }
  const numW = Math.max(...coverage.sprints.map(s => `#${s.number}`.length))
  const statusW = Math.max(...coverage.sprints.map(s => s.status.length))
  const nameW = Math.max(
    ...coverage.sprints.map(s => sanitizeField(s.name).length)
  )
  const rows = coverage.sprints.map(s => {
    const num = `#${s.number}`.padEnd(numW)
    const status = s.status.padEnd(statusW)
    const name = sanitizeField(s.name).padEnd(nameW)
    return `  ${num}  ${status}  ${name}   ${s.doneCount}/${s.taskCount} done`
  })
  if (coverage.unsprinted > 0) {
    const label = 'Unscheduled'.padEnd(numW + 2 + statusW + 2 + nameW)
    rows.push(
      `  ${label}   ${coverage.unsprinted} task${coverage.unsprinted === 1 ? '' : 's'}`
    )
  }
  return ['', 'Sprint coverage:', ...rows]
}

/**
 * LUM-648: the cross-milestone learning-migration read-out. Omitted entirely
 * when this milestone's stewards were injected no prior learning (injected=0) —
 * that's "nothing to migrate", not a 0% usage rate. When judged samples are too
 * thin the rate reads `insufficient` rather than a fabricated percentage.
 */
function crossMilestoneLearningLines(
  learning: MilestoneShowData['crossMilestoneLearning']
): string[] {
  if (!learning || learning.injected === 0) return []
  const { injected, judged, judgedUsed, sourceMilestones, rate } = learning
  const srcLabel = `${sourceMilestones} prior milestone${sourceMilestones === 1 ? '' : 's'}`
  const rateLabel =
    rate === null
      ? `insufficient (judged ${judged}, need ≥3)`
      : `${Math.round(rate * 100)}% (judged-used ${judgedUsed}/${judged})`
  return [
    '',
    'Cross-milestone learning:',
    `  Injected: ${injected} prior learning${injected === 1 ? '' : 's'} (from ${srcLabel})`,
    `  Usage rate: ${rateLabel}`,
  ]
}

export function formatMilestoneShow(
  m: MilestoneShowData,
  tasks: TaskRow[]
): string {
  // BACKLOG is unscheduled work and stays out of the progress total (LUM-1057).
  const backlog = m.taskCounts.BACKLOG ?? 0
  const total =
    m.taskCounts.TODO +
    m.taskCounts.IN_PROGRESS +
    m.taskCounts.IN_REVIEW +
    m.taskCounts.DONE
  // LUM-714: state is derived, so the line reports what the two timestamps
  // say — and, when the tasks disagree with the stored stamp, what the rollup
  // is about to do about it.
  const state = m.archivedAt
    ? 'archived'
    : m.completedAt
      ? 'completed'
      : 'active'
  const drift = m.staleness?.completionDrift
  const stateLine = drift
    ? `State:        ${state}  (stale — task progress indicates ${drift === 'complete' ? 'completed' : 'active'}; auto-updating)`
    : `State:        ${state}`
  const targetLine = m.staleness?.datesMissing
    ? `Target:       ${fmtDate(m.targetDate)}  (no target date — schedule health unavailable)`
    : `Target:       ${fmtDate(m.targetDate)}`
  const lines = [
    `Milestone:    ${sanitizeField(m.name)}`,
    stateLine,
    `Completed:    ${m.completedAt ? m.completedAt.slice(0, 10) : 'no'}`,
    `Archived:     ${m.archivedAt ? m.archivedAt.slice(0, 10) : 'no'}`,
    `Health:       ${fmtHealth(m.health)}`,
    `Start:        ${fmtDate(m.startDate)}`,
    targetLine,
    `Project:      ${sanitizeField(m.projectName)}`,
    `Description:`,
    `  ${m.description && m.description.length > 0 ? sanitizeField(m.description) : '-'}`,
    ``,
    `Tasks:        ${total} total (TODO ${m.taskCounts.TODO} / IN_PROGRESS ${m.taskCounts.IN_PROGRESS} / IN_REVIEW ${m.taskCounts.IN_REVIEW} / DONE ${m.taskCounts.DONE})${backlog > 0 ? ` + ${backlog} in BACKLOG` : ''}`,
  ]
  lines.push(...sprintCoverageLines(m.sprintCoverage))
  lines.push(...crossMilestoneLearningLines(m.crossMilestoneLearning))
  if (tasks.length > 0) {
    lines.push('', formatTaskListTable(tasks))
  }
  return lines.join('\n')
}

export async function milestoneShow(
  identifier: string,
  opts: ShowMilestoneOptions
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
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
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!milestoneRes.ok) {
    console.error(`Error: milestone show failed (HTTP ${milestoneRes.status})`)
    return 1
  }
  if (!tasksRes.ok) {
    console.error(`Error: milestone tasks failed (HTTP ${tasksRes.status})`)
    return 1
  }

  const { milestone } = (await milestoneRes.json()) as {
    milestone: {
      id: string
      name: string
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
      },
      tasks
    ) + '\n'
  )
}
