import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printStatusDigest } from '../lib/status-digest'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import { resolveSessionId } from '../lib/session-id'
import { AUTH_INVALID_REASON, errNotLoggedIn } from '../lib/errors'

export interface FindingDispositionOptions {
  falsePositive?: boolean
  acceptedRisk?: boolean
  note?: string
  task?: string
  /** The user approved the envelope (never self-supplied). */
  confirm?: boolean
}

export type FindingRuling = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

/** One finding as `GET /api/tasks/<task>/security-findings` returns it. */
export interface FindingForDisposition {
  id: string
  severity: string
  provenance: string
  ruleId: string
  filePath: string
  line: number | null
  title: string
  prNumber: number
  disposition: string | null
  blocking: boolean
}

const oneLine = (s: string): string =>
  sanitizeField(s).replace(/\s+/g, ' ').trim()

const where = (f: { filePath: string; line: number | null }): string =>
  f.line == null ? f.filePath : `${f.filePath}:${f.line}`

/**
 * The envelope's `changes`: one line per finding (id, severity, title,
 * ruling, note), then the DONE consequence and where the ruling can be
 * corrected. Every field from the scan is untrusted and sanitized.
 */
export function describeFindingRulings(
  findings: FindingForDisposition[],
  ruling: FindingRuling,
  ctx: { taskIdentifier: string; note?: string | undefined; webUrl?: string }
): string[] {
  const note = ctx.note ? ` · note: "${oneLine(ctx.note)}"` : ''
  const lines = findings.map(
    f =>
      `${oneLine(f.id)} [${oneLine(f.severity)}] ${oneLine(f.title)} — ${oneLine(f.ruleId)} at ${oneLine(where(f))} (PR #${f.prNumber}, ${f.blocking ? 'blocks DONE' : 'advisory'}): ${f.disposition ?? 'OPEN'} → ${ruling}${note}`
  )
  const blocking = findings.filter(f => f.blocking).length
  lines.push(
    blocking > 0
      ? `⚠ Approving clears ${blocking} finding${blocking === 1 ? "'s" : "s'"} block on moving ${ctx.taskIdentifier} to DONE`
      : 'Advisory only — none of these block DONE; the ruling is for the record'
  )
  if (ruling === 'ACCEPTED_RISK' && !ctx.note) {
    lines.push(
      '⚠ ACCEPTED_RISK records that the risk is real and knowingly carried — a --note saying why is strongly recommended'
    )
  }
  lines.push(
    `Recorded as a CLI-channel ruling on the task timeline${ctx.webUrl ? `; the web panel can correct it: ${ctx.webUrl}` : ''}`
  )
  return lines
}

/**
 * `lumo finding disposition <id...> --false-positive | --accepted-risk
 * [--note <text>] [--task <LUM-N>] [--confirm]` — LUM-1128.
 *
 * Records the USER's ruling on PR security findings from the terminal; it is
 * how a blocking finding is cleared for DONE (the web panel stays a second
 * surface). Standard confirmation protocol (LUM-755): without `--confirm` it
 * reads the findings from the server and prints ONE envelope — one line per
 * finding — and exits 4, writing nothing; the agent relays it and re-runs the
 * `confirmCommand` only after the user approves in chat. With `--confirm` it
 * applies each ruling and reports each on its own line.
 *
 * Deliberately no read-receipt handshake and no agent-session guard (the
 * LUM-750 guard was reverted in PR 1006): the server records the ruling as
 * channel CLI with actor, session and time, and the web panel can correct it.
 */
export async function findingDisposition(
  rawIds: string[],
  options: FindingDispositionOptions = {}
): Promise<number | void> {
  const ids = [...new Set(rawIds.map(s => s.trim()).filter(Boolean))]
  if (ids.length === 0) {
    console.error(
      'Error: at least one finding id is required: lumo finding disposition <id...> --false-positive | --accepted-risk (ids are listed by `lumo task status`).'
    )
    return 1
  }
  if (Boolean(options.falsePositive) === Boolean(options.acceptedRisk)) {
    console.error(
      'Error: pass exactly one of --false-positive or --accepted-risk (the ruling to record).'
    )
    return 1
  }
  const ruling: FindingRuling = options.falsePositive
    ? 'FALSE_POSITIVE'
    : 'ACCEPTED_RISK'
  const note = options.note?.trim() || undefined

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = await resolveSessionId({ write: true })
  if (sessionId) headers['X-Lumo-Session-Id'] = sessionId

  const bound = await resolveBoundTask({
    base,
    headers,
    explicit: options.task,
    sessionId,
  })
  if (!bound.ok) {
    console.error(bound.message)
    return 1
  }
  const taskId = bound.taskIdentifier
  const taskPath = `${base}/api/tasks/${encodeURIComponent(taskId)}`

  // Read first, on every path — the envelope is computed from server state,
  // and a confirmed write against findings that cannot be read must not go
  // out (fail closed).
  const read = await readFindings(taskPath, headers)
  if (read.status === 'error') {
    console.error(
      `Error: could not read the security findings on ${taskId} (${read.reason}) — nothing was written.`
    )
    return 1
  }
  const missing = ids.filter(id => !read.findings.some(f => f.id === id))
  if (missing.length > 0) {
    console.error(
      `Error: finding ${missing.map(sanitizeField).join(', ')} not found on ${taskId} — nothing was written. Ids are listed by \`lumo task status ${taskId}\`.`
    )
    return 1
  }
  const selected = ids.map(id => read.findings.find(f => f.id === id)!)
  const already = selected.filter(f => f.disposition === ruling)
  const todo = selected.filter(f => f.disposition !== ruling)
  for (const f of already) {
    process.stdout.write(
      `Finding ${sanitizeField(f.id)} is already ${ruling} — skipped.\n`
    )
  }
  if (todo.length === 0) return

  const webUrl = dispositionUrl(
    apiUrl,
    creds.workspaceSlug ?? '',
    taskId
  ).replace(/#.*$/, '')

  if (!options.confirm) {
    return emitConfirmation({
      command: 'finding disposition',
      changes: describeFindingRulings(todo, ruling, {
        taskIdentifier: taskId,
        note,
        webUrl,
      }),
    })
  }

  let failed = 0
  for (const f of todo) {
    const posted = await postRuling(
      `${taskPath}/security-findings/${encodeURIComponent(f.id)}/disposition`,
      headers,
      { disposition: ruling, ...(note ? { note } : {}) }
    )
    if (posted.status === 'error') {
      failed++
      console.error(
        `✗ ${sanitizeField(f.id)}: disposition rejected — ${posted.reason}`
      )
      continue
    }
    process.stdout.write(
      `✓ ${sanitizeField(f.id)} → ${ruling}${f.blocking ? ` (no longer blocks DONE on ${taskId})` : ''}\n`
    )
  }
  process.stdout.write(
    `Recorded as channel CLI on the task timeline (user-approved via the confirmation envelope); the web panel can correct it: ${webUrl}\n`
  )
  await printStatusDigest(base, creds.token, taskId)
  return failed > 0 ? 1 : undefined
}

type ReadResult =
  | { status: 'ok'; findings: FindingForDisposition[] }
  | { status: 'error'; reason: string }

async function readFindings(
  taskPath: string,
  headers: Record<string, string>
): Promise<ReadResult> {
  let res: Response
  try {
    res = await fetch(`${taskPath}/security-findings`, { headers })
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (res.status === 401)
    return { status: 'error', reason: AUTH_INVALID_REASON }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  try {
    const data = (await res.json()) as { findings?: unknown }
    if (!Array.isArray(data.findings)) {
      return { status: 'error', reason: 'invalid response body' }
    }
    return {
      status: 'ok',
      findings: data.findings as FindingForDisposition[],
    }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
}

type PostResult = { status: 'ok' } | { status: 'error'; reason: string }

async function postRuling(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<PostResult> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      status: 'error',
      reason: `could not reach Lumo API (${err instanceof Error ? err.message : 'network error'})`,
    }
  }
  if (res.status === 401) {
    return { status: 'error', reason: AUTH_INVALID_REASON }
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? ` — ${sanitizeField(errBody.error)}`
        : ''
    return { status: 'error', reason: `HTTP ${res.status}${detail}` }
  }
  return { status: 'ok' }
}
