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
  status: string
  startDate: string | null
  targetDate: string | null
  archivedAt: string | null
  description: string | null
  projectName: string
  taskCounts: {
    TODO: number
    IN_PROGRESS: number
    IN_REVIEW: number
    DONE: number
  }
  /** Target-date health light. Server-enriched; null when no light applies. */
  health?: MilestoneHealth | null | undefined
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

export function formatMilestoneShow(
  m: MilestoneShowData,
  tasks: TaskRow[]
): string {
  const total =
    m.taskCounts.TODO +
    m.taskCounts.IN_PROGRESS +
    m.taskCounts.IN_REVIEW +
    m.taskCounts.DONE
  const lines = [
    `Milestone:    ${sanitizeField(m.name)}`,
    `Status:       ${m.status}`,
    `Archived:     ${m.archivedAt ? m.archivedAt.slice(0, 10) : 'no'}`,
    `Health:       ${fmtHealth(m.health)}`,
    `Start:        ${fmtDate(m.startDate)}`,
    `Target:       ${fmtDate(m.targetDate)}`,
    `Project:      ${sanitizeField(m.projectName)}`,
    `Description:`,
    `  ${m.description && m.description.length > 0 ? sanitizeField(m.description) : '-'}`,
    ``,
    `Tasks:        ${total} total (TODO ${m.taskCounts.TODO} / IN_PROGRESS ${m.taskCounts.IN_PROGRESS} / IN_REVIEW ${m.taskCounts.IN_REVIEW} / DONE ${m.taskCounts.DONE})`,
  ]
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
      status: string
      startDate: string | null
      targetDate: string | null
      archivedAt: string | null
      description: string | null
      projectId: string
      taskCounts: MilestoneShowData['taskCounts']
      health?: MilestoneHealth | null
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
        status: milestone.status,
        startDate: milestone.startDate,
        targetDate: milestone.targetDate,
        archivedAt: milestone.archivedAt,
        description: milestone.description,
        projectName,
        taskCounts: milestone.taskCounts,
        health: milestone.health,
      },
      tasks
    ) + '\n'
  )
}
