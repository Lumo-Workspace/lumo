import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveTagRefs } from '../lib/tag-resolver'
import { resolveSprintId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { localDayStart } from '../lib/local-day'
import {
  formatNextSteps,
  nextStepsSilenced,
  type EnvLike,
  type NextStep,
} from '../lib/next-steps'
import { resolveSessionId } from '../lib/session-id'

const ALLOWED_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
type Priority = (typeof ALLOWED_PRIORITIES)[number]

export interface CreateTaskOptions {
  description?: string
  priority?: string
  assignee?: string
  project?: string
  milestone?: string
  tag?: string[]
  tagId?: string[]
  sprint?: string
  reworkOf?: string
  newScope?: boolean
  /** LUM-821: due day, YYYY-MM-DD in the local timezone. */
  due?: string
  /** Commander sets this to false for `--no-hints` (LUM-686). */
  hints?: boolean
}

interface CreatedTaskResponse {
  task: {
    id: string
    identifier: string
    title: string
    url: string
    teamId: string
    taskTags?: Array<{ id: string; name: string }>
  }
  /** Absent on older servers — the block is simply omitted (LUM-686). */
  nextSteps?: NextStep[]
}

interface SprintInfo {
  id: string
  number: number
  name: string
  teamId: string
}

/**
 * Assert that the sprint belongs to the same team as the newly created task.
 * Throws with a human-readable message on mismatch (caller console.errors it).
 */
export function assertSameTeam(
  task: { teamId: string; identifier: string },
  sprint: SprintInfo
): void {
  if (task.teamId !== sprint.teamId) {
    throw new Error(
      `Sprint binding skipped: sprint #${sprint.number} belongs to team "${sprint.teamId}", task belongs to "${task.teamId}"`
    )
  }
}

/**
 * Bind a newly created task to a sprint.
 * - Resolves the sprint ref (number or UUID).
 * - If resolveSprintId returned the UUID placeholder (teamId === ''), does a
 *   follow-up GET /api/sprints/<id> to fill in { teamId, number, name }.
 * - Asserts same-team, then POSTs to /api/sprints/<sprintId>/tasks.
 * Returns the sprint info on success, or throws on failure.
 */
async function bindTaskToSprint(
  base: string,
  token: string,
  workspaceSlug: string,
  sprintRef: string,
  task: { id: string; teamId: string; identifier: string }
): Promise<SprintInfo> {
  let sprint = await resolveSprintId(
    base,
    token,
    sprintRef,
    undefined,
    workspaceSlug
  )

  // UUID path: resolveSprintId returns a placeholder with teamId === ''
  if (sprint.teamId === '') {
    const sprintRes = await fetch(`${base}/api/sprints/${sprint.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!sprintRes.ok) {
      throw new Error(`sprint lookup failed (HTTP ${sprintRes.status})`)
    }
    const { sprint: full } = (await sprintRes.json()) as {
      sprint: { id: string; number: number; name: string; teamId: string }
    }
    sprint = {
      id: full.id,
      number: full.number,
      name: full.name,
      teamId: full.teamId,
    }
  }

  assertSameTeam(task, sprint)

  const bindRes = await fetch(`${base}/api/sprints/${sprint.id}/tasks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskId: task.id }),
  })
  if (!bindRes.ok) {
    let errMsg = `sprint bind failed (HTTP ${bindRes.status})`
    try {
      const errBody = (await bindRes.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // ignore
    }
    throw new Error(errMsg)
  }

  return sprint
}

/**
 * Uppercase + validate a priority string. Returns null on unknown values so
 * the caller can print a context-aware error.
 */
export function normalizePriority(value: string): Priority | null {
  if (!value) return null
  const upper = value.toUpperCase()
  return (ALLOWED_PRIORITIES as readonly string[]).includes(upper)
    ? (upper as Priority)
    : null
}

/**
 * Compose the full `task create` output: the result line first, then the
 * server-computed next-step block (LUM-686). Exported so the render test
 * exercises the real composition rather than re-assembling the parts itself.
 *
 * The result line stays byte-identical and first — a reader taking line 1 is
 * unaffected by the block below it.
 */
export function formatCreateOutput(
  task: {
    id: string
    identifier: string
    title: string
    url: string
    tags?: string[]
  },
  steps: NextStep[] = [],
  opts: { hints?: boolean } = {},
  env: EnvLike = process.env
): string {
  const head = formatCreatedTaskLine(task)
  if (nextStepsSilenced(env, opts)) return head
  const block = formatNextSteps(steps)
  return block === '' ? head : `${head}\n\n${block}`
}

/**
 * Format the single-line success output. Title is double-quoted; embedded
 * double-quotes are backslash-escaped so the output stays parseable as one
 * shell-safe token group. An optional Tags line is appended when tags are
 * present.
 */
export function formatCreatedTaskLine(task: {
  id: string
  identifier: string
  title: string
  url: string
  tags?: string[]
}): string {
  const escapedTitle = sanitizeField(task.title).replace(/"/g, '\\"')
  const head = `Created ${task.identifier} "${escapedTitle}"  ${task.url}`
  if (task.tags && task.tags.length > 0) {
    return `${head}\nTags: ${task.tags.map(sanitizeField).join(', ')}`
  }
  return head
}

export async function taskCreate(
  title: string | undefined,
  opts: CreateTaskOptions
): Promise<number | void> {
  if (!title || title.trim().length === 0) {
    console.error(
      'Error: missing <title>. Usage: lumo task create <title> [options]'
    )
    return 1
  }

  let dueDate: string | undefined
  if (opts.due !== undefined) {
    const iso = localDayStart(opts.due)
    if (!iso) {
      console.error(
        `Error: --due expects a valid YYYY-MM-DD date, got "${opts.due}"`
      )
      return 1
    }
    dueDate = iso
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  // Priority: default LOW, validate if provided
  let priority: Priority = 'LOW'
  if (opts.priority !== undefined) {
    const normalized = normalizePriority(opts.priority)
    if (!normalized) {
      console.error(
        `Error: invalid priority "${opts.priority}". Allowed: low, medium, high, urgent`
      )
      return 1
    }
    priority = normalized
  }

  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const url = `${base}/api/tasks`

  let tagIds: string[] | undefined
  if (
    (opts.tag && opts.tag.length > 0) ||
    (opts.tagId && opts.tagId.length > 0)
  ) {
    try {
      tagIds = await resolveTagRefs(
        { names: opts.tag ?? [], ids: opts.tagId ?? [] },
        { apiUrl, token: creds.token }
      )
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`)
      return 1
    }
  }

  const body: Record<string, unknown> = {
    title: title.trim(),
    priority,
  }
  if (opts.description !== undefined) body.description = opts.description
  if (opts.project !== undefined) body.projectRef = opts.project
  if (opts.assignee !== undefined) body.assigneeRef = opts.assignee
  if (opts.milestone !== undefined) body.milestoneRef = opts.milestone
  if (tagIds && tagIds.length > 0) body.tagIds = tagIds
  if (opts.reworkOf !== undefined) body.reworkOfRef = opts.reworkOf
  if (opts.newScope) body.newScope = true
  if (dueDate !== undefined) body.dueDate = dueDate

  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
    'Content-Type': 'application/json',
  }
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }

  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }

  if (res.status === 201) {
    const data = (await res.json()) as CreatedTaskResponse
    const responseTagNames = (data.task.taskTags ?? []).map(t => t.name)
    process.stdout.write(
      formatCreateOutput(
        { ...data.task, tags: responseTagNames },
        data.nextSteps ?? [],
        opts
      ) + '\n'
    )

    // Sprint binding (optional): if --sprint was passed, bind the new task.
    if (opts.sprint) {
      const workspaceSlug = creds.workspaceSlug ?? ''
      try {
        const sprint = await bindTaskToSprint(
          base,
          creds.token,
          workspaceSlug,
          opts.sprint,
          {
            id: data.task.id,
            teamId: data.task.teamId,
            identifier: data.task.identifier,
          }
        )
        process.stdout.write(
          `Sprint: #${sprint.number} "${sanitizeField(sprint.name)}"\n`
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Spec's literal mismatch output — print bare, no "Error:" prefix
        if (msg.startsWith('Sprint binding skipped:')) {
          console.error(msg)
        } else {
          console.error(`Error: ${sanitizeField(msg)}`)
        }
        return 1
      }
    }

    return
  }

  // Surface server error message when present, otherwise the status
  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${sanitizeField(serverMsg)}`)
  } else {
    console.error(`Error: task create failed (HTTP ${res.status})`)
  }
  return 1
}
