/**
 * Structured "blocked by a human-only gate" error (LUM-755).
 *
 * The confirmation protocol (confirmation.ts, exit 4) covers mutations the
 * USER can approve. Some refusals are different in kind: the server's DONE
 * gates — an undispositioned boundary crossing, a blocking security
 * finding — are verdicts on the agent's own work, and the
 * agent may not adjudicate itself: nothing on `task update` clears them.
 * Since LUM-769 a boundary crossing does have a terminal path, but it is the
 * USER's — `lumo crossing disposition` walks the same exit-4 protocol (the
 * agent relays the crossing, the user rules, the agent re-runs with the
 * approval flag); security findings are ruled through `lumo finding
 * disposition` (exit-4 envelope, LUM-1128) or the web panel.
 * Echoing the 409 text and exiting 1 left the agent grepping prose to learn
 * that. Instead the CLI now:
 *
 *   1. recognises the gate refusal (`isDoneGateRefusal`);
 *   2. re-reads the existing read models — `GET …/status` for blocking
 *      security findings and proven test-case defects (LUM-1229), `GET
 *      …/boundary-crossings` for open crossings — and lists every blocker
 *      with its id;
 *   3. prints a `DONE_BLOCKED` error on stdout and exits 5
 *      (`EXIT_BLOCKED`), with remediation lines that only ever point at
 *      human-side or explain-only paths.
 *
 * A failed enrichment read is reported in `unconfirmed[]` rather than
 * silently showing fewer blockers — the same fail-closed stance as
 * `lumo task status`.
 */
import {
  fetchOpenCrossings,
  dispositionUrl,
  testCasesUrl,
} from './open-crossings'
import { sanitizeField } from './sanitize'
import { shortRef } from '../../../shared/src/short-ref'

export const EXIT_BLOCKED = 5

const DONE_GATE_PREFIX = 'Cannot move this task to DONE'

export type DoneBlocker =
  | {
      kind: 'BOUNDARY_CROSSING'
      id: string
      /** LUM-1059: `<TEAM>-X<n>` (the cuid against an older server). */
      ref: string
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
  /**
   * LUM-1229: a test case whose latest run proved an implementation defect
   * and nobody has ruled on that run — the server gate's TEST_CASE_DEFECT
   * plane, read from the status model's `TEST_CASE_VERDICT` rows
   * (`blocking: true`), never from the 409 text.
   */
  | {
      kind: 'TEST_CASE_DEFECT'
      /** `<task>/TC<n>` — the handle `lumo task testcase disposition` takes. */
      ref: string
      number: number
      title: string
      /** The web Test cases section, where a human can rule on it. */
      url: string
    }

/** LUM-771: an open crossing the server DONE gate does NOT count (advisory,
 *  or below HIGH with the workspace gate off) — listed for awareness, never as
 *  a blocker the agent is told to get dispositioned. */
export interface NonBlockingCrossing {
  id: string
  /** LUM-1059: `<TEAM>-X<n>` (the cuid against an older server). */
  ref: string
  severity: string
  category: string
  detail: string
  advisory: boolean
}

export interface BlockedError {
  status: 'blocked'
  code: 'DONE_BLOCKED'
  command: 'task update'
  task: string
  /** The server's 409 text, verbatim. */
  message: string
  blockers: DoneBlocker[]
  /** LUM-771: open crossings that do not block DONE (see NonBlockingCrossing). */
  nonBlocking: NonBlockingCrossing[]
  /** Enrichment reads that failed — "could not confirm", never "none". */
  unconfirmed: string[]
  remediation: string[]
  dispositionUrl: string
  /** LUM-842: the `task status` digest — where the task stands right now.
   *  Additive; absent when the caller did not read it. */
  statusSummary?: string[]
}

/** All three server DONE gates share this message prefix. */
export function isDoneGateRefusal(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith(DONE_GATE_PREFIX)
}

/** The slice of `GET /api/tasks/[id]/status` the blocker list needs. */
interface StatusSlice {
  nextActions?: Array<
    | { kind: 'TEST_CASE' }
    | {
        kind: 'TEST_CASE_VERDICT'
        signal: string
        number: number
        title: string
        /** LUM-1186; absent on an older server. */
        blocking?: boolean
      }
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
  /** LUM-1229: for the per-blocker test-cases link. */
  apiUrl?: string
  workspaceSlug?: string
}): Promise<{
  blockers: DoneBlocker[]
  unconfirmed: string[]
  nonBlocking: NonBlockingCrossing[]
}> {
  const { base, token, identifier } = args
  const blockers: DoneBlocker[] = []
  const unconfirmed: string[] = []
  const nonBlocking: NonBlockingCrossing[] = []
  const headers = { Authorization: `Bearer ${token}` }

  // Blocking security findings: the task-status read model.
  try {
    const res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(identifier)}/status`,
      { headers }
    )
    if (!res.ok) {
      unconfirmed.push(`task status read failed: HTTP ${res.status}`)
    } else {
      const data = (await res.json()) as StatusSlice
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
        } else if (
          a.kind === 'TEST_CASE_VERDICT' &&
          a.signal === 'PROVEN_DEFECT'
        ) {
          // LUM-1229: the server says whether this row holds the gate
          // (same predicate as computeDoneVerdict). An older server sends no
          // `blocking` — then we cannot tell, and say so.
          if (a.blocking === true) {
            blockers.push({
              kind: 'TEST_CASE_DEFECT',
              ref: `${identifier}/TC${a.number}`,
              number: a.number,
              title: a.title,
              url: testCasesUrl(
                args.apiUrl ?? base,
                args.workspaceSlug ?? '',
                identifier
              ),
            })
          } else if (a.blocking === undefined) {
            unconfirmed.push(
              `TC${a.number}: the server did not say whether this proven defect blocks DONE`
            )
          }
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
    // LUM-771: mirror the server gate — an open row is a blocker only when
    // the gate counts it; the rest are surfaced separately, never as blockers.
    for (const c of crossings.crossings) {
      if (c.blocking) {
        blockers.push({
          kind: 'BOUNDARY_CROSSING',
          id: c.id,
          ref: c.ref,
          severity: c.severity,
          category: c.category,
          detail: c.detail,
        })
      } else {
        nonBlocking.push({
          id: c.id,
          ref: c.ref,
          severity: c.severity,
          category: c.category,
          detail: c.detail,
          advisory: c.advisory,
        })
      }
    }
  }

  return { blockers, unconfirmed, nonBlocking }
}

/**
 * One line per blocker kind present. Every line names a human-side path, the
 * append-only `crossing explain`, or the user-approved `crossing disposition`
 * (exit-4 protocol) — never a ready-to-run flag that would let the agent
 * clear its own blocker on its own initiative.
 */
export function buildRemediation(
  blockers: DoneBlocker[],
  unconfirmed: string[],
  ctx: { identifier: string; dispositionUrl: string }
): string[] {
  const kinds = new Set(blockers.map(b => b.kind))
  const lines: string[] = []
  if (kinds.has('BOUNDARY_CROSSING')) {
    const ids = blockers
      .filter(b => b.kind === 'BOUNDARY_CROSSING')
      .map(b => (b as { ref: string }).ref)
    lines.push(
      `BOUNDARY_CROSSING: leave a rationale with \`lumo crossing explain ${ids[0]} --task ${ctx.identifier} --note "…"\` (append-only; it does not clear anything), then relay each crossing to the user. Once they rule, record it with \`lumo crossing disposition ${ids[0]} --false-positive\` or \`--confirmed\` — it prints an exit-4 envelope for the user to approve; never self-approve. The web panel also works: ${ctx.dispositionUrl}`
    )
  }
  if (kinds.has('SECURITY_FINDING')) {
    const ids = blockers
      .filter(b => b.kind === 'SECURITY_FINDING')
      .map(b => shortRef((b as { findingId: string }).findingId))
    lines.push(
      `SECURITY_FINDING: fix and push — a fixed fingerprint disappears from the next scan — or relay the finding to the user and, once they rule, record it with \`lumo finding disposition ${ids.join(' ')} --false-positive\` or \`--accepted-risk\` — it prints an exit-4 envelope for the user to approve; never self-approve. The web panel also works: ${ctx.dispositionUrl}`
    )
  }
  if (kinds.has('TEST_CASE_DEFECT')) {
    const defects = blockers.filter(
      (b): b is Extract<DoneBlocker, { kind: 'TEST_CASE_DEFECT' }> =>
        b.kind === 'TEST_CASE_DEFECT'
    )
    const url = defects[0]!.url
    lines.push(
      `TEST_CASE_DEFECT: ${defects.map(d => d.ref).join(', ')} — the latest run proved an implementation defect and blocks DONE until the user rules on that run. The ruling is the user's, never the agent's: relay each case to the user and, once they rule, record it with \`lumo task testcase disposition ${defects[0]!.ref} --known-defect\` (ship anyway) or \`--not-a-defect\` — it prints exit-4 envelopes (a three-step handshake) for the user to approve step by step; never self-approve. Fixing the defect first is not required to clear this. The web panel also works: ${url}`
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
  nonBlocking?: NonBlockingCrossing[]
  apiUrl: string
  workspaceSlug: string
  statusSummary?: string[]
}): BlockedError {
  // LUM-1229: point at where the blocker lives. Only test-case defects →
  // the Test cases section; any crossing / security blocker (or an empty,
  // unconfirmed list) keeps the crossings panel — the plane the 409 text
  // names first. Each TEST_CASE_DEFECT blocker also carries its own `url`.
  const onlyTestCases =
    args.blockers.length > 0 &&
    args.blockers.every(b => b.kind === 'TEST_CASE_DEFECT')
  const url = onlyTestCases
    ? testCasesUrl(args.apiUrl, args.workspaceSlug, args.identifier)
    : dispositionUrl(args.apiUrl, args.workspaceSlug, args.identifier)
  return {
    status: 'blocked',
    code: 'DONE_BLOCKED',
    command: 'task update',
    task: args.identifier,
    message: args.message,
    blockers: args.blockers,
    nonBlocking: args.nonBlocking ?? [],
    unconfirmed: args.unconfirmed,
    remediation: buildRemediation(args.blockers, args.unconfirmed, {
      identifier: args.identifier,
      dispositionUrl: url,
    }),
    dispositionUrl: url,
    ...(args.statusSummary ? { statusSummary: args.statusSummary } : {}),
  }
}

function blockerLine(b: DoneBlocker): string {
  switch (b.kind) {
    case 'BOUNDARY_CROSSING':
      return `[${b.severity}] ${b.category} ${b.ref}: ${b.detail}`
    case 'SECURITY_FINDING':
      return `[${b.severity}] ${b.ruleId} ${shortRef(b.findingId)} — ${b.filePath}${b.line != null ? `:${b.line}` : ''} (PR #${b.prNumber}): ${b.statement}`
    case 'TEST_CASE_DEFECT':
      return `[TEST CASE] ${b.ref} ${b.title} — implementation defect, with evidence (blocks DONE until the user rules on it)`
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
    ...(err.nonBlocking.length > 0
      ? [
          '',
          'Also open, not blocking DONE (advisory / below the workspace gate):',
          ...err.nonBlocking.map(
            c =>
              `  ◦ [${c.severity}${c.advisory ? ' advisory' : ''}] ${sanitizeField(c.category)} ${sanitizeField(c.ref)}: ${sanitizeField(c.detail)}`
          ),
        ]
      : []),
    ...(err.unconfirmed.length > 0
      ? ['', ...err.unconfirmed.map(u => `  ⚠ ${u}`)]
      : []),
    '',
    'What can move it:',
    ...err.remediation.map(r => `  - ${r}`),
    `  Web disposition panel: ${err.dispositionUrl}`,
    ...(err.statusSummary ? ['', ...err.statusSummary] : []),
  ]
  return lines.join('\n') + '\n'
}

/** Print the structured error to stdout and return exit code 5. */
export function emitBlocked(err: BlockedError): number {
  process.stdout.write(renderBlocked(err, Boolean(process.stdout.isTTY)))
  return EXIT_BLOCKED
}
