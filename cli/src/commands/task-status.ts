import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { sanitizeField } from '../lib/sanitize'

export interface TaskStatusOptions {
  /** Emit the versioned machine-readable payload instead of prose. */
  json?: boolean
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
    source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
    addedAtRound: number
    latestVerdict: {
      round: number
      verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
      evidencePointer: string | null
      rejectionReason: string | null
      rejectionReasonEnum: string | null
      recordedAt: string
    } | null
  }>
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
export function formatTaskStatus(data: TaskStatusResponse): string {
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
    return lines.join('\n') + '\n'
  }

  lines.push('')
  lines.push(
    `Criteria (${data.criteria.length} total, ${data.nextActions.length} unmet):`
  )
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
      lines.push(`      ✓ ${v.verdict}@r${v.round}${evidencePart}`)
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
  return lines.join('\n') + '\n'
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
    taskId =
      (await resolveBoundTaskIdentifier(base, creds.token)) ?? undefined
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
  if (options.json) {
    // JSON.stringify escapes control chars (…), so the payload is safe
    // to emit raw — and consumers get byte-faithful server data.
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    return
  }
  process.stdout.write(formatTaskStatus(data))
}
