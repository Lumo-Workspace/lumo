import { readCredentials } from '../lib/config'
import { resolveProject } from '../lib/resolve'
import { apiCall, apiContext } from '../lib/test-case-api'
import {
  formatProjectOverview,
  formatWorkspaceOverview,
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
 * `lumo workspace overview` (LUM-1192) — the Dashboard: stats cards, status
 * distribution, projects at a glance, workload, completion trend and the
 * latest stored briefing. Read-only: never triggers a briefing generation.
 */
export async function workspaceOverview(
  opts: OverviewOptions = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const [stats, summaries] = await Promise.all([
    apiCall<{ stats: OverviewStats }>(
      ctx,
      '/api/stats/workspace',
      {},
      'workspace stats'
    ),
    apiCall<SummariesResponse>(
      ctx,
      '/api/summaries/workspace?limit=1',
      {},
      'workspace briefing'
    ),
  ])
  if (!stats.ok || !stats.data || !summaries.ok) return 1
  const summary = summaries.data?.summaries?.[0] ?? null
  if (opts.json) {
    process.stdout.write(
      JSON.stringify({ stats: stats.data.stats, summary }, null, 2) + '\n'
    )
    return
  }
  const name = readCredentials()?.workspaceName || ctx.workspaceSlug
  process.stdout.write(
    formatWorkspaceOverview(name, stats.data.stats, summary, {
      report: opts.report === true,
      width: terminalWidth(),
      color: colorEnabled(),
    }) + '\n'
  )
}

/**
 * `lumo project overview [project]` (LUM-1192) — the project page's health
 * row (stalled, high stakes, stale PRs, overdue), its stats and the latest
 * stored summary. Read-only: never triggers a summary generation.
 */
export async function projectOverview(
  ref: string | undefined,
  opts: OverviewOptions = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  let project: { id: string; name: string }
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
    process.stdout.write(
      JSON.stringify(
        {
          project: { id: project.id, name: project.name },
          stats: stats.data.stats,
          summary,
        },
        null,
        2
      ) + '\n'
    )
    return
  }
  process.stdout.write(
    formatProjectOverview(project.name, stats.data.stats, summary, new Date(), {
      report: opts.report === true,
      width: terminalWidth(),
      color: colorEnabled(),
    }) + '\n'
  )
}
