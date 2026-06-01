import { readCredentials } from '../lib/config'
import { trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'

const ALLOWED_STATUSES = [
  'PLANNED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const
type Status = (typeof ALLOWED_STATUSES)[number]

export interface UpdateMilestoneOptions {
  project?: string
  name?: string
  description?: string
  status?: string
  start?: string
  target?: string
}

interface UpdatePayload {
  name?: string
  description?: string | null
  status?: Status
  startDate?: string | null
  targetDate?: string | null
}

export function normalizeMilestoneStatus(value: string): Status | null {
  if (!value) return null
  const upper = value.toUpperCase().replace(/-/g, '_')
  return (ALLOWED_STATUSES as readonly string[]).includes(upper)
    ? (upper as Status)
    : null
}

export function buildMilestoneUpdatePayload(opts: UpdateMilestoneOptions): {
  payload: UpdatePayload
  flagsGiven: string[]
} {
  const payload: UpdatePayload = {}
  const flagsGiven: string[] = []
  if (opts.name !== undefined) {
    payload.name = opts.name
    flagsGiven.push('--name')
  }
  if (opts.description !== undefined) {
    payload.description = opts.description === '' ? null : opts.description
    flagsGiven.push('--description')
  }
  if (opts.status !== undefined) {
    payload.status = opts.status as Status
    flagsGiven.push('--status')
  }
  if (opts.start !== undefined) {
    payload.startDate = opts.start === '' ? null : opts.start
    flagsGiven.push('--start')
  }
  if (opts.target !== undefined) {
    payload.targetDate = opts.target === '' ? null : opts.target
    flagsGiven.push('--target')
  }
  return { payload, flagsGiven }
}

interface MilestoneSnapshot {
  name: string
  description?: string | null
  status?: string
  startDate?: string | null
  targetDate?: string | null
}

function fmtDate(v: string | null | undefined): string {
  if (v === null) return '∅'
  if (v === undefined) return '-'
  return v.slice(0, 10)
}

export function formatMilestoneUpdateSummary(
  before: MilestoneSnapshot,
  after: UpdatePayload
): string {
  const beforeName = sanitizeField(before.name)
  const changes: string[] = []
  if (after.name !== undefined && after.name !== before.name) {
    changes.push(`name "${beforeName}" → "${sanitizeField(after.name)}"`)
  }
  if (after.description !== undefined) {
    changes.push(
      after.description === null ? 'description → ∅' : 'description updated'
    )
  }
  if (after.status !== undefined && after.status !== before.status) {
    changes.push(`status ${before.status} → ${after.status}`)
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtDate(after.startDate)}`)
  }
  if (after.targetDate !== undefined) {
    changes.push(`target → ${fmtDate(after.targetDate)}`)
  }
  return `Updated milestone "${beforeName}": ${changes.join(', ')}`
}

export async function milestoneUpdate(
  identifier: string,
  opts: UpdateMilestoneOptions
): Promise<number | void> {
  // Validate status flag eagerly.
  let normalizedStatus: Status | undefined
  if (opts.status !== undefined) {
    const n = normalizeMilestoneStatus(opts.status)
    if (!n) {
      console.error(
        `Error: invalid status "${opts.status}". Allowed: planned, active, completed, cancelled`
      )
      return 1
    }
    normalizedStatus = n
  }

  const { payload, flagsGiven } = buildMilestoneUpdatePayload({
    ...opts,
    ...(normalizedStatus !== undefined && { status: normalizedStatus }),
  })
  if (flagsGiven.length === 0) {
    console.error(
      'Error: provide at least one field to update (--name, --description, --status, --start, --target)'
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
  const base = trimTrailingSlash(apiUrl)

  let milestoneId: string
  try {
    const resolved = await resolveMilestoneId(
      base,
      creds.token,
      identifier,
      opts.project
    )
    milestoneId = resolved.id
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Fetch current values so we can render a delta summary. Wrap network in
  // try/catch + check 401 explicitly to match milestone-create / task-create.
  let beforeRes: Response
  try {
    beforeRes = await fetch(`${base}/api/milestones/${milestoneId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (beforeRes.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!beforeRes.ok) {
    console.error(`Error: milestone fetch failed (HTTP ${beforeRes.status})`)
    return 1
  }
  const { milestone: before } = (await beforeRes.json()) as {
    milestone: MilestoneSnapshot & { name: string }
  }

  let res: Response
  try {
    res = await fetch(`${base}/api/milestones/${milestoneId}`, {
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
  if (!res.ok) {
    let errMsg = `milestone update failed (HTTP ${res.status})`
    try {
      const errBody = (await res.json()) as { error?: string }
      if (errBody.error) errMsg = errBody.error
    } catch {
      // body wasn't JSON; keep the status-only message
    }
    console.error(`Error: ${sanitizeField(errMsg)}`)
    return 1
  }

  process.stdout.write(formatMilestoneUpdateSummary(before, payload) + '\n')
}
