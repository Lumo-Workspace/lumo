import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'
import {
  fetchOpenCrossings,
  dispositionUrl,
  type OpenCrossingsResult,
  type CrossingAttribution,
} from '../lib/open-crossings'

export interface TaskStatusOptions {
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean
}

/** Extra render inputs layered onto the status read model (LUM-448): the task's
 *  OPEN boundary-crossings read result + the human-only web disposition link.
 *  The result carries an explicit failure state (LUM-480) so a failed check
 *  renders a warning instead of an implicitly-safe empty block. Absent
 *  (`undefined`) means no read was attempted — e.g. a direct `formatTaskStatus`
 *  call in a unit test — and the block is skipped entirely. */
export interface TaskStatusExtras {
  openCrossings?: OpenCrossingsResult
  dispositionUrl?: string
}

/** One-line a possibly-multiline crossing detail and cap it so the safety block
 *  stays a glance, never a wall (it must not overshadow the criteria). */
const CROSSING_DETAIL_CAP = 160
function oneLineDetail(detail: string): string {
  const firstLine = detail.split('\n')[0] ?? ''
  const clean = sanitizeField(firstLine).trim()
  return clean.length > CROSSING_DETAIL_CAP
    ? `${clean.slice(0, CROSSING_DETAIL_CAP)}…`
    : clean
}

/** Mirrors TaskAcceptanceStatus served by GET /api/tasks/[id]/status (v1). */
export interface TaskStatusResponse {
  version: number
  task: { id: string; identifier: string; title: string; status: string }
  currentRound: number
  maxRounds: number
  escalated: boolean
  criteria: Array<{
    id: string
    statement: string
    verifierType: 'MACHINE' | 'HUMAN'
    checkpointer: string | null
    evidenceRequired: boolean
    /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465). */
    judgeSteps: string | null
    source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
    addedAtRound: number
    /** The latest verdict predates the criterion's last edit (LUM-457). */
    verdictStale: boolean
    /** A MACHINE pass whose evidence ran a different command than the current
     *  checkpointer (LUM-457). */
    checkMismatch: boolean
    /** Whether a checkpointer currently vouches for this criterion — true only
     *  for a MACHINE criterion whose latest MACHINE-authored verdict is a PASS
     *  (LUM-456). A passing MACHINE criterion with this false is carried by a
     *  human override, never a machine run; HUMAN criteria are always false.
     *  Read from the server read model so the CLI matches web — never inferred
     *  from latestVerdict alone (LUM-470). */
    machinePassed: boolean
    latestVerdict: {
      round: number
      verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
      evidencePointer: string | null
      rejectionReason: string | null
      rejectionReasonEnum: string | null
      recordedAt: string
    } | null
  }>
  /** Honest machine-verification rollup over the active MACHINE criteria
   *  (LUM-456): genuine checkpointer passes vs human overrides. Mirrored from
   *  the server read model so the terminal rollup never reads as all-human when
   *  criteria were machine-verified (LUM-470). */
  machineVerification: {
    total: number
    machineVerified: number
    humanOverridden: number
  }
  verificationHistory: Array<{
    round: number
    recordedAt: string
    passed: number
    failed: number
  }>
  lastRoundFailures: Array<{
    criterionId: string
    statement: string
    rejectionReason: string | null
    rejectionReasonEnum: string | null
  }>
  nextActions: Array<{
    criterionId: string
    statement: string
    verifierType: 'MACHINE' | 'HUMAN'
    checkpointer: string | null
    judgeSteps: string | null
    source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
    addedAtRound: number
    rejectionReason: string | null
  }>
}

const REASON_TAIL = 400

function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(-max)}` : s
}

/**
 * Render the acceptance status as prose. Same row grammar as
 * `criteria list` (`<id>  [TYPE]  SOURCE@rN  statement`) with a verdict
 * glyph in front — ✓ pass, ✗ fail, ○ no verdict yet — so REVIEW_ADDED
 * provenance stays explicitly visible in every row.
 */
export function formatTaskStatus(
  data: TaskStatusResponse,
  extras: TaskStatusExtras = {}
): string {
  const lines: string[] = []
  const t = data.task
  lines.push(`${t.identifier}  ${sanitizeField(t.title)}`)
  const roundLabel =
    data.currentRound === 0
      ? 'no verification rounds yet'
      : `verification round ${data.currentRound}/${data.maxRounds}`
  lines.push(`Status: ${t.status} · ${roundLabel}`)
  if (data.escalated) {
    lines.push(
      '⚠ Escalated: the machine loop is exhausted — a human has been paged. Stop retrying lumo verify.'
    )
  }

  if (data.criteria.length === 0) {
    lines.push('')
    lines.push(
      `No acceptance criteria on ${t.identifier} — draft 3–7 and submit with lumo task criteria set ${t.identifier} --file <criteria.json>`
    )
    pushOpenCrossings(lines, extras)
    return lines.join('\n') + '\n'
  }

  lines.push('')
  lines.push(
    `Criteria (${data.criteria.length} total, ${data.nextActions.length} unmet):`
  )
  // LUM-470: honest machine-verification rollup over the active MACHINE criteria
  // (same read model as web, LUM-456) — so the terminal rollup never reads as
  // all-human when a checkpointer actually verified the work.
  const mv = data.machineVerification
  if (mv.total > 0) {
    lines.push(
      `Machine verification: ${mv.machineVerified} machine-verified / ${mv.humanOverridden} human override (of ${mv.total} MACHINE criteria)`
    )
  }
  for (const c of data.criteria) {
    const glyph =
      c.latestVerdict == null
        ? '○'
        : c.latestVerdict.verdict === 'FAIL'
          ? '✗'
          : '✓'
    const provenance = `${c.source}@r${c.addedAtRound}`
    const evidence = c.evidenceRequired ? '  [evidence]' : ''
    lines.push(
      `  ${glyph} ${c.id}  [${c.verifierType}]  ${provenance}${evidence}  ${sanitizeField(c.statement)}`
    )
    if (c.checkpointer) {
      lines.push(`      ↳ check: ${sanitizeField(c.checkpointer)}`)
    }
    // LUM-465: agent-drafted human-judging guidance, rendered as an indented
    // block under a HUMAN criterion (multi-line steps stay aligned).
    if (c.judgeSteps) {
      const judgeLines = sanitizeField(c.judgeSteps).split('\n')
      lines.push(`      ↳ judge: ${judgeLines[0]}`)
      for (const jl of judgeLines.slice(1)) {
        lines.push(`              ${jl}`)
      }
    }
    const v = c.latestVerdict
    if (v == null) {
      lines.push('      (no verdict yet)')
    } else if (v.verdict === 'FAIL') {
      const why = v.rejectionReason
        ? ` — ${sanitizeField(tail(v.rejectionReason, REASON_TAIL))}`
        : ''
      lines.push(`      ✗ FAIL@r${v.round}${why}`)
    } else {
      const evidencePart = v.evidencePointer
        ? ` · ${sanitizeField(v.evidencePointer)}`
        : ''
      // LUM-470: tag a passing MACHINE criterion by the read model's
      // machinePassed flag, not the latest verdict — a criterion a checkpointer
      // verified reads as machine-verified even after a human signs off, and a
      // pass with no machine run underneath reads as a human override.
      const machineTag =
        c.verifierType === 'MACHINE'
          ? c.machinePassed
            ? ' · machine-verified'
            : ' · human override (no machine pass)'
          : ''
      lines.push(`      ✓ ${v.verdict}@r${v.round}${evidencePart}${machineTag}`)
      // LUM-457: a pass that vouches for a pre-edit version of the criterion —
      // render-only downgrade, the criterion still counts met.
      if (c.verdictStale || c.checkMismatch) {
        lines.push(
          '      ⚠ pre-edit version — criterion changed since this check; re-run `lumo verify` to re-confirm'
        )
      }
    }
  }

  if (data.verificationHistory.length > 0) {
    lines.push('')
    lines.push('History:')
    for (const h of data.verificationHistory) {
      lines.push(
        `  r${h.round} · ${h.recordedAt} · ${h.passed} PASS / ${h.failed} FAIL`
      )
    }
  }

  if (data.lastRoundFailures.length > 0) {
    lines.push('')
    lines.push(`Last round (r${data.currentRound}) failures:`)
    for (const f of data.lastRoundFailures) {
      lines.push(`  • ${sanitizeField(f.statement)}`)
      if (f.rejectionReason) {
        lines.push(
          `    why: ${sanitizeField(tail(f.rejectionReason, REASON_TAIL))}`
        )
      }
    }
  }

  lines.push('')
  if (data.nextActions.length === 0) {
    lines.push(
      data.currentRound > 0
        ? 'All criteria met by their latest verdicts — awaiting human adjudication.'
        : 'Nothing unmet — but no verification has run; run `lumo verify` to judge the contract.'
    )
  } else {
    lines.push(`Next actions (${data.nextActions.length} unmet):`)
    for (const a of data.nextActions) {
      lines.push(`  • [${a.verifierType}] ${sanitizeField(a.statement)}`)
      if (a.checkpointer) {
        lines.push(`    check: ${sanitizeField(a.checkpointer)}`)
      }
      if (a.rejectionReason) {
        lines.push(
          `    why: ${sanitizeField(tail(a.rejectionReason, REASON_TAIL))}`
        )
      }
    }
    if (data.escalated) {
      lines.push('Wait for human direction before touching these.')
    } else {
      const hasMachine = data.nextActions.some(
        a => a.verifierType === 'MACHINE'
      )
      const left = data.maxRounds - data.currentRound
      lines.push(
        hasMachine
          ? `Fix the unmet criteria, then run \`lumo verify\` (${left} round${left === 1 ? '' : 's'} left).`
          : 'Remaining criteria are HUMAN-only — finish the work and hand off for human review.'
      )
    }
  }

  pushOpenCrossings(lines, extras)
  return lines.join('\n') + '\n'
}

/**
 * Append the OPEN boundary-crossings safety block (LUM-448) — a count, one line
 * per crossing with its severity + category + clipped detail, and a pointer to
 * the human-only web disposition panel. Trailing (after the criteria) and
 * silent when there are none, so it never overshadows the acceptance contract.
 * Read-only awareness: the line points at the web UI; it offers no way to clear
 * a crossing from the terminal (LUM-426/435/422).
 */
function pushOpenCrossings(lines: string[], extras: TaskStatusExtras): void {
  const result = extras.openCrossings
  if (!result) return
  // LUM-480: a failed check is NOT "0 open / safe" — say so explicitly rather
  // than rendering an empty (implicitly-clear) block.
  if (result.status === 'error') {
    lines.push('')
    lines.push(
      '⚠ Boundary-crossing check failed (network/server error) — could not confirm whether any are undispositioned.'
    )
    return
  }
  const open = result.crossings
  if (open.length === 0) return
  lines.push('')
  lines.push(`⚠ Open boundary crossings (${open.length} undispositioned):`)
  for (const c of open) {
    const detail = oneLineDetail(c.detail)
    const tail = detail ? ` — ${detail}` : ''
    lines.push(`  • [${c.severity}] ${sanitizeField(c.category)}${tail}`)
    lines.push(`    ${formatAttribution(c.attribution)}`)
  }
  lines.push('  Disposition is human-only in the web acceptance panel:')
  if (extras.dispositionUrl) {
    lines.push(`    ${extras.dispositionUrl}`)
  }
}

/**
 * Compact attribution line for an open crossing (LUM-469): which model + which
 * agent/session committed it, so a reviewer can audit who/what crossed from the
 * terminal. Every dimension that the server couldn't resolve renders `unknown`
 * — never a fabricated value. The session UUID is clipped to a correlatable
 * prefix; the worktree branch (which branch) is appended to the agent when known.
 */
function formatAttribution(a: CrossingAttribution): string {
  const agent = a.agent
    ? a.worktreeBranch
      ? `${a.agent}/${a.worktreeBranch}`
      : a.agent
    : 'unknown'
  const session = a.sessionId ? a.sessionId.slice(0, 8) : 'unknown'
  return `↳ by model=${a.model ?? 'unknown'} · agent=${agent} · session=${session}`
}

/**
 * `lumo task status [task] [--json]` — the agent's read-only self-check
 * (LUM-344): contract + latest verdicts + verification history + next
 * actions, straight from the server's derived read model. Run it first when
 * resuming a task in a new session or after a round was rejected. Defaults
 * to the session-bound task; an explicit identifier overrides.
 */
export async function taskStatus(
  identifier: string | undefined,
  options: TaskStatusOptions = {}
): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.error('Error: not logged in. Run `lumo auth login` first.')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))

  let taskId = identifier
  if (!taskId) {
    taskId = (await resolveBoundTaskIdentifier(base, creds.token)) ?? undefined
    if (!taskId) {
      console.error(
        'Error: no task given and this session is not bound to one.\n' +
          'Run `lumo task status <LUM-N>`, or bind first with `lumo session attach <LUM-N>`.'
      )
      return 1
    }
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/status`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
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
  if (res.status === 404) {
    console.error(
      `Error: task ${taskId} not found in workspace ${creds.workspaceSlug}`
    )
    return 1
  }
  if (!res.ok) {
    console.error(`Error: task status failed (HTTP ${res.status})`)
    return 1
  }

  const data = (await res.json()) as TaskStatusResponse

  // Read-only awareness (LUM-448): surface the task's OPEN boundary crossings
  // via the existing LUM-435 endpoint. fetchOpenCrossings returns a result that
  // distinguishes a check FAILURE from a genuine 0-open read (LUM-480), so this
  // supplementary safety signal never masquerades a hiccup as "all clear" — yet
  // it still never throws, so it can't block the primary acceptance status. The
  // resolved taskId (the identifier the status was fetched for) is the key here.
  const crossingsResult = await fetchOpenCrossings(base, creds.token, taskId)

  if (options.json) {
    // JSON.stringify escapes control chars (…), so the payload is safe
    // to emit raw — and consumers get byte-faithful server data.
    // openCrossings rides alongside as an additive field: an array on success
    // (count = length), or `null` when the check failed (LUM-480) — distinct
    // from `[]`, which is a successful read with zero open crossings.
    const openCrossings =
      crossingsResult.status === 'ok' ? crossingsResult.crossings : null
    process.stdout.write(
      JSON.stringify({ ...data, openCrossings }, null, 2) + '\n'
    )
    return
  }
  process.stdout.write(
    formatTaskStatus(data, {
      openCrossings: crossingsResult,
      dispositionUrl: dispositionUrl(
        base,
        creds.workspaceSlug ?? 'lumo',
        data.task.identifier
      ),
    })
  )
}
