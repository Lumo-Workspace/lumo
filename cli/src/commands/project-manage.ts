import { EXIT_USAGE } from '../lib/exit-codes'
import { readCredentials } from '../lib/config'
import { apiCall, apiContext } from '../lib/test-case-api'
import { fetchDirectory, resolveDirectoryMember } from '../lib/directory'
import { resolveProject, slugify, type ResolvedProject } from '../lib/resolve'
import { successLine } from '../lib/feedback'
import { isCalendarDay } from '../lib/local-day'
import { sanitizeField } from '../lib/sanitize'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'
import {
  isValidProjectDateWindow,
  parseProjectStatus,
  type ProjectStatusValue,
} from '../../../shared/src/project-lifecycle'

/** LUM-821: `lumo project create` / `lumo project update`. */

interface ProjectRow {
  id: string
  name: string
}

/** `lumo project create <name> [--description]` */
export async function projectCreate(
  name: string,
  opts: { description?: string } = {}
): Promise<number | void> {
  const trimmed = name.trim()
  if (!trimmed) {
    console.error('Error: project name must not be empty')
    return 1
  }
  if (trimmed.length > 200) {
    console.error('Error: project name must be at most 200 characters')
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ project: ProjectRow }>(
    ctx,
    '/api/projects',
    {
      method: 'POST',
      json: {
        name: trimmed,
        ...(opts.description !== undefined
          ? { description: opts.description }
          : {}),
      },
    },
    'project create'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(formatCreatedProjectLine(r.data.project) + '\n')
}

/** LUM-1092: `Created project "<name>"  <slug>` — LUM-1230: the slug
 *  `--project` takes, never the cuid. */
export function formatCreatedProjectLine(project: ProjectRow): string {
  const slug = slugify(project.name)
  return successLine({
    verb: 'Created',
    kind: 'project',
    title: project.name,
    ...(slug ? { id: slug } : {}),
  })
}

export interface ProjectUpdateOptions extends ConfirmFlags {
  name?: string
  description?: string
  owner?: string
  /** LUM-1285: active | paused | canceled — a human ruling, gated. */
  status?: string
  /** LUM-1285: YYYY-MM-DD; "" clears. */
  start?: string
  target?: string
}

/** LUM-1285: what each status means for agents, for the envelope. */
const STATUS_CONSEQUENCE: Record<ProjectStatusValue, string> = {
  ACTIVE:
    'Its open tasks return to `lumo status --next`; task create accepts it again',
  PAUSED:
    'Agents stop picking up its tasks (`lumo status --next` skips them); task create still works, with a warning',
  CANCELED:
    'Agents stop picking up its tasks and task create into it is refused until it is ACTIVE again',
}

/**
 * The changes[] block of the `project update --status` envelope (LUM-1285):
 * the status move, what it does to agents, then any other field in the call.
 */
export function describeProjectUpdate(
  projectName: string,
  from: string,
  to: ProjectStatusValue,
  others: string[] = []
): string[] {
  return [
    `Will set project "${sanitizeField(projectName)}" status: ${from} → ${to}`,
    STATUS_CONSEQUENCE[to],
    ...others,
  ]
}

/** `--start` / `--target`: "" clears; otherwise a real YYYY-MM-DD. */
function dateFlag(
  flag: string,
  value: string | undefined
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === '') return { ok: true, value: null }
  if (!isCalendarDay(value)) {
    console.error(`Error: ${flag} expects a YYYY-MM-DD date, got "${value}"`)
    return { ok: false }
  }
  return { ok: true, value }
}

/**
 * `lumo project update <ref> [--name] [--description] [--owner] [--status]
 * [--start] [--target]`. `--status` is a human ruling (LUM-1285): without
 * `--confirm` it prints the confirmation envelope and exits 4, sending nothing.
 */
export async function projectUpdate(
  ref: string,
  opts: ProjectUpdateOptions
): Promise<number | void> {
  const body: Record<string, unknown> = {}
  const others: string[] = []
  if (opts.name !== undefined) {
    if (!opts.name.trim()) {
      console.error('Error: --name cannot be empty')
      return EXIT_USAGE
    }
    body.name = opts.name.trim()
    others.push(`name → "${sanitizeField(body.name as string)}"`)
  }
  if (opts.description !== undefined) {
    body.description = opts.description === '' ? null : opts.description
    others.push(
      opts.description === '' ? 'description cleared' : 'description updated'
    )
  }
  let status: ProjectStatusValue | undefined
  if (opts.status !== undefined) {
    const parsed = parseProjectStatus(opts.status)
    if (!parsed) {
      console.error(
        `Error: invalid --status "${opts.status}". Allowed: active, paused, canceled`
      )
      return EXIT_USAGE
    }
    status = parsed
    body.status = parsed
  }
  const start = dateFlag('--start', opts.start)
  const target = dateFlag('--target', opts.target)
  if (!start.ok || !target.ok) return EXIT_USAGE
  if (start.value !== undefined) {
    body.startDate = start.value
    others.push(`start → ${start.value ?? 'cleared'}`)
  }
  if (target.value !== undefined) {
    body.targetDate = target.value
    others.push(`target → ${target.value ?? 'cleared'}`)
  }
  if (!isValidProjectDateWindow(start.value, target.value)) {
    console.error('Error: --target must be on or after --start')
    return EXIT_USAGE
  }
  if (Object.keys(body).length === 0 && opts.owner === undefined) {
    console.error(
      'Error: provide at least one field to update (--name, --description, --owner, --status, --start, --target)'
    )
    return EXIT_USAGE
  }
  const ctx = apiContext()
  if (!ctx) return 1

  if (opts.owner !== undefined) {
    if (opts.owner === '') {
      body.ownerId = null
      others.push('owner cleared')
    } else {
      // The API takes the owner as an Actor id; resolve the ref locally.
      const dir = await fetchDirectory(ctx)
      if (!dir) return 1
      const creds = readCredentials()
      const hit = resolveDirectoryMember(dir, opts.owner, {
        userId: creds?.userId ?? '',
        email: creds?.email ?? '',
      })
      if (hit.kind !== 'ok') {
        console.error(
          hit.kind === 'ambiguous'
            ? `Error: owner "${opts.owner}" is ambiguous — use an email`
            : `Error: no member matches "${opts.owner}". Try \`lumo member list\`.`
        )
        return 1
      }
      body.ownerId =
        dir.members.find(m => m.memberId === hit.member.memberId)?.actorId ??
        null
      others.push(`owner → ${sanitizeField(opts.owner)}`)
    }
  }

  let project: ResolvedProject
  try {
    project = await resolveProject(ctx.base, ctx.token, ref)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // LUM-1285: a status change is a human ruling — show it, send nothing.
  const current = project.status ?? 'ACTIVE'
  if (status !== undefined && status !== current && !isConfirmed(opts)) {
    return emitConfirmation({
      command: 'project update',
      changes: describeProjectUpdate(project.name, current, status, others),
    })
  }

  const r = await apiCall<{ project: ProjectRow & { status?: string } }>(
    ctx,
    `/api/projects/${encodeURIComponent(project.id)}`,
    { method: 'PATCH', json: body },
    'project update'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    successLine({
      verb: 'Updated',
      kind: 'project',
      title: r.data.project.name,
      ...(status !== undefined && r.data.project.status
        ? { suffix: `(status ${r.data.project.status})` }
        : {}),
    }) + '\n'
  )
}

/**
 * `lumo project archive|unarchive <ref>` (LUM-1285): archived projects leave
 * the sidebar and `project list` (`--all` shows them) and take no new tasks.
 * Reversible, history kept — no confirmation, like `milestone archive`.
 */
export async function projectSetArchived(
  ref: string,
  archived: boolean
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
  const what = archived ? 'project archive' : 'project unarchive'
  const r = await apiCall<{ project: ProjectRow }>(
    ctx,
    `/api/projects/${encodeURIComponent(project.id)}`,
    { method: 'PATCH', json: { archived } },
    what
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    successLine({
      verb: archived ? 'Archived' : 'Unarchived',
      kind: 'project',
      title: r.data.project.name,
    }) + '\n'
  )
}
