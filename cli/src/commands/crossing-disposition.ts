import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printStatusDigest } from '../lib/status-digest'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import {
  isReceiptMap,
  parseReceiptMap,
  readCrossings,
  requestReceipt,
  type CrossingDispositionTarget,
  type CrossingForDisposition,
} from '../lib/crossing-handshake'
import { crossingDispositionBatch } from './crossing-disposition-batch'
import { resolveSessionId } from '../lib/session-id'

export type { CrossingDispositionTarget, CrossingForDisposition }

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
 * a stage-2 receipt with --confirm-read) and by the server otherwise. The
 * agent relays each envelope and never supplies a step flag on its own.
 * Server-side the ruling is stamped `channel: 'CLI'` so the audit trail keeps
 * it apart from a web-panel click. Several ids take the batch path
 * (`crossing-disposition-batch.ts`, LUM-845): the same three steps, one
 * envelope per step for the whole batch. What stays web-only: reverting to OPEN and
 * the repository suppression rule — neither exists on this path.
 */
export async function crossingDisposition(
  crossingIds: string | string[] | undefined,
  options: CrossingDispositionOptions = {}
): Promise<number | void> {
  const ids = normalizeIds(crossingIds)
  if (ids.length === 0) {
    console.error(
      'Error: a crossing id is required: lumo crossing disposition <id...> --false-positive | --confirmed'
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
  const rawReceipt = options.receipt?.trim() || undefined

  // LUM-845: several ids → the batch handshake, one envelope per step for
  // the whole batch. It runs its own local receipt checks (one per id).
  if (ids.length > 1) {
    return crossingDispositionBatch(ids, target, {
      note,
      receipt: rawReceipt,
      confirmRead: Boolean(options.confirmRead),
      confirm: Boolean(options.confirm),
      task: options.task,
    })
  }
  const crossingId = ids[0] as string

  // A batch the user narrowed to one id still carries its receipts in the
  // `<id>=<token>` form — take this crossing's token out of it.
  let receipt = rawReceipt
  if (rawReceipt && isReceiptMap(rawReceipt)) {
    const token = parseReceiptMap(rawReceipt)?.get(crossingId)
    if (!token) {
      console.error(
        `Error: --receipt carries no receipt for crossing ${sanitizeField(crossingId)} — re-run the command without any step flag to start the handshake again.`
      )
      return 1
    }
    receipt = token
  }

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

  // Read the crossing first, on every path: the envelopes need it, and a
  // confirmed write against a crossing that can't be read must not go out
  // (fail closed — a read hiccup never turns into a blind ruling).
  const read = await readCrossings(base, headers, taskId)
  if (read.status === 'error') {
    console.error(
      `Error: could not confirm the crossing (${read.reason}) — nothing was written.`
    )
    return 1
  }
  const crossing = read.crossings.find(c => c.id === crossingId)
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
  // LUM-842: the ruling moved what blocks DONE — show where the task stands.
  await printStatusDigest(base, creds.token, taskId)
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

/** Positional ids, trimmed, empties and repeats dropped, order kept. */
function normalizeIds(input: string | string[] | undefined): string[] {
  const raw = Array.isArray(input) ? input : input ? [input] : []
  const out: string[] = []
  for (const id of raw.map(r => r.trim())) {
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
