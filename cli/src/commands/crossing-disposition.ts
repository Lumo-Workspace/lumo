import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import { agentSessionRefusal, insideAgentSession } from '../lib/agent-env-guard'

export interface CrossingDispositionOptions {
  falsePositive?: boolean
  confirmed?: boolean
  note?: string
  task?: string
  /** LUM-769 step 2: "the user confirmed they read the envelope". Never
   *  self-supplied by an agent. Takes the stage-1 receipt via --receipt. */
  confirmRead?: boolean
  /** LUM-755 protocol step 3: "the user approved the ruling". Never
   *  self-supplied by an agent. Takes the stage-2 receipt via --receipt. */
  confirm?: boolean
  /** LUM-769 read receipt from the previous step's envelope. */
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
 * The changes[] block of the read envelope (step 1, exit 4): what ruling is
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
 * The changes[] block of the ruling envelope (step 2, exit 4): the read is
 * acknowledged and recorded; what remains is the ruling itself.
 */
export function describeRulingConfirmation(
  crossing: CrossingForDisposition,
  target: CrossingDispositionTarget,
  ctx: {
    taskIdentifier: string
    note?: string | undefined
    readAt: string
    readAcknowledgedAt: string
  }
): string[] {
  const lines = [
    `Read acknowledged for crossing ${sanitizeField(crossing.id)} (shown ${ctx.readAt}, acknowledged ${ctx.readAcknowledgedAt}) — recorded with the ruling`,
    `Step 2 of 2 — record the ruling: ${crossing.disposition ?? 'OPEN'} → ${target} on ${ctx.taskIdentifier}`,
  ]
  if (ctx.note) lines.push(`Note to record: ${sanitizeField(ctx.note)}`)
  lines.push(
    crossing.advisory
      ? 'Advisory crossing — it never blocked DONE; the ruling is for the record only'
      : `⚠ Approving clears this crossing's block on moving ${ctx.taskIdentifier} to DONE`
  )
  return lines
}

/**
 * `lumo crossing disposition <id> --false-positive | --confirmed [--note …]
 * [--task LUM-N] [--receipt <token>] [--confirm-read | --confirm]` — rule on
 * a boundary crossing from the terminal (LUM-769), through a THREE-step
 * confirmation handshake the server enforces:
 *
 *   1. no step flag: read the crossing, obtain a stage-1 READ RECEIPT
 *      (bound to crossing, ruling, caller and the crossing's current state),
 *      print the read envelope (exit 4), write nothing. Its confirmCommand
 *      carries `--receipt <r1> --confirm-read`;
 *   2. `--confirm-read --receipt <r1>`: the user confirmed they read it. The
 *      server verifies r1 and issues the stage-2 receipt; the CLI prints the
 *      ruling envelope (exit 4), write nothing. Its confirmCommand carries
 *      `--receipt <r2> --confirm`;
 *   3. `--confirm --receipt <r2>`: the user approved the ruling. The server
 *      verifies r2 — a stage-1 receipt is refused with "confirm read first",
 *      as is anything forged, expired, foreign or stale — then writes, with
 *      the shown / acknowledged / confirmed timestamps on the audit row.
 *
 * Skipping or reordering a step is refused at the CLI before any request
 * where it can be told locally (no receipt, a stage-1 receipt with --confirm,
 * a stage-2 receipt with --confirm-read) and by the server otherwise.
 * Server-side the ruling is stamped `channel: 'CLI'` so the audit trail keeps
 * it apart from a web-panel click. What stays web-only: reverting to OPEN and
 * the repository suppression rule — neither exists on this path.
 *
 * LUM-750 — who runs it: the USER, in their own terminal. The handshake
 * cannot prove a human ticked each step when an agent relays them, so inside
 * an agent session (CLAUDE_CODE_SESSION_ID / CLAUDECODE set) the command
 * refuses before any request and tells the agent to hand the row to the
 * user. Outside a session there is no binding, so `--task <LUM-N>` names the
 * task. An agent-issued run that dodges the guard is recorded by the boundary
 * detector as a SELF_DISPOSITION crossing (HIGH) and its ruling rolled back.
 */
export async function crossingDisposition(
  crossingId: string | undefined,
  options: CrossingDispositionOptions = {}
): Promise<number | void> {
  if (insideAgentSession()) {
    console.error(
      agentSessionRefusal(
        `lumo crossing disposition ${crossingId?.trim() || '<id>'} --false-positive | --confirmed`
      )
    )
    return 1
  }
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
  if (options.confirmRead && options.confirm) {
    console.error(
      'Error: --confirm-read and --confirm are separate steps — run them one at a time, each from the envelope the previous step printed.'
    )
    return 1
  }
  const note = options.note?.trim() || undefined
  const receipt = options.receipt?.trim() || undefined

  // Local ordering checks — cheap, and they name the missing step before any
  // request goes out. The server re-checks all of them.
  if (options.confirm) {
    if (!receipt) {
      console.error(
        'Error: --confirm requires the stage-2 read receipt (--receipt <token>) from the --confirm-read step. Run the command without any step flag first, relay the envelope, confirm the read, relay that envelope, then re-run its confirmCommand verbatim.'
      )
      return 1
    }
    if (receipt.startsWith('r1.')) {
      console.error(
        'Error: read not yet acknowledged — this is the stage-1 receipt. Run the command with --confirm-read --receipt <this token> first (after the user confirms they read the envelope); only the receipt that step returns is accepted with --confirm.'
      )
      return 1
    }
  }
  if (options.confirmRead) {
    if (!receipt) {
      console.error(
        'Error: --confirm-read requires the read receipt (--receipt <token>) from the envelope. Run the command without any step flag first and relay the envelope.'
      )
      return 1
    }
    if (receipt.startsWith('r2.')) {
      console.error(
        'Error: this receipt already acknowledges the read — the next step is --confirm with this same receipt (after the user approves the ruling).'
      )
      return 1
    }
  }

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

  // Read the crossing first, on every path: the envelopes need it, and a
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

  // Step 1 — read envelope.
  if (!options.confirmRead && !options.confirm) {
    const issued = await requestReceipt(base, headers, taskId, crossingId, {
      disposition: target,
    })
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
        `Step 1 of 2 — read receipt issued for this crossing as read above (valid until ${issued.expiresAt}; void if the crossing changes). Next: the user confirms they have READ it, then run the command below; the ruling itself is confirmed in a second envelope`,
      ],
      confirmFlag: '--confirm-read',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  // Step 2 — acknowledge the read, get the stage-2 receipt, ruling envelope.
  if (options.confirmRead) {
    const issued = await requestReceipt(base, headers, taskId, crossingId, {
      disposition: target,
      acknowledge: receipt as string,
    })
    if (issued.status === 'error') {
      console.error(
        `Error: read acknowledgement rejected (${issued.reason}) — nothing was written.`
      )
      return 1
    }
    return emitConfirmation({
      command: 'crossing disposition',
      changes: describeRulingConfirmation(crossing, target, {
        taskIdentifier: taskId,
        note,
        readAt: issued.readAt,
        readAcknowledgedAt: issued.readAcknowledgedAt ?? issued.readAt,
      }),
      confirmFlag: '--confirm',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  // Step 3 — the write.
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
    `✓ Dispositioned crossing ${sanitizeField(outcome.crossingId)} as ${outcome.disposition ?? 'OPEN'} (read acknowledged and ruling approved via CLI).\n` +
      (crossing.advisory
        ? ''
        : `  This clears its block on moving ${taskId} to DONE. `) +
      `The ruling is audited on the task timeline as a CLI-channel disposition with the shown / read-acknowledged / confirmed times; it can be corrected in the web panel: ${url}\n`
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
  | {
      status: 'ok'
      receipt: string
      expiresAt: string
      readAt: string
      readAcknowledgedAt: string | null
    }
  | { status: 'error'; reason: string }

/** The handshake's server call (LUM-769): stage 1 without `acknowledge`,
 *  stage 2 with the stage-1 receipt in it. Fails closed — without a receipt
 *  no envelope is issued, because its confirmCommand could never be accepted. */
async function requestReceipt(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  crossingId: string,
  body: { disposition: CrossingDispositionTarget; acknowledge?: string }
): Promise<ReceiptResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/disposition/receipt`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
  let data: {
    receipt?: unknown
    expiresAt?: unknown
    readAt?: unknown
    readAcknowledgedAt?: unknown
  }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  if (typeof data.receipt !== 'string' || data.receipt.length === 0) {
    return { status: 'error', reason: 'no receipt in response' }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    status: 'ok',
    receipt: data.receipt,
    expiresAt: str(data.expiresAt),
    readAt: str(data.readAt),
    readAcknowledgedAt:
      typeof data.readAcknowledgedAt === 'string'
        ? data.readAcknowledgedAt
        : null,
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
