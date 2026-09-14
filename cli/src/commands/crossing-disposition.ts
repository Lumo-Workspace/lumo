import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'

export interface CrossingDispositionOptions {
  falsePositive?: boolean
  confirmed?: boolean
  note?: string
  task?: string
  /** LUM-755 protocol: "the user has approved the envelope". Never
   *  self-supplied by an agent. */
  confirm?: boolean
  /** LUM-769 read receipt from the envelope step; required with --confirm. */
  receipt?: string
}

export type CrossingDispositionTarget = 'FALSE_POSITIVE' | 'CONFIRMED'

/** The slice of the LUM-435 crossing view the envelope shows. */
export interface CrossingForDisposition {
  id: string
  category: string
  severity: string
  detail: string
  occurrenceCount?: number
  reversible?: boolean
  advisory?: boolean
  disposition: string | null
  explanations?: Array<{ note: string; createdAt?: string }>
}

/**
 * The changes[] block of the disposition envelope (exit 4): what ruling is
 * about to be recorded, on which crossing, with everything the user needs to
 * judge it — severity, category, detail, recurrence, and the agent's own
 * explanations (labelled as an unverified self-report). The ⚠ lines carry
 * the consequence: approving clears this crossing's block on DONE.
 */
export function describeCrossingDisposition(
  crossing: CrossingForDisposition,
  target: CrossingDispositionTarget,
  ctx: { taskIdentifier: string; note?: string | undefined }
): string[] {
  const lines = [
    `Will disposition crossing ${sanitizeField(crossing.id)} on ${ctx.taskIdentifier} as ${target}`,
    `Disposition: ${crossing.disposition ?? 'OPEN'} → ${target}`,
  ]
  const detail = sanitizeField(crossing.detail).replace(/\s+/g, ' ').trim()
  lines.push(
    `[${crossing.severity}] ${sanitizeField(crossing.category)}${detail ? ` — ${detail}` : ''}`
  )
  if ((crossing.occurrenceCount ?? 1) > 1) {
    lines.push(`Seen ×${crossing.occurrenceCount} while open`)
  }
  const explanations = crossing.explanations ?? []
  if (explanations.length === 0) {
    lines.push('Agent explanations: none recorded')
  } else {
    lines.push(
      `Agent explanations (${explanations.length}, agent self-report · unverified):`
    )
    for (const e of explanations) {
      lines.push(`  - ${sanitizeField(e.note).replace(/\s+/g, ' ').trim()}`)
    }
  }
  if (ctx.note) lines.push(`Note to record: ${sanitizeField(ctx.note)}`)
  if (crossing.advisory) {
    lines.push(
      'Advisory crossing — it never blocked DONE; the ruling is for the record only'
    )
  } else {
    lines.push(
      `⚠ Approving clears this crossing's block on moving ${ctx.taskIdentifier} to DONE`
    )
  }
  if (crossing.severity === 'HIGH') {
    lines.push(
      '⚠ HIGH severity — this class always needs a human decision; make sure the user has read the detail above'
    )
  }
  if (crossing.reversible === false) {
    lines.push(
      '⚠ Irreversible category — the action reached outside the repo; a false-positive ruling should rest on the detail, not on the explanation alone'
    )
  }
  return lines
}

/**
 * `lumo crossing disposition <id> --false-positive | --confirmed [--note …]
 * [--task LUM-N] [--confirm]` — rule on a boundary crossing from the terminal
 * (LUM-769), through the LUM-755 confirmation protocol:
 *
 *   1. without --confirm: read the crossing, obtain a server-signed READ
 *      RECEIPT for it (bound to crossing, ruling, caller and the crossing's
 *      current state), print the envelope (exit 4), write nothing;
 *   2. the agent relays every `changes` line; the user approves in chat;
 *   3. with --confirm --receipt <token>: POST the ruling to the task-scoped
 *      CLI route, which verifies the receipt before writing.
 *
 * The receipt makes read-before-write a server-enforced handshake rather than
 * a convention: `--confirm` with no receipt is refused here before any
 * request, and a receipt that is forged, expired, for another caller/ruling,
 * or older than the crossing's latest change is refused by the server.
 * Server-side the ruling is stamped `channel: 'CLI'` so the audit trail keeps
 * it apart from a web-panel click. What stays web-only: reverting to OPEN and
 * the repository suppression rule — neither exists on this path.
 */
export async function crossingDisposition(
  crossingId: string | undefined,
  options: CrossingDispositionOptions = {}
): Promise<number | void> {
  if (!crossingId || crossingId.trim() === '') {
    console.error(
      'Error: a crossing id is required: lumo crossing disposition <id> --false-positive | --confirmed'
    )
    return 1
  }
  const target = pickTarget(options)
  if (!target) {
    console.error(
      'Error: pass exactly one of --false-positive or --confirmed (the ruling to record).'
    )
    return 1
  }
  const note = options.note?.trim() || undefined

  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.token}`,
  }
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID
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

  // Read the crossing first, on both paths: the envelope needs it, and a
  // confirmed write against a crossing that can't be read must not go out
  // (fail closed — a read hiccup never turns into a blind ruling).
  const read = await readCrossing(base, headers, taskId, crossingId)
  if (read.status === 'error') {
    console.error(
      `Error: could not confirm the crossing (${read.reason}) — nothing was written.`
    )
    return 1
  }
  const crossing = read.crossing
  if (!crossing) {
    console.error(
      `Error: crossing ${sanitizeField(crossingId)} not found on ${taskId}. Ids are listed by \`lumo task status ${taskId}\`.`
    )
    return 1
  }

  if (crossing.disposition === target) {
    process.stdout.write(
      `Crossing ${sanitizeField(crossing.id)} is already ${target} — nothing to do.\n`
    )
    return
  }

  if (!options.confirm) {
    const issued = await obtainReadReceipt(
      base,
      headers,
      taskId,
      crossingId,
      target
    )
    if (issued.status === 'error') {
      console.error(
        `Error: could not obtain a read receipt for the crossing (${issued.reason}) — nothing was written and no envelope can be issued.`
      )
      return 1
    }
    return emitConfirmation({
      command: 'crossing disposition',
      changes: [
        ...describeCrossingDisposition(crossing, target, {
          taskIdentifier: taskId,
          note,
        }),
        `Read receipt issued for this crossing as read above — valid until ${issued.expiresAt}; it is void if the crossing changes before the user rules`,
      ],
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  const receipt = options.receipt?.trim()
  if (!receipt) {
    console.error(
      'Error: --confirm requires the read receipt from the envelope (--receipt <token>). Run the command without --confirm first, relay the envelope to the user, then re-run its confirmCommand verbatim.'
    )
    return 1
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/disposition`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disposition: target,
          ...(note ? { dispositionNote: note } : {}),
          receipt,
        }),
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
      `Error: disposition rejected (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`
    )
    return 1
  }

  const outcome = (await res.json()) as {
    crossingId: string
    disposition: string | null
  }
  const url = dispositionUrl(apiUrl, creds.workspaceSlug ?? '', taskId)
  process.stdout.write(
    `✓ Dispositioned crossing ${sanitizeField(outcome.crossingId)} as ${outcome.disposition ?? 'OPEN'} (approval relayed via CLI).\n` +
      (crossing.advisory
        ? ''
        : `  This clears its block on moving ${taskId} to DONE. `) +
      `The ruling is audited on the task timeline as a CLI-channel disposition; it can be corrected in the web panel: ${url}\n`
  )
  return
}

function pickTarget(
  options: CrossingDispositionOptions
): CrossingDispositionTarget | null {
  if (options.falsePositive && options.confirmed) return null
  if (options.falsePositive) return 'FALSE_POSITIVE'
  if (options.confirmed) return 'CONFIRMED'
  return null
}

type ReceiptResult =
  | { status: 'ok'; receipt: string; expiresAt: string }
  | { status: 'error'; reason: string }

/** The read step's server call (LUM-769): sign the crossing as read, for this
 *  ruling and caller. Fails closed — without a receipt no envelope is issued,
 *  because its confirmCommand could never be accepted. */
async function obtainReadReceipt(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  crossingId: string,
  target: CrossingDispositionTarget
): Promise<ReceiptResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/disposition/receipt`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition: target }),
      }
    )
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
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
  let data: { receipt?: unknown; expiresAt?: unknown }
  try {
    data = (await res.json()) as { receipt?: unknown; expiresAt?: unknown }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  if (typeof data.receipt !== 'string' || data.receipt.length === 0) {
    return { status: 'error', reason: 'no receipt in response' }
  }
  return {
    status: 'ok',
    receipt: data.receipt,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
  }
}

type ReadResult =
  | { status: 'ok'; crossing: CrossingForDisposition | null }
  | { status: 'error'; reason: string }

/** One task-scoped read of the LUM-435 view; the crossing picked by id. Fails
 *  closed: transport / non-ok / unparseable → error, never "not found". */
async function readCrossing(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  crossingId: string
): Promise<ReadResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings`,
      { headers }
    )
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (res.status === 401) {
    return { status: 'error', reason: 'API key invalid or revoked' }
  }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  let data: { crossings?: CrossingForDisposition[] }
  try {
    data = (await res.json()) as { crossings?: CrossingForDisposition[] }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  const rows = Array.isArray(data.crossings) ? data.crossings : []
  return { status: 'ok', crossing: rows.find(c => c.id === crossingId) ?? null }
}
