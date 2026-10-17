import { EXIT_USAGE } from '../lib/exit-codes'
import { NONE, fmtCalendarDay, fmtCount } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveMilestoneId } from '../lib/resolve'
import { sanitizeField } from '../lib/sanitize'
import { errAuth, errHttp, errNotLoggedIn, httpFailed } from '../lib/errors'

export interface UpdateMilestoneOptions {
  project?: string
  name?: string
  description?: string
  start?: string
  target?: string
  /** LUM-644 advisory token budget: a positive integer, '' to clear. */
  tokenBudget?: string
}

interface UpdatePayload {
  name?: string
  description?: string | null
  startDate?: string | null
  targetDate?: string | null
  tokenBudget?: number | null
}

/**
 * LUM-644: '' clears the budget (→ null, the nullable-flag convention);
 * otherwise the value must be a positive integer within Postgres INT range.
 * Invalid input → undefined (caller prints the error and exits 1).
 */
export function normalizeTokenBudget(value: string): number | null | undefined {
  if (value === '') return null
  if (!/^\d+$/.test(value)) return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > 2_147_483_647) return undefined
  return n
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
  if (opts.start !== undefined) {
    payload.startDate = opts.start === '' ? null : opts.start
    flagsGiven.push('--start')
  }
  if (opts.target !== undefined) {
    payload.targetDate = opts.target === '' ? null : opts.target
    flagsGiven.push('--target')
  }
  if (opts.tokenBudget !== undefined) {
    // The caller validated eagerly (normalizeTokenBudget); '' means clear.
    payload.tokenBudget =
      opts.tokenBudget === '' ? null : Number(opts.tokenBudget)
    flagsGiven.push('--token-budget')
  }
  return { payload, flagsGiven }
}

interface MilestoneSnapshot {
  name: string
  description?: string | null
  startDate?: string | null
  targetDate?: string | null
  tokenBudget?: number | null
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
      after.description === null
        ? `description → ${NONE}`
        : 'description updated'
    )
  }
  if (after.startDate !== undefined) {
    changes.push(`start → ${fmtCalendarDay(after.startDate)}`)
  }
  if (after.targetDate !== undefined) {
    changes.push(`target → ${fmtCalendarDay(after.targetDate)}`)
  }
  if (after.tokenBudget !== undefined) {
    changes.push(
      after.tokenBudget === null
        ? `token budget → ${NONE}`
        : `token budget → ${fmtCount(after.tokenBudget)}`
    )
  }
  return `Updated milestone "${beforeName}": ${changes.join(', ')}`
}

export async function milestoneUpdate(
  identifier: string,
  opts: UpdateMilestoneOptions
): Promise<number | void> {
  // Validate token budget eagerly (LUM-644): positive integer, or '' to clear.
  if (
    opts.tokenBudget !== undefined &&
    normalizeTokenBudget(opts.tokenBudget) === undefined
  ) {
    console.error(
      `Error: invalid token budget "${opts.tokenBudget}". Provide a positive integer (e.g. 5000000), or "" to clear.`
    )
    return EXIT_USAGE
  }

  const { payload, flagsGiven } = buildMilestoneUpdatePayload(opts)
  if (flagsGiven.length === 0) {
    console.error(
      'Error: provide at least one field to update (--name, --description, --start, --target, --token-budget)'
    )
    return EXIT_USAGE
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
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
    console.error(errAuth())
    return 1
  }
  if (!beforeRes.ok) {
    console.error(errHttp('milestone fetch', beforeRes.status))
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
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    let errMsg = httpFailed('milestone update', res.status)
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
