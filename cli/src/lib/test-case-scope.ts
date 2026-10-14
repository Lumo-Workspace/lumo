import type { ApiContext } from './test-case-api'
import { resolveMilestoneId } from './resolve'

/**
 * LUM-1135: where a test-case command points. Task and milestone cases share
 * every command body; only the URL prefix and the printed handle differ.
 */
export interface TestCaseScope {
  /** `/api/tasks/LUM-42` or `/api/milestones/<id>` — no trailing slash. */
  basePath: string
  /** What prints before `/TC3`: the task identifier or the milestone name. */
  label: string
  kind: 'task' | 'milestone'
}

export function taskScope(identifier: string): TestCaseScope {
  return {
    basePath: `/api/tasks/${encodeURIComponent(identifier)}`,
    label: identifier,
    kind: 'task',
  }
}

export async function milestoneScope(
  ctx: ApiContext,
  milestoneRef: string,
  project: string | undefined
): Promise<TestCaseScope | null> {
  try {
    const m = await resolveMilestoneId(
      ctx.base,
      ctx.token,
      milestoneRef,
      project
    )
    return {
      basePath: `/api/milestones/${encodeURIComponent(m.id)}`,
      label: m.name || milestoneRef,
      kind: 'milestone',
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
