import { readCredentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext } from '../lib/test-case-api'
import { fetchDirectory } from '../lib/directory'
import { localDayLabel, localDayStart } from '../lib/local-day'
import { normalizeEnumList } from './task-search'

/**
 * LUM-821: `lumo initiative update` and `lumo initiative progress add/list`
 * — the Linear-initiative write surface (status, goal, dates, progress posts
 * with health).
 */

export const INITIATIVE_STATUSES = [
  'PROPOSED',
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const HEALTH = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'] as const

export interface InitiativeUpdateOptions {
  status?: string
  goal?: string
  description?: string
  priority?: string
  start?: string
  target?: string
}

/** One enum value, case/dash-insensitive; null when invalid. */
function oneOf(value: string, allowed: readonly string[]): string | null {
  const r = normalizeEnumList([value], allowed)
  return r.ok && r.values.length === 1 ? r.values[0]! : null
}

/**
 * Flags → PATCH body. `""` clears description / priority / dates. Returns
 * an error string instead when a flag is invalid (pure, for tests).
 */
export function buildInitiativePatch(
  opts: InitiativeUpdateOptions
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const body: Record<string, unknown> = {}
  if (opts.status !== undefined) {
    const v = oneOf(opts.status, INITIATIVE_STATUSES)
    if (!v) {
      return {
        ok: false,
        error: `invalid status "${opts.status}". Allowed: proposed, planned, active, completed, cancelled`,
      }
    }
    body.status = v
  }
  if (opts.goal !== undefined) {
    if (!opts.goal.trim()) return { ok: false, error: '--goal cannot be empty' }
    body.name = opts.goal.trim()
  }
  if (opts.description !== undefined) {
    body.description = opts.description === '' ? null : opts.description
  }
  if (opts.priority !== undefined) {
    if (opts.priority === '') body.priority = null
    else {
      const v = oneOf(opts.priority, PRIORITIES)
      if (!v) {
        return {
          ok: false,
          error: `invalid priority "${opts.priority}". Allowed: low, medium, high, urgent`,
        }
      }
      body.priority = v
    }
  }
  for (const [flag, key, raw] of [
    ['--start', 'startDate', opts.start],
    ['--target', 'targetDate', opts.target],
  ] as const) {
    if (raw === undefined) continue
    if (raw === '') {
      body[key] = null
      continue
    }
    const iso = localDayStart(raw)
    if (!iso) {
      return {
        ok: false,
        error: `${flag} expects a valid YYYY-MM-DD date, got "${raw}"`,
      }
    }
    body[key] = iso
  }
  if (Object.keys(body).length === 0) {
    return {
      ok: false,
      error:
        'provide at least one field to update (--status, --goal, --description, --priority, --start, --target)',
    }
  }
  return { ok: true, body }
}

/** `lumo initiative update <LUM-INIT-N> [flags]` */
export async function initiativeUpdate(
  ref: string,
  opts: InitiativeUpdateOptions
): Promise<number | void> {
  const patch = buildInitiativePatch(opts)
  if (!patch.ok) {
    console.error(`Error: ${patch.error}`)
    return 1
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{
    initiative: { identifier: string; status: string; name: string }
  }>(
    ctx,
    `/api/initiatives/${encodeURIComponent(ref)}`,
    { method: 'PATCH', json: patch.body },
    'initiative update'
  )
  if (!r.ok || !r.data) return 1
  const i = r.data.initiative
  process.stdout.write(
    `Updated ${i.identifier}  ${i.status}  ${sanitizeField(i.name)}\n`
  )
}

/** `lumo initiative progress add <LUM-INIT-N> <body> [--health]` */
export async function initiativeProgressAdd(
  ref: string,
  body: string,
  opts: { health?: string }
): Promise<number | void> {
  if (!body || !body.trim()) {
    console.error('Error: missing <body> — what changed since the last update')
    return 1
  }
  let health: string | undefined
  if (opts.health !== undefined) {
    const v = oneOf(opts.health, HEALTH)
    if (!v) {
      console.error(
        `Error: invalid health "${opts.health}". Allowed: on_track, at_risk, off_track`
      )
      return 1
    }
    health = v
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ update: { id: string } }>(
    ctx,
    `/api/initiatives/${encodeURIComponent(ref)}/updates`,
    { method: 'POST', json: { body, ...(health ? { health } : {}) } },
    'progress update'
  )
  if (!r.ok || !r.data) return 1
  process.stdout.write(
    `Posted progress update on ${ref}${health ? ` (${health})` : ''}\n`
  )
}

export interface ProgressUpdateRow {
  id: string
  authorMemberId: string
  body: string
  health: string | null
  createdAt: string
}

/** Newest-first blocks: `2026-09-23  AT_RISK  Alice` then the indented body. */
export function formatProgressUpdates(
  updates: ProgressUpdateRow[],
  names: Map<string, string>
): string {
  if (updates.length === 0) return 'No progress updates.'
  return updates
    .map(u => {
      const head = [
        localDayLabel(u.createdAt),
        u.health ?? '-',
        sanitizeField(names.get(u.authorMemberId) ?? 'unknown'),
      ].join('  ')
      const body = sanitizeField(u.body)
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n')
      return `${head}\n${body}`
    })
    .join('\n\n')
}

/** `lumo initiative progress list <LUM-INIT-N>` */
export async function initiativeProgressList(
  ref: string
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const r = await apiCall<{ updates: ProgressUpdateRow[] }>(
    ctx,
    `/api/initiatives/${encodeURIComponent(ref)}/updates`,
    {},
    'progress list'
  )
  if (!r.ok || !r.data) return 1
  // Author names are best-effort: a directory failure still prints the posts.
  const names = new Map<string, string>()
  if (r.data.updates.length > 0 && readCredentials()) {
    const dir = await fetchDirectory(ctx)
    for (const m of dir?.members ?? []) names.set(m.memberId, m.displayName)
  }
  process.stdout.write(formatProgressUpdates(r.data.updates, names) + '\n')
}
