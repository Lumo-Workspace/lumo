import { sanitizeField } from './sanitize'
import { fetchOpenCrossings, type OpenCrossingsResult } from './open-crossings'
import {
  splitNextActions,
  type TaskStatusResponse,
} from '../commands/task-status'

/**
 * The short "where the task stands now" block that commands which change
 * acceptance state print at the end of their output (LUM-842): `verify`,
 * `task update --status`, `crossing disposition` / `explain`, `testcase run`
 * / `disposition`.
 *
 * Before this, the agent followed nearly every one of those commands with a
 * `lumo task status` call just to learn the new state — the single largest
 * lumo cost in the transcripts, a full model step each time. The block is
 * read from the very same sources as `task status` (`GET …/status` plus the
 * open-crossings read) and bucketed with the same `splitNextActions`, so the
 * two never disagree; only the rendering is shorter. The full report stays
 * behind `lumo task status [--full]`.
 *
 * Fail-closed like `task status`: a read that failed is named as
 * "could not confirm", and a "nothing blocks DONE" line is printed only when
 * every read behind it succeeded.
 */

export type StatusRead =
  | { ok: true; value: TaskStatusResponse }
  | { ok: false; reason: string }

export interface StatusDigestInput {
  identifier: string
  status: StatusRead
  crossings: OpenCrossingsResult
}

const UNMET_SHOWN = 2
const STATEMENT_CAP = 70

function clip(s: string, max: number): string {
  const one = sanitizeField(s).replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The minimum shape the digest reads — anything else is a malformed body. */
function isStatusBody(body: unknown): body is TaskStatusResponse {
  if (!body || typeof body !== 'object') return false
  const b = body as Partial<TaskStatusResponse>
  return (
    !!b.task &&
    typeof b.task.status === 'string' &&
    typeof b.currentRound === 'number' &&
    typeof b.maxRounds === 'number' &&
    Array.isArray(b.criteria) &&
    Array.isArray(b.nextActions)
  )
}

/** Render the digest. Pure — both reads are already done. */
export function formatStatusDigest(input: StatusDigestInput): string[] {
  const head = `Status now (same read as \`lumo task status ${input.identifier}\`; no need to run it again):`
  if (!input.status.ok) {
    return [
      head,
      `  ⚠ Could not read the current status (${sanitizeField(input.status.reason)}) — nothing below is confirmed; run \`lumo task status ${input.identifier}\`.`,
    ]
  }
  const data = input.status.value
  const split = splitNextActions(data.nextActions)
  const lines = [head]

  const round =
    data.currentRound === 0
      ? 'no verify round yet'
      : `round ${data.currentRound}/${data.maxRounds}`
  const total = data.criteria.length
  const criteria =
    total === 0
      ? 'no acceptance contract'
      : `criteria ${total - split.criteria.length}/${total} met`
  lines.push(
    `  ${data.task.identifier} ${data.task.status} · ${round} · ${criteria}${data.escalated ? ' · ESCALATED — stop running lumo verify' : ''}`
  )

  if (split.criteria.length > 0) {
    const shown = split.criteria
      .slice(0, UNMET_SHOWN)
      .map(c => `${c.criterionId} ${clip(c.statement, STATEMENT_CAP)}`)
    const more =
      split.criteria.length > UNMET_SHOWN
        ? ` (+${split.criteria.length - UNMET_SHOWN} more)`
        : ''
    lines.push(`  Unmet: ${shown.join(' · ')}${more}`)
  }

  // What blocks DONE — the same four gates `task wrapup` counts.
  const blocking: string[] = []
  const unconfirmed: string[] = []
  const sendBacks = data.criteria.filter(
    c => c.latestVerdict?.verdict === 'FAIL'
  ).length
  if (sendBacks > 0) blocking.push(plural(sendBacks, 'send-back'))
  if (input.crossings.status === 'ok') {
    const ids = input.crossings.crossings.filter(c => c.blocking).map(c => c.id)
    if (ids.length > 0)
      blocking.push(
        `${plural(ids.length, 'boundary crossing')} (${ids.map(sanitizeField).join(', ')}) — the user rules`
      )
  } else {
    unconfirmed.push(
      `boundary crossings (${sanitizeField(input.crossings.reason)})`
    )
  }
  if (data.securityFindings === null) {
    unconfirmed.push('security findings')
  } else {
    const n = split.security.filter(a => a.blocking).length
    if (n > 0) blocking.push(plural(n, 'blocking security finding'))
  }
  const defects = split.testCaseVerdict.filter(
    a => a.signal === 'PROVEN_DEFECT'
  ).length
  if (defects > 0) blocking.push(plural(defects, 'proven test-case defect'))

  if (blocking.length > 0) lines.push(`  Blocks DONE: ${blocking.join(' · ')}`)
  if (unconfirmed.length > 0) {
    lines.push(
      `  ⚠ Could not confirm ${unconfirmed.join(', ')} — do not read this as clear; run \`lumo task status ${input.identifier}\`.`
    )
  } else if (blocking.length === 0) {
    lines.push('  Blocks DONE: nothing on record')
  }
  return lines
}

/**
 * Read `GET …/status` and the open crossings in parallel and render the
 * digest. Never throws — a failed read becomes a "could not confirm" line, so
 * the digest can never turn a command's success into an error.
 */
export async function fetchStatusDigest(
  base: string,
  token: string,
  identifier: string
): Promise<string[]> {
  const [status, crossings] = await Promise.all([
    readStatus(base, token, identifier),
    fetchOpenCrossings(base, token, identifier).catch(
      (err: unknown): OpenCrossingsResult => ({
        status: 'error',
        reason: err instanceof Error ? err.message : 'network error',
      })
    ),
  ])
  return formatStatusDigest({ identifier, status, crossings })
}

async function readStatus(
  base: string,
  token: string,
  identifier: string
): Promise<StatusRead> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/status`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (!res || !res.ok)
    return { ok: false, reason: `HTTP ${res?.status ?? 'unknown'}` }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, reason: 'invalid response body' }
  }
  return isStatusBody(body)
    ? { ok: true, value: body }
    : { ok: false, reason: 'unexpected response shape' }
}

/** Write the digest to stdout after a blank line. */
export async function printStatusDigest(
  base: string,
  token: string,
  identifier: string
): Promise<void> {
  const lines = await fetchStatusDigest(base, token, identifier)
  process.stdout.write('\n' + lines.join('\n') + '\n')
}
