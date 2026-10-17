import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printStatusDigest } from '../lib/status-digest'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import { resolveSessionId } from '../lib/session-id'
import { AUTH_INVALID_REASON, errNotLoggedIn } from '../lib/errors'
import {
  matchRef,
  refMatchError,
  shortRef,
} from '../../../shared/src/short-ref'

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
      `${oneLine(shortRef(f.id))} [${oneLine(f.severity)}] ${oneLine(f.title)} — ${oneLine(f.ruleId)} at ${oneLine(where(f))} (PR #${f.prNumber}, ${f.blocking ? 'blocks DONE' : 'advisory'}): ${f.disposition ?? 'OPEN'} → ${ruling}${note}`
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
  // LUM-1230: each arg is the 8-char short ref `task status` prints, a unique
  // id prefix (6+) or the full id. A miss or an ambiguous ref writes nothing.
  const picked = pickFindings(ids, read.findings)
  if (!picked.ok) {
    console.error(
      `Error: ${sanitizeField(picked.error)} on ${taskId} — nothing was written. Refs are listed by \`lumo task status ${taskId}\`.`
    )
    return 1
  }
  const selected = picked.findings
  const already = selected.filter(f => f.disposition === ruling)
  const todo = selected.filter(f => f.disposition !== ruling)
  const skipped = already.map(
    f =>
      `Finding ${sanitizeField(shortRef(f.id))} is already ${ruling} — skipped.`
  )
  if (todo.length === 0) {
    for (const line of skipped) process.stdout.write(`${line}\n`)
    return
  }

  const webUrl = dispositionUrl(
    apiUrl,
    creds.workspaceSlug ?? '',
    taskId
  ).replace(/#.*$/, '')

  if (!options.confirm) {
    // The skip notes ride inside the envelope: in non-TTY mode stdout must
    // be exactly one JSON document (LUM-1128 follow-up).
    return emitConfirmation({
      command: 'finding disposition',
      changes: [
        ...describeFindingRulings(todo, ruling, {
          taskIdentifier: taskId,
          note,
          webUrl,
        }),
        ...skipped,
      ],
    })
  }
  for (const line of skipped) process.stdout.write(`${line}\n`)

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
        `✗ ${sanitizeField(shortRef(f.id))}: disposition rejected — ${posted.reason}`
      )
      continue
    }
    process.stdout.write(
      `✓ ${sanitizeField(shortRef(f.id))} → ${ruling}${f.blocking ? ` (no longer blocks DONE on ${taskId})` : ''}\n`
    )
  }
  process.stdout.write(
    `Recorded as channel CLI on the task timeline (user-approved via the confirmation envelope); the web panel can correct it: ${webUrl}\n`
  )
  await printStatusDigest(base, creds.token, taskId)
  return failed > 0 ? 1 : undefined
}

/**
 * LUM-1230: resolve every typed ref against the task's findings. Pure. A
 * ref that matches nothing, is too short or matches several findings fails
 * the whole batch (listing the candidates) — never a silent pick. Two refs
 * naming the same finding select it once.
 */
export function pickFindings(
  refs: string[],
  findings: FindingForDisposition[]
):
  | { ok: true; findings: FindingForDisposition[] }
  | { ok: false; error: string } {
  const out: FindingForDisposition[] = []
  const errors: string[] = []
  for (const ref of refs) {
    const m = matchRef(ref, findings, f => f.id)
    if (m.kind === 'found') {
      if (!out.includes(m.item)) out.push(m.item)
      continue
    }
    errors.push(
      m.kind === 'not-found'
        ? `finding ${ref} not found`
        : refMatchError(
            'finding',
            ref,
            m,
            f => f.id,
            f => f.title
          )
    )
  }
  return errors.length > 0
    ? { ok: false, error: errors.join('; ') }
    : { ok: true, findings: out }
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
