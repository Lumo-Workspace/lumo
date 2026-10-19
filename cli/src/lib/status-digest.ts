import { sanitizeField } from './sanitize'
import { fetchOpenCrossings, type OpenCrossingsResult } from './open-crossings'
import {
  splitNextActions,
  testCaseVerdictBlocks,
  type TaskStatusResponse,
} from '../commands/task-status'

/**
 * The short "where the task stands now" block that commands which change
 * DONE-relevant state print at the end of their output (LUM-842):
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
    Array.isArray(b.nextActions)
  )
}

/**
 * What the digest's reads say about DONE (LUM-1106): what blocks it, and
 * which reads could not be confirmed. Pure — both reads are already done.
 * `statusOk: false` means the status read itself failed, so nothing at all
 * is known.
 */
export interface DigestDoneVerdict {
  statusOk: boolean
  blocking: string[]
  unconfirmed: string[]
}

export function assessDigest(input: StatusDigestInput): DigestDoneVerdict {
  if (!input.status.ok)
    return { statusOk: false, blocking: [], unconfirmed: ['task status'] }
  const data = input.status.value
  const split = splitNextActions(data.nextActions)

  // What blocks DONE — the same gates the DONE-readiness section counts.
  const blocking: string[] = []
  const unconfirmed: string[] = []
  if (input.crossings.status === 'ok') {
    const ids = input.crossings.crossings
      .filter(c => c.blocking)
      .map(c => c.ref)
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
  // LUM-1186: a ruled-on defect no longer blocks (server `blocking: false`).
  const defects = split.testCaseVerdict.filter(testCaseVerdictBlocks).length
  if (defects > 0) blocking.push(plural(defects, 'proven test-case defect'))
  return { statusOk: true, blocking, unconfirmed }
}

/**
 * True only when every read succeeded and nothing blocks DONE — the exact
 * condition under which the digest prints "Blocks DONE: nothing on record".
 * Fail-closed: any failed read is false.
 */
export function digestClearsDone(v: DigestDoneVerdict): boolean {
  return v.statusOk && v.blocking.length === 0 && v.unconfirmed.length === 0
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
  const { blocking, unconfirmed } = assessDigest(input)
  const lines = [head]
  lines.push(
    `  ${input.status.value.task.identifier} ${input.status.value.task.status}`
  )
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
  return (await readStatusDigest(base, token, identifier)).lines
}

/**
 * LUM-1106: the digest's lines plus whether they clear DONE — one read, so
 * the verdict a caller acts on is exactly what the printed lines say.
 * Never throws.
 */
export async function readStatusDigest(
  base: string,
  token: string,
  identifier: string
): Promise<{ lines: string[]; clearsDone: boolean }> {
  const [status, crossings] = await Promise.all([
    readStatus(base, token, identifier),
    fetchOpenCrossings(base, token, identifier).catch(
      (err: unknown): OpenCrossingsResult => ({
        status: 'error',
        reason: err instanceof Error ? err.message : 'network error',
      })
    ),
  ])
  const input = { identifier, status, crossings }
  return {
    lines: formatStatusDigest(input),
    clearsDone: digestClearsDone(assessDigest(input)),
  }
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
