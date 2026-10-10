import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { printStatusDigest } from '../lib/status-digest'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import {
  crossingLabel,
  crossingMatches,
  formatReceiptMap,
  isReceiptMap,
  parseReceiptMap,
  readCrossings,
  receiptFor,
  requestReceipt,
  type CrossingDispositionTarget,
  type CrossingForDisposition,
} from '../lib/crossing-handshake'
import {
  describeCrossingDisposition,
  describeRulingConfirmation,
} from './crossing-disposition'
import { resolveSessionId } from '../lib/session-id'

export interface BatchDispositionOptions {
  note?: string | undefined
  /** `<id>=<token>,…` from the previous step's envelope. */
  receipt?: string | undefined
  confirmRead: boolean
  confirm: boolean
  task?: string | undefined
}

/**
 * `lumo crossing disposition <id1> <id2> … --false-positive | --confirmed`
 * — the batch form of the LUM-769 handshake (LUM-845).
 *
 * Nothing about the red line moves: the server still issues, verifies and
 * voids one receipt per crossing, and each step still needs the user's
 * approval. What changes is the envelope count — one per step for the whole
 * batch instead of one per step per crossing, so N crossings take three
 * calls, not 3N. Each envelope lists every crossing as fully as the
 * single-crossing envelope does; the batch never trims what the user sees.
 *
 *   1. no step flag — read every crossing, obtain one stage-1 receipt each,
 *      print ONE read envelope whose confirmCommand carries all of them as
 *      `--receipt <id>=<r1>,<id>=<r1>… --confirm-read`;
 *   2. `--confirm-read` — acknowledge each read, print ONE ruling envelope
 *      carrying the stage-2 receipts and `--confirm`;
 *   3. `--confirm` — write each ruling, report each crossing's result on its
 *      own line, then the status digest once.
 *
 * The positional ids are the batch. To drop a disputed crossing between
 * steps, remove its id from the command: its receipt is then ignored and the
 * crossing stays OPEN. A crossing that already carries the requested ruling
 * is skipped and says so. At steps 1–2 any crossing that cannot be read or
 * receipted aborts the step (no envelope, per-id errors, nothing written);
 * at step 3 every crossing is attempted and a failure is reported, never
 * swallowed, with exit 1.
 */
export async function crossingDispositionBatch(
  ids: string[],
  target: CrossingDispositionTarget,
  options: BatchDispositionOptions
): Promise<number | void> {
  const { note } = options
  const step = options.confirm ? 3 : options.confirmRead ? 2 : 1

  // Local receipt checks, per id, before any request.
  let receipts = new Map<string, string>()
  if (step > 1) {
    const flag = step === 3 ? '--confirm' : '--confirm-read'
    const parsed =
      options.receipt && isReceiptMap(options.receipt)
        ? parseReceiptMap(options.receipt)
        : null
    if (!parsed) {
      console.error(
        `Error: ${flag} on a batch requires the receipts from the previous step's envelope (--receipt <id>=<token>,…). Run the command without any step flag first and relay the envelope.`
      )
      return 1
    }
    receipts = parsed
    const wrongStage: string[] = []
    for (const [id, token] of receipts) {
      if (!ids.includes(id)) continue
      if (step === 3 && token.startsWith('r1.')) wrongStage.push(id)
      if (step === 2 && token.startsWith('r2.')) wrongStage.push(id)
    }
    if (wrongStage.length > 0) {
      console.error(
        step === 3
          ? `Error: read not yet acknowledged for ${wrongStage.map(sanitizeField).join(', ')} — these are stage-1 receipts. Run --confirm-read with them first (after the user confirms they read the envelope); only the receipts that step returns are accepted with --confirm.`
          : `Error: these receipts already acknowledge the read (${wrongStage.map(sanitizeField).join(', ')}) — the next step is --confirm with the same receipts (after the user approves the ruling).`
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

  // One read for the whole batch, on every step (fail closed, as single).
  const read = await readCrossings(base, headers, taskId)
  if (read.status === 'error') {
    console.error(
      `Error: could not confirm the crossings (${read.reason}) — nothing was written.`
    )
    return 1
  }
  const missing = ids.filter(
    id => !read.crossings.some(c => crossingMatches(c, id))
  )
  if (missing.length > 0) {
    console.error(
      `Error: ${missing.length === 1 ? 'crossing' : 'crossings'} ${missing.map(sanitizeField).join(', ')} not found on ${taskId} — nothing was written. Ids are listed by \`lumo task status ${taskId}\`; drop the unknown ${missing.length === 1 ? 'id' : 'ids'} from the command.`
    )
    return 1
  }
  const batch: CrossingForDisposition[] = []
  const already: string[] = []
  for (const id of ids) {
    const c = read.crossings.find(x =>
      crossingMatches(x, id)
    ) as CrossingForDisposition
    // The same crossing named twice (ref and cuid) joins once.
    if (batch.some(b => b.id === c.id) || already.includes(crossingLabel(c)))
      continue
    if (c.disposition === target) already.push(crossingLabel(c))
    else batch.push(c)
  }
  const alreadyLine =
    already.length > 0
      ? `Skipped — already ${target}: ${already.map(sanitizeField).join(', ')}`
      : null
  if (batch.length === 0) {
    process.stdout.write(
      `All ${ids.length} crossings are already ${target} — nothing to do.\n`
    )
    return
  }
  if (step > 1) {
    const noReceipt = batch
      .filter(c => !receiptFor(receipts, c))
      .map(crossingLabel)
    if (noReceipt.length > 0) {
      console.error(
        `Error: --receipt carries no receipt for ${noReceipt.map(sanitizeField).join(', ')} — a crossing can only join a batch at the first step. Drop ${noReceipt.length === 1 ? 'it' : 'them'} from the command, or re-run without any step flag to start the handshake again. Nothing was written.`
      )
      return 1
    }
  }

  const total = batch.length
  const heading = (i: number, c: CrossingForDisposition) =>
    `── [${i + 1}/${total}] crossing ${sanitizeField(crossingLabel(c))} ──`

  if (step === 1 || step === 2) {
    const issued = new Map<string, string>()
    const expiries: string[] = []
    const errors: string[] = []
    const changes: string[] = [
      step === 1
        ? `Batch of ${total} crossings on ${taskId} — proposed ruling ${target} for each. Every crossing is listed in full below; to leave one OPEN, drop its id from the command before re-running it`
        : `Batch of ${total} crossings on ${taskId} — ruling ${target} for each`,
    ]
    for (const [i, c] of batch.entries()) {
      const res = await requestReceipt(base, headers, taskId, c.id, {
        disposition: target,
        ...(step === 2
          ? { acknowledge: receiptFor(receipts, c) as string }
          : {}),
      })
      if (res.status === 'error') {
        errors.push(`  ✗ ${sanitizeField(crossingLabel(c))} — ${res.reason}`)
        continue
      }
      issued.set(crossingLabel(c), res.receipt)
      if (res.expiresAt) expiries.push(res.expiresAt)
      changes.push(heading(i, c))
      changes.push(
        ...(step === 1
          ? describeCrossingDisposition(c, target, {
              taskIdentifier: taskId,
              note,
            })
          : describeRulingConfirmation(c, target, {
              taskIdentifier: taskId,
              note,
              readAt: res.readAt,
              readAcknowledgedAt: res.readAcknowledgedAt ?? res.readAt,
            }))
      )
    }
    if (errors.length > 0) {
      console.error(
        `Error: ${step === 1 ? 'could not obtain a read receipt' : 'read acknowledgement rejected'} for ${errors.length} of ${total} crossings — no envelope issued, nothing was written. Drop ${errors.length === 1 ? 'that id' : 'those ids'} or re-run once the cause is fixed:\n${errors.join('\n')}`
      )
      return 1
    }
    if (alreadyLine) changes.push(alreadyLine)
    const expiresAt = [...expiries].sort()[0] ?? ''
    changes.push(
      step === 1
        ? `Step 1 of 2 — read receipts issued for these ${total} crossings as read above (valid until ${expiresAt}; each one void if its crossing changes). Next: the user confirms they have READ them, then run the command below; the rulings themselves are confirmed in a second envelope`
        : `Step 2 of 2 — record the ${total} rulings above in one call (valid until ${expiresAt})`
    )
    return emitConfirmation({
      command: 'crossing disposition',
      changes,
      confirmFlag: step === 1 ? '--confirm-read' : '--confirm',
      receipt: { token: formatReceiptMap(issued), expiresAt },
    })
  }

  // Step 3 — write each ruling; every result is reported.
  const lines: string[] = []
  let failed = 0
  let clearedBlocks = 0
  for (const c of batch) {
    const result = await postRuling(base, headers, taskId, c.id, {
      disposition: target,
      ...(note ? { dispositionNote: note } : {}),
      receipt: receiptFor(receipts, c) as string,
    })
    if (result.ok) {
      if (!c.advisory) clearedBlocks++
      lines.push(
        `  ✓ ${sanitizeField(crossingLabel(c))} → ${result.disposition ?? 'OPEN'}${c.advisory ? ' (advisory — never blocked DONE)' : ''}`
      )
    } else {
      failed++
      lines.push(`  ✗ ${sanitizeField(crossingLabel(c))} — ${result.reason}`)
    }
  }
  const ignored = [...receipts.keys()].filter(
    key =>
      !ids.some(id => id === key) && !batch.some(c => crossingMatches(c, key))
  )
  const url = dispositionUrl(apiUrl, creds.workspaceSlug ?? '', taskId)
  process.stdout.write(
    `${failed === 0 ? '✓' : '✗'} Dispositioned ${total - failed} of ${total} crossings on ${taskId} as ${target} (read acknowledged and rulings approved via CLI):\n` +
      lines.join('\n') +
      '\n' +
      (alreadyLine ? `  ${alreadyLine}\n` : '') +
      (ignored.length > 0
        ? `  Dropped from the batch (left as they were): ${ignored.map(sanitizeField).join(', ')}\n`
        : '') +
      (clearedBlocks > 0
        ? `  This clears ${clearedBlocks === 1 ? 'its' : 'their'} block on moving ${taskId} to DONE. `
        : '  ') +
      `Each ruling is audited on the task timeline as a CLI-channel disposition; it can be corrected in the web panel: ${url}\n` +
      (failed > 0
        ? `  ${failed} ${failed === 1 ? 'ruling was' : 'rulings were'} not recorded — re-run the handshake for ${failed === 1 ? 'that id' : 'those ids'} (without any step flag).\n`
        : '')
  )
  // LUM-842: once for the whole batch — what still blocks DONE.
  await printStatusDigest(base, creds.token, taskId)
  return failed > 0 ? 1 : undefined
}

type PostResult =
  | { ok: true; disposition: string | null }
  | { ok: false; reason: string }

async function postRuling(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  crossingId: string,
  body: {
    disposition: CrossingDispositionTarget
    dispositionNote?: string
    receipt: string
  }
): Promise<PostResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/disposition`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `could not reach Lumo API (${msg})` }
  }
  if (res.status === 401) {
    return { ok: false, reason: 'API key invalid or revoked' }
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? ` — ${sanitizeField(errBody.error)}`
        : ''
    return { ok: false, reason: `rejected (HTTP ${res.status})${detail}` }
  }
  const outcome = (await res.json().catch(() => null)) as {
    disposition?: string | null
  } | null
  return { ok: true, disposition: outcome?.disposition ?? body.disposition }
}
