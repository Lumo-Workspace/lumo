import type { ApiContext } from './test-case-api'
import { resolveMilestoneId } from './resolve'
import { sanitizeField } from './sanitize'

/**
 * LUM-1135: where a test-case command points. Task and milestone cases share
 * every command body; only the URL prefix and the printed handle differ.
 */
export interface TestCaseScope {
  /** `/api/tasks/LUM-42` or `/api/milestones/<id>` — no trailing slash. */
  basePath: string
  /** What prints before `/TC3`: the task identifier or the milestone slug
   *  (LUM-1233: the handle `<milestone-slug>/TC<n>` the commands take back;
   *  the id when the slug is unknown). */
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
      // The slug prints before every `/TC<n>` so the handle can be pasted
      // back; it is member-chosen, so it is sanitized like the name was.
      label: sanitizeField(m.slug || m.id || milestoneRef),
      kind: 'milestone',
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
