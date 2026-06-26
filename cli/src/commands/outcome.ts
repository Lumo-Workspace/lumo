import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'

/**
 * `lumo outcome` — the post-hoc outcome well (LUM-598).
 *
 * The well is the single external oracle for correctness + fidelity: it records
 * the real-world fate a delivery met AFTER it shipped. It is a FALSIFIER, not a
 * verifier — it only ever reads REJECTED (reality revoked/redid/bypassed the
 * work) or INCONCLUSIVE (no rejection on record). There is deliberately no
 * "mark satisfied": the absence of a rejection is not a pass.
 */

const MANUAL_KINDS = [
  'REVERTED',
  'ROLLED_BACK',
  'CI_REGRESSION',
  'DOWNSTREAM_REDIRECT',
  'BYPASSED',
  'MANUAL',
] as const

export interface OutcomeRecordOptions {
  kind?: string
  note?: string
  occurredAt?: string
}

interface SignalRow {
  id: string
  kind: string
  source: string
  detectedAt: string
  occurredAt: string | null
  evidence: { note?: string } | null
}

function authBase():
  | { base: string; headers: Record<string, string> }
  | { error: string } {
  const creds = readCredentials()
  if (!creds) return { error: 'not logged in. Run `lumo auth login` first.' }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  return { base, headers }
}

/**
 * `lumo outcome record <task> --note "<what reality did>" [--kind <kind>]` —
 * record a human-observed post-hoc REJECTION of a delivery. Append-only. The
 * note is mandatory (the observed referent); the default kind is MANUAL.
 */
export async function outcomeRecord(
  taskId: string | undefined,
  options: OutcomeRecordOptions = {}
): Promise<number | void> {
  if (!taskId || taskId.trim() === '') {
    console.error(
      'Error: a task is required: lumo outcome record <task> --note "…"'
    )
    return 1
  }
  const note = options.note?.trim()
  if (!note) {
    console.error(
      'Error: --note "<what reality did>" is required (the observed rejection, e.g. "reverted in #812 after prod incident").'
    )
    return 1
  }
  const kind = (options.kind?.trim().toUpperCase() ||
    'MANUAL') as (typeof MANUAL_KINDS)[number]
  if (!MANUAL_KINDS.includes(kind)) {
    console.error(
      `Error: --kind must be one of: ${MANUAL_KINDS.map(k => k.toLowerCase()).join(', ')}`
    )
    return 1
  }

  const auth = authBase()
  if ('error' in auth) {
    console.error(`Error: ${auth.error}`)
    return 1
  }

  const payload: Record<string, unknown> = { kind, note }
  if (options.occurredAt?.trim()) payload.occurredAt = options.occurredAt.trim()

  let res: Response
  try {
    res = await fetch(
      `${auth.base}/api/tasks/${encodeURIComponent(taskId)}/outcome-signals`,
      {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? sanitizeField(errBody.error)
        : ''
    console.error(
      `Error: outcome not recorded (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  process.stdout.write(
    `✓ Recorded a ${sanitizeField(kind.toLowerCase())} rejection on ${sanitizeField(taskId)}.\n` +
      '  The well is a falsifier — this marks the delivery REJECTED by reality; ' +
      'it is append-only and there is no "satisfied" counterpart.\n'
  )
  return
}

/**
 * `lumo outcome show <task>` — read the well for a task: the falsifier verdict
 * plus its backing rejection signals.
 */
export async function outcomeShow(
  taskId: string | undefined
): Promise<number | void> {
  if (!taskId || taskId.trim() === '') {
    console.error('Error: a task is required: lumo outcome show <task>')
    return 1
  }
  const auth = authBase()
  if ('error' in auth) {
    console.error(`Error: ${auth.error}`)
    return 1
  }

  let res: Response
  try {
    res = await fetch(
      `${auth.base}/api/tasks/${encodeURIComponent(taskId)}/outcome-signals`,
      { headers: auth.headers }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error('Error: API key invalid or revoked. Run `lumo auth login`.')
    return 1
  }
  if (!res.ok) {
    console.error(`Error: could not read the well (HTTP ${res.status}).`)
    return 1
  }

  const well = (await res.json()) as {
    verdict: 'REJECTED' | 'INCONCLUSIVE'
    signals: SignalRow[]
  }

  const mark = well.verdict === 'REJECTED' ? '✗' : '·'
  process.stdout.write(
    `${mark} Outcome well — ${sanitizeField(taskId)}: ${well.verdict}\n`
  )
  if (well.verdict === 'INCONCLUSIVE') {
    process.stdout.write(
      '  No rejection on record. INCONCLUSIVE ≠ satisfied — the well only ' +
        'asserts rejection; silence is not a pass.\n'
    )
    return
  }
  for (const s of well.signals) {
    const when = (s.occurredAt ?? s.detectedAt).slice(0, 10)
    const note = s.evidence?.note ? ` — ${sanitizeField(s.evidence.note)}` : ''
    process.stdout.write(
      `  ${when}  ${sanitizeField(s.kind)} (${sanitizeField(s.source)})${note}\n`
    )
  }
  return
}
