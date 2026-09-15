import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { emitConfirmation } from '../lib/confirmation'
import { resolveBoundTask } from '../lib/bound-task'
import { dispositionUrl } from '../lib/open-crossings'
import { agentSessionRefusal, insideAgentSession } from '../lib/agent-env-guard'

export interface FindingDispositionOptions {
  falsePositive?: boolean
  acceptRisk?: boolean
  /** Bulk form: every finding the falsifier suggested as a false positive. */
  allSuggestedFp?: boolean
  note?: string
  task?: string
  /** Step 2: "the user confirmed they read the envelope" (never self-supplied). */
  confirmRead?: boolean
  /** Step 3: "the user approved the ruling" (never self-supplied). */
  confirm?: boolean
  /** Receipt from the previous step's envelope. */
  receipt?: string
}

export type FindingDispositionTarget = 'FALSE_POSITIVE' | 'ACCEPTED_RISK'

/** The slice of the finding view the envelope shows. */
export interface FindingForDisposition {
  id: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  prNumber: number
  disposition: string | null
  blocking: boolean
  persisting: boolean
  queueExit: string | null
  suggestedDisposition: string | null
  suggestedReason: string | null
}

/** One row of the bulk envelope, as the receipt route lists it. */
export interface SuggestedFindingRow {
  id: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  suggestedReason: string | null
}

const where = (f: { filePath: string; line: number | null }): string =>
  f.line == null ? f.filePath : `${f.filePath}:${f.line}`

/**
 * The changes[] block of the read envelope (step 1, exit 4) for one finding:
 * the ruling about to be recorded and everything the user needs to judge it —
 * severity, provenance, rule, location, title, the falsifier's suggestion
 * (labelled as an LLM suggestion), and the consequence for DONE.
 */
export function describeFindingDisposition(
  finding: FindingForDisposition,
  target: FindingDispositionTarget,
  ctx: { taskIdentifier: string; note?: string | undefined }
): string[] {
  const lines = [
    `Will disposition security finding ${sanitizeField(finding.id)} on ${ctx.taskIdentifier} as ${target}`,
    `Disposition: ${finding.disposition ?? 'OPEN'} → ${target}`,
    `[${finding.severity}] ${sanitizeField(finding.provenance)} ${sanitizeField(finding.ruleId)} — ${sanitizeField(where(finding))} (PR #${finding.prNumber})`,
    `Title: ${sanitizeField(finding.title).replace(/\s+/g, ' ').trim()}`,
  ]
  if (finding.suggestedDisposition) {
    const reason = finding.suggestedReason
      ? ` — ${sanitizeField(finding.suggestedReason).replace(/\s+/g, ' ').trim()}`
      : ''
    lines.push(
      `Suggested by the falsifier (LLM suggestion · unverified): ${finding.suggestedDisposition}${reason}`
    )
  } else {
    lines.push('Suggested by the falsifier: none')
  }
  if (ctx.note) lines.push(`Note to record: ${sanitizeField(ctx.note)}`)
  if (finding.blocking) {
    lines.push(
      `⚠ Approving clears this finding's block on moving ${ctx.taskIdentifier} to DONE`
    )
  } else {
    lines.push(
      finding.persisting
        ? 'Advisory finding — already on the default branch, it never blocked DONE; the ruling is for the record only'
        : finding.queueExit
          ? `Advisory finding — it left the queue (${sanitizeField(finding.queueExit)}) and no longer blocks DONE; the ruling is for the record only`
          : 'Advisory finding — it does not block DONE; the ruling is for the record only'
    )
  }
  if (finding.severity === 'HIGH') {
    lines.push(
      '⚠ HIGH severity — make sure the user has read the location and title above'
    )
  }
  if (target === 'ACCEPTED_RISK') {
    lines.push(
      '⚠ ACCEPTED_RISK records that the risk is real and knowingly carried — a note saying why is strongly recommended'
    )
  }
  return lines
}

/** The changes[] block of the bulk read envelope: every row the ruling touches. */
export function describeBulkDisposition(
  rows: SuggestedFindingRow[],
  ctx: { taskIdentifier: string }
): string[] {
  const lines = [
    `Will disposition ${rows.length} security finding${rows.length === 1 ? '' : 's'} on ${ctx.taskIdentifier} as FALSE_POSITIVE — every undispositioned row the falsifier suggested as a false positive, and nothing else`,
  ]
  for (const r of rows) {
    const reason = r.suggestedReason
      ? ` — ${sanitizeField(r.suggestedReason).replace(/\s+/g, ' ').trim()}`
      : ''
    lines.push(
      `  - ${sanitizeField(r.id)} [${r.severity}] ${sanitizeField(r.provenance)} ${sanitizeField(r.ruleId)} — ${sanitizeField(where(r))} — ${sanitizeField(r.title).replace(/\s+/g, ' ').trim()}${reason}`
    )
  }
  lines.push(
    `⚠ Approving clears every listed finding's block on moving ${ctx.taskIdentifier} to DONE (LLM suggestions · unverified — read each row)`
  )
  return lines
}

/** The changes[] block of the ruling envelope (step 2, exit 4). */
export function describeFindingRulingConfirmation(
  subject: string,
  target: FindingDispositionTarget,
  ctx: {
    taskIdentifier: string
    note?: string | undefined
    readAt: string
    readAcknowledgedAt: string
    blocking: boolean
  }
): string[] {
  const lines = [
    `Read acknowledged for ${subject} (shown ${ctx.readAt}, acknowledged ${ctx.readAcknowledgedAt}) — recorded with the ruling`,
    `Step 2 of 2 — record the ruling: OPEN → ${target} on ${ctx.taskIdentifier}`,
  ]
  if (ctx.note) lines.push(`Note to record: ${sanitizeField(ctx.note)}`)
  lines.push(
    ctx.blocking
      ? `⚠ Approving clears the block on moving ${ctx.taskIdentifier} to DONE`
      : 'Advisory — it does not block DONE; the ruling is for the record only'
  )
  return lines
}

/**
 * `lumo finding disposition <id> --false-positive | --accept-risk [--note …]
 * [--task LUM-N] [--receipt <token>] [--confirm-read | --confirm]` and the
 * bulk form `lumo finding disposition --all-suggested-fp --task LUM-N …` —
 * record the USER's ruling on a PR security finding from the terminal
 * (LUM-750), through the same three-step handshake the server enforces for
 * boundary crossings (LUM-769): read envelope + stage-1 receipt (exit 4,
 * nothing written) → `--confirm-read` + stage-2 receipt (exit 4, nothing
 * written) → `--confirm` writes. The bulk form binds the whole set of
 * suggested-false-positive rows: the envelope lists every row and the write
 * touches exactly those.
 *
 * Who runs it: the USER, in their own terminal. Inside an agent session the
 * command refuses before any request (an agent-issued run is recorded as a
 * SELF_DISPOSITION crossing and rolled back); outside one there is no session
 * binding, so `--task <LUM-N>` names the task.
 */
export async function findingDisposition(
  findingId: string | undefined,
  options: FindingDispositionOptions = {}
): Promise<number | void> {
  const bulk = Boolean(options.allSuggestedFp)
  if (insideAgentSession()) {
    console.error(
      agentSessionRefusal(
        bulk
          ? 'lumo finding disposition --all-suggested-fp'
          : `lumo finding disposition ${findingId?.trim() || '<id>'} --false-positive | --accept-risk`
      )
    )
    return 1
  }
  if (bulk && (options.falsePositive || options.acceptRisk)) {
    console.error(
      'Error: --all-suggested-fp is the whole ruling (FALSE_POSITIVE over every suggested row) — do not combine it with --false-positive / --accept-risk.'
    )
    return 1
  }
  if (bulk && findingId && findingId.trim() !== '') {
    console.error(
      'Error: --all-suggested-fp takes no finding id — it rules on every undispositioned finding the falsifier suggested as a false positive.'
    )
    return 1
  }
  if (!bulk && (!findingId || findingId.trim() === '')) {
    console.error(
      'Error: a finding id is required: lumo finding disposition <id> --false-positive | --accept-risk (ids are listed by `lumo task status`), or --all-suggested-fp for the bulk ruling.'
    )
    return 1
  }
  const target: FindingDispositionTarget | null = bulk
    ? 'FALSE_POSITIVE'
    : pickTarget(options)
  if (!target) {
    console.error(
      'Error: pass exactly one of --false-positive or --accept-risk (the ruling to record).'
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

  if (options.confirm) {
    if (!receipt) {
      console.error(
        'Error: --confirm requires the stage-2 read receipt (--receipt <token>) from the --confirm-read step. Run the command without any step flag first, read the envelope, confirm the read, then re-run the confirmCommand it prints.'
      )
      return 1
    }
    if (receipt.startsWith('r1.')) {
      console.error(
        'Error: read not yet acknowledged — this is the stage-1 receipt. Run the command with --confirm-read --receipt <this token> first; only the receipt that step returns is accepted with --confirm.'
      )
      return 1
    }
  }
  if (options.confirmRead) {
    if (!receipt) {
      console.error(
        'Error: --confirm-read requires the read receipt (--receipt <token>) from the envelope. Run the command without any step flag first.'
      )
      return 1
    }
    if (receipt.startsWith('r2.')) {
      console.error(
        'Error: this receipt already acknowledges the read — the next step is --confirm with this same receipt.'
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
  const bound = await resolveBoundTask({
    base,
    headers,
    explicit: options.task,
    sessionId: undefined,
  })
  if (!bound.ok) {
    console.error(bound.message)
    return 1
  }
  const taskId = bound.taskIdentifier
  const url = dispositionUrl(apiUrl, creds.workspaceSlug ?? '', taskId)

  if (bulk) {
    return bulkFlow({ base, headers, taskId, url, receipt, options })
  }

  // Read the finding first, on every path (fail closed: a read hiccup never
  // turns into a blind ruling).
  const read = await readFinding(base, headers, taskId, findingId as string)
  if (read.status === 'error') {
    console.error(
      `Error: could not confirm the finding (${read.reason}) — nothing was written.`
    )
    return 1
  }
  const finding = read.finding
  if (!finding) {
    console.error(
      `Error: finding ${sanitizeField(findingId as string)} not found on ${taskId}. Ids are listed by \`lumo task status ${taskId}\`.`
    )
    return 1
  }
  if (finding.disposition === target) {
    process.stdout.write(
      `Finding ${sanitizeField(finding.id)} is already ${target} — nothing to do.\n`
    )
    return
  }

  const receiptUrl = `${base}/api/tasks/${encodeURIComponent(taskId)}/security-findings/${encodeURIComponent(finding.id)}/disposition/receipt`

  // Step 1 — read envelope.
  if (!options.confirmRead && !options.confirm) {
    const issued = await requestReceipt(receiptUrl, headers, {
      disposition: target,
    })
    if (issued.status === 'error') {
      console.error(
        `Error: could not obtain a read receipt for the finding (${issued.reason}) — nothing was written and no envelope can be issued.`
      )
      return 1
    }
    return emitConfirmation({
      command: 'finding disposition',
      changes: [
        ...describeFindingDisposition(finding, target, {
          taskIdentifier: taskId,
          note,
        }),
        `Step 1 of 2 — read receipt issued for this finding as read above (valid until ${issued.expiresAt}; void if the finding changes). Next: confirm you have READ it, then run the command below; the ruling itself is confirmed in a second envelope`,
      ],
      confirmFlag: '--confirm-read',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  // Step 2 — acknowledge the read, ruling envelope.
  if (options.confirmRead) {
    const issued = await requestReceipt(receiptUrl, headers, {
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
      command: 'finding disposition',
      changes: describeFindingRulingConfirmation(
        `finding ${sanitizeField(finding.id)}`,
        target,
        {
          taskIdentifier: taskId,
          note,
          readAt: issued.readAt,
          readAcknowledgedAt: issued.readAcknowledgedAt ?? issued.readAt,
          blocking: finding.blocking,
        }
      ),
      confirmFlag: '--confirm',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  // Step 3 — the write.
  const posted = await postJson(
    `${base}/api/tasks/${encodeURIComponent(taskId)}/security-findings/${encodeURIComponent(finding.id)}/disposition/cli`,
    headers,
    { disposition: target, ...(note ? { note } : {}), receipt }
  )
  if (posted.status === 'error') {
    console.error(`Error: disposition rejected — ${posted.reason}`)
    return 1
  }
  const outcome = posted.body as { id?: string; disposition?: string | null }
  process.stdout.write(
    `✓ Dispositioned finding ${sanitizeField(outcome.id ?? finding.id)} as ${outcome.disposition ?? 'OPEN'} (read acknowledged and ruling approved via CLI).\n` +
      (finding.blocking
        ? `  This clears its block on moving ${taskId} to DONE. `
        : '  ') +
      `The ruling is audited on the task timeline as a CLI-channel disposition with the shown / read-acknowledged / confirmed times; it can be corrected in the web panel: ${url}\n`
  )
  return
}

async function bulkFlow(args: {
  base: string
  headers: Record<string, string>
  taskId: string
  url: string
  receipt: string | undefined
  options: FindingDispositionOptions
}): Promise<number | void> {
  const { base, headers, taskId, url, receipt, options } = args
  const receiptUrl = `${base}/api/tasks/${encodeURIComponent(taskId)}/security-findings/bulk-disposition/receipt`
  const note = options.note?.trim() || undefined

  if (!options.confirmRead && !options.confirm) {
    const issued = await requestReceipt(receiptUrl, headers, {})
    if (issued.status === 'error') {
      console.error(
        `Error: could not obtain a read receipt for the suggested findings (${issued.reason}) — nothing was written and no envelope can be issued.`
      )
      return 1
    }
    return emitConfirmation({
      command: 'finding disposition',
      changes: [
        ...describeBulkDisposition(issued.findings, { taskIdentifier: taskId }),
        ...(note ? [`Note to record: ${sanitizeField(note)}`] : []),
        `Step 1 of 2 — read receipt issued for exactly the ${issued.findings.length} row${issued.findings.length === 1 ? '' : 's'} listed above (valid until ${issued.expiresAt}; void if any row changes or the set changes). Next: confirm you have READ them, then run the command below; the ruling itself is confirmed in a second envelope`,
      ],
      confirmFlag: '--confirm-read',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  if (options.confirmRead) {
    const issued = await requestReceipt(receiptUrl, headers, {
      acknowledge: receipt as string,
    })
    if (issued.status === 'error') {
      console.error(
        `Error: read acknowledgement rejected (${issued.reason}) — nothing was written.`
      )
      return 1
    }
    return emitConfirmation({
      command: 'finding disposition',
      changes: describeFindingRulingConfirmation(
        `${issued.findings.length} suggested finding${issued.findings.length === 1 ? '' : 's'}`,
        'FALSE_POSITIVE',
        {
          taskIdentifier: taskId,
          note,
          readAt: issued.readAt,
          readAcknowledgedAt: issued.readAcknowledgedAt ?? issued.readAt,
          blocking: true,
        }
      ),
      confirmFlag: '--confirm',
      receipt: { token: issued.receipt, expiresAt: issued.expiresAt },
    })
  }

  const posted = await postJson(
    `${base}/api/tasks/${encodeURIComponent(taskId)}/security-findings/bulk-disposition/cli`,
    headers,
    { disposition: 'FALSE_POSITIVE', scope: 'SUGGESTED', receipt }
  )
  if (posted.status === 'error') {
    console.error(`Error: bulk disposition rejected — ${posted.reason}`)
    return 1
  }
  const outcome = posted.body as { confirmed?: number }
  const n = outcome.confirmed ?? 0
  process.stdout.write(
    `✓ Dispositioned ${n} suggested finding${n === 1 ? '' : 's'} on ${taskId} as FALSE_POSITIVE (read acknowledged and ruling approved via CLI).\n` +
      `  Each ruling is audited on the task timeline as a CLI-channel disposition; any can be corrected in the web panel: ${url}\n`
  )
  return
}

function pickTarget(
  options: FindingDispositionOptions
): FindingDispositionTarget | null {
  if (options.falsePositive && options.acceptRisk) return null
  if (options.falsePositive) return 'FALSE_POSITIVE'
  if (options.acceptRisk) return 'ACCEPTED_RISK'
  return null
}

type ReceiptResult =
  | {
      status: 'ok'
      receipt: string
      expiresAt: string
      readAt: string
      readAcknowledgedAt: string | null
      /** Bulk receipts list the rows they bind. */
      findings: SuggestedFindingRow[]
    }
  | { status: 'error'; reason: string }

async function requestReceipt(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): Promise<ReceiptResult> {
  const posted = await postJson(url, headers, body)
  if (posted.status === 'error') return posted
  const data = (posted.body ?? {}) as {
    receipt?: unknown
    expiresAt?: unknown
    readAt?: unknown
    readAcknowledgedAt?: unknown
    findings?: unknown
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
    findings: Array.isArray(data.findings)
      ? (data.findings as SuggestedFindingRow[])
      : [],
  }
}

type PostResult =
  | { status: 'ok'; body: unknown }
  | { status: 'error'; reason: string }

async function postJson(
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
    return {
      status: 'error',
      reason: 'API key invalid or revoked. Run `lumo auth login`.',
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
  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  return { status: 'ok', body: parsed }
}

type ReadResult =
  | { status: 'ok'; finding: FindingForDisposition | null }
  | { status: 'error'; reason: string }

/** One task-scoped read of the finding list; the finding picked by id. Fails
 *  closed: transport / non-ok / unparseable → error, never "not found". */
async function readFinding(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  findingId: string
): Promise<ReadResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/security-findings`,
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
  let data: { findings?: FindingForDisposition[] }
  try {
    data = (await res.json()) as { findings?: FindingForDisposition[] }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  const rows = Array.isArray(data.findings) ? data.findings : []
  return { status: 'ok', finding: rows.find(f => f.id === findingId) ?? null }
}
