import { EXIT_USAGE } from '../lib/exit-codes'
import { cost } from './cost'
import { report } from './report'

/**
 * LUM-1233 batch 3e (Q7) — one `usage` noun. `usage show` replaces `cost`
 * and `report`:
 *
 *   lumo usage show [--by tool|model|member|session] [--task <LUM-N> | --session <id> | --since <day> --until <day>]
 *       per-operation token cost (the former `cost`; default: workspace, last 30 days, by tool)
 *   lumo usage show --by member --tasks [--since <day>] [--until <day>] [--member <ref>] [--project <name>] [--limit N]
 *       tokens per member plus the tasks completed over local days (the former `report`; default: last 7 days)
 *
 * `--tasks` appends the completed tasks; the filters only it supports
 * (`--member`, `--project`, `--limit`) need it, and the per-operation scopes
 * (`--task`, `--session`, `--by` other than member) do not mix with it — a
 * usage error (exit 2), never a silently ignored flag.
 */
export interface UsageShowOptions {
  by?: string | undefined
  task?: string | undefined
  session?: string | undefined
  since?: string | undefined
  until?: string | undefined
  member?: string | undefined
  project?: string | undefined
  limit?: string | undefined
  tasks?: boolean | undefined
  json?: boolean | undefined
}

/** Usage problems of a flag combination (null = fine). Pure. */
export function usageShowError(o: UsageShowOptions): string | null {
  const by = o.by?.toLowerCase()
  if (by !== undefined && !['tool', 'model', 'member', 'session'].includes(by))
    return `invalid --by "${o.by}". Valid values: tool, model, member, session.`
  if (o.task !== undefined && o.session !== undefined)
    return 'pass one of --task or --session'
  const scoped =
    o.task !== undefined
      ? '--task'
      : o.session !== undefined
        ? '--session'
        : null
  if (o.tasks) {
    if (scoped)
      return `${scoped} does not go with --tasks (it covers a window of days)`
    if (by !== undefined && by !== 'member')
      return '--tasks splits by member; --by takes only member with it'
    return null
  }
  for (const [flag, v] of [
    ['--member', o.member],
    ['--project', o.project],
    ['--limit', o.limit],
  ] as const)
    if (v !== undefined) return `${flag} goes with --tasks`
  if (scoped)
    for (const [flag, v] of [
      ['--since', o.since],
      ['--until', o.until],
    ] as const)
      if (v !== undefined) return `${flag} does not go with ${scoped}`
  return null
}

export async function usageShow(
  o: UsageShowOptions = {}
): Promise<number | void> {
  const error = usageShowError(o)
  if (error) {
    console.error(`Error: ${error}`)
    return EXIT_USAGE
  }
  const pick = <K extends keyof UsageShowOptions>(...keys: K[]) =>
    Object.fromEntries(
      keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])
    ) as Pick<UsageShowOptions, K>
  if (o.tasks)
    return report(
      pick('since', 'until', 'member', 'project', 'limit', 'json') as never
    )
  return cost(pick('by', 'task', 'session', 'since', 'until', 'json') as never)
}
