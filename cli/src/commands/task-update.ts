import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { normalizePriority } from './task-create'

const ALLOWED_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface UpdateTaskOptions {
  title?: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
}

interface UpdatedTaskResponse {
  task: {
    id: string
    identifier: string
    title: string
    url: string
  }
}

/**
 * Normalize a user-supplied status value. Accepts both `IN_PROGRESS` and
 * `in-progress` forms; returns null on unknown values so the caller can
 * print a context-aware error.
 */
export function normalizeStatus(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

/**
 * Translate parsed CLI flags into the wire payload for
 * `PATCH /api/tasks/by-identifier/[identifier]`. Empty-string description /
 * assignee become `null` (clear). Caller is responsible for normalizing
 * status / priority before passing them in.
 */
export function buildUpdatePayload(opts: UpdateTaskOptions): {
  payload: Record<string, unknown>
  flagsGiven: string[]
} {
  const payload: Record<string, unknown> = {}
  const flagsGiven: string[] = []

  if (opts.title !== undefined) {
    payload.title = opts.title
    flagsGiven.push('--title')
  }
  if (opts.description !== undefined) {
    payload.description = opts.description === '' ? null : opts.description
    flagsGiven.push('--description')
  }
  if (opts.status !== undefined) {
    payload.status = opts.status
    flagsGiven.push('--status')
  }
  if (opts.priority !== undefined) {
    payload.priority = opts.priority
    flagsGiven.push('--priority')
  }
  if (opts.assignee !== undefined) {
    payload.assigneeRef = opts.assignee === '' ? null : opts.assignee
    flagsGiven.push('--assignee')
  }

  return { payload, flagsGiven }
}

/**
 * Single-line success output. Mirrors `formatCreatedTaskLine` for grep-
 * ability — embedded double-quotes are backslash-escaped.
 */
export function formatUpdatedTaskLine(task: {
  id: string
  identifier: string
  title: string
  url: string
}): string {
  const escapedTitle = task.title.replace(/"/g, '\\"')
  return `Updated ${task.identifier} "${escapedTitle}"  ${task.url}`
}

export async function taskUpdate(
  identifier: string | undefined,
  opts: UpdateTaskOptions
): Promise<number | void> {
  if (!identifier || identifier.trim().length === 0) {
    console.error(
      'Error: missing <identifier>. Usage: lumo task update <LUM-42> [options]'
    )
    return 1
  }

  // Normalize status / priority before payload build.
  let status: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeStatus(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: todo, in_progress, in_review, done`
      )
      return 1
    }
    status = n
  }

  let priority: string | undefined
  if (opts.priority !== undefined) {
    const n = normalizePriority(opts.priority)
    if (!n) {
      console.error(
        `Error: invalid priority "${opts.priority}". Allowed: low, medium, high, urgent`
      )
      return 1
    }
    priority = n
  }

  const { payload, flagsGiven } = buildUpdatePayload({
    ...opts,
    ...(status !== undefined ? { status } : {}),
    ...(priority !== undefined ? { priority } : {}),
  })

  if (flagsGiven.length === 0) {
    console.error(
      'Error: provide at least one field to update (--title, --description, --status, --priority, --assignee)'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/by-identifier/${encodeURIComponent(identifier)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

  if (res.status === 200) {
    const data = (await res.json()) as UpdatedTaskResponse
    process.stdout.write(formatUpdatedTaskLine(data.task) + '\n')
    return
  }

  let serverMsg: string | null = null
  try {
    const errBody = (await res.json()) as { error?: string }
    if (typeof errBody.error === 'string') serverMsg = errBody.error
  } catch {
    // Body wasn't JSON; fall through to status-only message
  }
  if (serverMsg) {
    console.error(`Error: ${serverMsg}`)
  } else {
    console.error(`Error: task update failed (HTTP ${res.status})`)
  }
  return 1
}
