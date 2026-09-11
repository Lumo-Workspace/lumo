/**
 * Structured "blocked by a human-only gate" error (LUM-755).
 *
 * The confirmation protocol (confirmation.ts, exit 4) covers mutations the
 * USER can approve. Some refusals are different in kind: the server's DONE
 * gates — an unresolved send-back, an undispositioned boundary crossing, a
 * blocking security finding — are verdicts on the agent's own work, and by
 * design there is no CLI path to clear them (the interested party may not
 * adjudicate itself). Echoing the 409 text and exiting 1 left the agent
 * grepping prose to learn that. Instead the CLI now:
 *
 *   1. recognises the gate refusal (`isDoneGateRefusal`);
 *   2. re-reads the existing read models — `GET …/status` for send-backs and
 *      blocking findings, `GET …/boundary-crossings` for open crossings — and
 *      lists every blocker with its id;
 *   3. prints a `DONE_BLOCKED` error on stdout and exits 5
 *      (`EXIT_BLOCKED`), with remediation lines that only ever point at
 *      human-side or explain-only paths.
 *
 * A failed enrichment read is reported in `unconfirmed[]` rather than
 * silently showing fewer blockers — the same fail-closed stance as
 * `lumo task status`.
 */
import { fetchOpenCrossings, dispositionUrl } from './open-crossings'
import { sanitizeField } from './sanitize'

export const EXIT_BLOCKED = 5

const DONE_GATE_PREFIX = 'Cannot move this task to DONE'

export type DoneBlocker =
  | {
      kind: 'SEND_BACK'
      criterionId: string
      statement: string
      failedAtRound: number
      rejectionReason: string | null
    }
  | {
      kind: 'BOUNDARY_CROSSING'
      id: string
      severity: string
      category: string
      detail: string
    }
  | {
      kind: 'SECURITY_FINDING'
      findingId: string
      severity: string
      ruleId: string
      filePath: string
      line: number | null
      prNumber: number
      statement: string
    }

export interface BlockedError {
  status: 'blocked'
  code: 'DONE_BLOCKED'
  command: 'task update'
  task: string
  /** The server's 409 text, verbatim. */
  message: string
  blockers: DoneBlocker[]
  /** Enrichment reads that failed — "could not confirm", never "none". */
  unconfirmed: string[]
  remediation: string[]
  dispositionUrl: string
}

/** All three server DONE gates share this message prefix. */
export function isDoneGateRefusal(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith(DONE_GATE_PREFIX)
}

/** The slice of `GET /api/tasks/[id]/status` the blocker list needs. */
interface StatusSlice {
  criteria?: Array<{
    id: string
    statement: string
    latestVerdict: {
      round: number
      verdict: string
      rejectionReason: string | null
    } | null
  }>
  nextActions?: Array<
    | { kind?: 'CRITERION' }
    | {
        kind: 'SECURITY_FINDING'
        findingId: string
        statement: string
        severity: string
        blocking: boolean
        prNumber: number
        ruleId: string
        filePath: string
        line: number | null
      }
  >
}

export async function collectDoneBlockers(args: {
  base: string
  token: string
  identifier: string
}): Promise<{ blockers: DoneBlocker[]; unconfirmed: string[] }> {
  const { base, token, identifier } = args
  const blockers: DoneBlocker[] = []
  const unconfirmed: string[] = []
  const headers = { Authorization: `Bearer ${token}` }

  // Send-backs + blocking security findings: the acceptance-status read model.
  try {
    const res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/status`,
      { headers }
    )
    if (!res.ok) {
      unconfirmed.push(`task status read failed: HTTP ${res.status}`)
    } else {
      const data = (await res.json()) as StatusSlice
      for (const c of data.criteria ?? []) {
        if (c.latestVerdict?.verdict === 'FAIL') {
          blockers.push({
            kind: 'SEND_BACK',
            criterionId: c.id,
            statement: c.statement,
            failedAtRound: c.latestVerdict.round,
            rejectionReason: c.latestVerdict.rejectionReason,
          })
        }
      }
      for (const a of data.nextActions ?? []) {
        if (a.kind === 'SECURITY_FINDING' && a.blocking) {
          blockers.push({
            kind: 'SECURITY_FINDING',
            findingId: a.findingId,
            severity: a.severity,
            ruleId: a.ruleId,
            filePath: a.filePath,
            line: a.line,
            prNumber: a.prNumber,
            statement: a.statement,
          })
        }
      }
    }
  } catch (err) {
    unconfirmed.push(
      `task status read failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  // Open boundary crossings: the LUM-435 read model (fails closed, LUM-480).
  const crossings = await fetchOpenCrossings(base, token, identifier)
  if (crossings.status === 'error') {
    unconfirmed.push(`boundary-crossings read failed: ${crossings.reason}`)
  } else {
    for (const c of crossings.crossings) {
      blockers.push({
        kind: 'BOUNDARY_CROSSING',
        id: c.id,
        severity: c.severity,
        category: c.category,
        detail: c.detail,
      })
    }
  }

  return { blockers, unconfirmed }
}

/**
 * One line per blocker kind present. Every line names a human-side path or
 * the append-only `crossing explain` — never a flag or command that would let
 * the agent clear its own blocker.
 */
export function buildRemediation(
  blockers: DoneBlocker[],
  unconfirmed: string[],
  ctx: { identifier: string; dispositionUrl: string }
): string[] {
  const kinds = new Set(blockers.map(b => b.kind))
  const lines: string[] = []
  if (kinds.has('SEND_BACK')) {
    lines.push(
      `SEND_BACK: fix the failed criterion in place and re-run \`lumo verify ${ctx.identifier}\`; a human can also record a PASS in the web verdict bar. Do not reword or delete the criterion to make it pass.`
    )
  }
  if (kinds.has('BOUNDARY_CROSSING')) {
    const ids = blockers
      .filter(b => b.kind === 'BOUNDARY_CROSSING')
      .map(b => (b as { id: string }).id)
    lines.push(
      `BOUNDARY_CROSSING: leave a rationale with \`lumo crossing explain ${ids[0]} --note "…"\` (append-only; it does not clear anything). A human dispositions each crossing (false positive / confirmed) at ${ctx.dispositionUrl}`
    )
  }
  if (kinds.has('SECURITY_FINDING')) {
    lines.push(
      'SECURITY_FINDING: fix and push — a fixed fingerprint disappears from the next scan — or a human marks it false positive / accepted risk in the web delivery panel.'
    )
  }
  if (unconfirmed.length > 0) {
    lines.push(
      `Could not confirm the full blocker list (${unconfirmed.join('; ')}) — run \`lumo task status ${ctx.identifier}\` and check the task page before assuming the list above is complete.`
    )
  }
  return lines
}

export function buildBlockedError(args: {
  identifier: string
  message: string
  blockers: DoneBlocker[]
  unconfirmed: string[]
  apiUrl: string
  workspaceSlug: string
}): BlockedError {
  const url = dispositionUrl(args.apiUrl, args.workspaceSlug, args.identifier)
  return {
    status: 'blocked',
    code: 'DONE_BLOCKED',
    command: 'task update',
    task: args.identifier,
    message: args.message,
    blockers: args.blockers,
    unconfirmed: args.unconfirmed,
    remediation: buildRemediation(args.blockers, args.unconfirmed, {
      identifier: args.identifier,
      dispositionUrl: url,
    }),
    dispositionUrl: url,
  }
}

function blockerLine(b: DoneBlocker): string {
  switch (b.kind) {
    case 'SEND_BACK':
      return `SEND_BACK ${b.criterionId} (round ${b.failedAtRound}): ${b.statement}${b.rejectionReason ? ` — ${b.rejectionReason}` : ''}`
    case 'BOUNDARY_CROSSING':
      return `[${b.severity}] ${b.category} ${b.id}: ${b.detail}`
    case 'SECURITY_FINDING':
      return `[${b.severity}] ${b.ruleId} ${b.findingId} — ${b.filePath}${b.line != null ? `:${b.line}` : ''} (PR #${b.prNumber}): ${b.statement}`
  }
}

/** JSON for pipes; the same fields as readable text for a terminal. */
export function renderBlocked(err: BlockedError, isTTY: boolean): string {
  if (!isTTY) return JSON.stringify(err, null, 2) + '\n'
  const lines = [
    `DONE_BLOCKED — \`lumo task update ${err.task} --status done\` was refused by a human-only gate.`,
    ...err.message.split('\n').map(l => `  ${l}`),
    '',
    err.blockers.length > 0 ? 'Blockers:' : 'Blockers: (none listed)',
    ...err.blockers.map(b => `  • ${sanitizeField(blockerLine(b))}`),
    ...(err.unconfirmed.length > 0
      ? ['', ...err.unconfirmed.map(u => `  ⚠ ${u}`)]
      : []),
    '',
    'What can move it:',
    ...err.remediation.map(r => `  - ${r}`),
    `  Disposition (human-only): ${err.dispositionUrl}`,
  ]
  return lines.join('\n') + '\n'
}

/** Print the structured error to stdout and return exit code 5. */
export function emitBlocked(err: BlockedError): number {
  process.stdout.write(renderBlocked(err, Boolean(process.stdout.isTTY)))
  return EXIT_BLOCKED
}
