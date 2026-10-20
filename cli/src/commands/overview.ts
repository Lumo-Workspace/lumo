import { resolveProject, type ResolvedProject } from '../lib/resolve'
import { emitJson, withVersion } from '../lib/json-output'
import { apiCall, apiContext } from '../lib/test-case-api'
import {
  formatProjectOverview,
  type OverviewStats,
  type OverviewSummary,
} from '../lib/overview-format'
import { colorEnabled, terminalWidth } from '../lib/ui'

export interface OverviewOptions {
  json?: boolean
  report?: boolean
}

interface SummariesResponse {
  summaries?: OverviewSummary[]
}

/**
 * `lumo project show [project]` (formerly `project overview`) (LUM-1192) — the project page's health
 * row (stalled, high stakes, stale PRs, overdue), its stats and the latest
 * stored summary. Read-only: never triggers a summary generation.
 */
/**
 * LUM-1285: the lifecycle fields `--json` adds next to id and name (only those
 * the server sent — an older server sends none).
 */
export function lifecycle(p: ResolvedProject): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (p.status !== undefined) out.status = p.status
  if (p.startDate !== undefined) out.startDate = p.startDate
  if (p.targetDate !== undefined) out.targetDate = p.targetDate
  if (p.archivedAt !== undefined) out.archivedAt = p.archivedAt
  if (p.completed !== undefined) out.completed = p.completed
  return out
}

export async function projectOverview(
  ref: string | undefined,
  opts: OverviewOptions = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  let project: ResolvedProject
  try {
    project = await resolveProject(ctx.base, ctx.token, ref)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  const id = encodeURIComponent(project.id)
  const [stats, summaries] = await Promise.all([
    apiCall<{ stats: OverviewStats }>(
      ctx,
      `/api/stats/project/${id}`,
      {},
      'project stats'
    ),
    apiCall<SummariesResponse>(
      ctx,
      `/api/summaries/project/${id}?limit=1`,
      {},
      'project summary'
    ),
  ])
  if (!stats.ok || !stats.data || !summaries.ok) return 1
  const summary = summaries.data?.summaries?.[0] ?? null
  if (opts.json) {
    emitJson(
      withVersion({
        project: { id: project.id, name: project.name, ...lifecycle(project) },
        stats: stats.data.stats,
        summary,
      })
    )
    return
  }
  process.stdout.write(
    formatProjectOverview(project.name, stats.data.stats, summary, new Date(), {
      report: opts.report === true,
      width: terminalWidth(),
      tty: Boolean(process.stdout.isTTY),
      color: colorEnabled(),
      ...(project.status
        ? {
            lifecycle: {
              status: project.status,
              startDate: project.startDate,
              targetDate: project.targetDate,
              archivedAt: project.archivedAt,
              completed: project.completed,
            },
          }
        : {}),
    }) + '\n'
  )
}
