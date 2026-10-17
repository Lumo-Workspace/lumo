import { fmtDay } from '../lib/format'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'
import { NOT_LOGGED_IN_MESSAGE, errAuth, errHttp } from '../lib/errors'
import {
  detailEnvelope,
  emitJson,
  stripInternalFields,
} from '../lib/json-output'

interface SignalRow {
  id: string
  kind: string
  source: string
  detectedAt: string
  occurredAt: string | null
  evidence: { note?: string } | null
}

async function authBase(): Promise<
  { base: string; headers: Record<string, string> } | { error: string }
> {
  const creds = readCredentials()
  if (!creds) return { error: NOT_LOGGED_IN_MESSAGE }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = await resolveSessionId({ write: false })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  return { base, headers }
}

/**
 * `lumo outcome show <task>` — read the well for a task: the falsifier verdict
 * plus its backing rejection signals.
 */
export async function outcomeShow(
  taskId: string | undefined,
  opts: { json?: boolean } = {}
): Promise<number | void> {
  if (!taskId || taskId.trim() === '') {
    console.error('Error: a task is required: lumo outcome show <task>')
    return 1
  }
  const auth = await authBase()
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
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('outcome well read', res.status))
    return 1
  }

  const well = (await res.json()) as {
    verdict: 'REJECTED' | 'INCONCLUSIVE'
    signals: SignalRow[]
  }
  if (opts.json) {
    emitJson(
      detailEnvelope('outcome', stripInternalFields(well), { task: taskId })
    )
    return
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
    const when = fmtDay(s.occurredAt ?? s.detectedAt)
    const note = s.evidence?.note ? ` — ${sanitizeField(s.evidence.note)}` : ''
    process.stdout.write(
      `  ${when}  ${sanitizeField(s.kind)} (${sanitizeField(s.source)})${note}\n`
    )
  }
  return
}
