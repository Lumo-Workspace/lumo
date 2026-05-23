import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveTagRefs } from '../lib/tag-resolver'

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
}

interface CreatedTaskResponse {
  task: {
    id: string
    identifier: string
    title: string
    url: string
    taskTags?: Array<{ id: string; name: string }>
  }
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
  const escapedTitle = task.title.replace(/"/g, '\\"')
  const head = `Created ${task.identifier} "${escapedTitle}"  ${task.url}`
  if (task.tags && task.tags.length > 0) {
    return `${head}\nTags: ${task.tags.join(', ')}`
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

  const envUrl = process.env.LUMO_API_URL?.trim()
  const apiUrl = envUrl && envUrl.length > 0 ? envUrl : creds.apiUrl
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks`

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

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
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
      formatCreatedTaskLine({ ...data.task, tags: responseTagNames }) + '\n'
    )
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
    console.error(`Error: ${serverMsg}`)
  } else {
    console.error(`Error: task create failed (HTTP ${res.status})`)
  }
  return 1
}
