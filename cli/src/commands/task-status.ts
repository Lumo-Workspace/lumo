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
import {
  formatEvidenceDrilldown,
  resolveRepoWebUrl,
} from '../lib/evidence-display'

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
  /** The repo's https web base (e.g. https://github.com/owner/repo), resolved
   *  from the local git remote, used to turn a `commit:` evidence pointer into a
   *  navigable URL (LUM-563). Null/absent → the `git show <hash>` fallback. */
  repoWebUrl?: string | null
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
    /** LUM-511 Phase 5: send-back lifecycle for this criterion (null = never
     *  sent back). */
    sendBackResolution?: {
      status: 'open' | 'resolved'
      failedAtRound: number
      resolvedAtRound?: number
      closingPrNumber?: number
      closingPrUrl?: string
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
  /** LUM-560: honest cost read-out — token / active time (non-idle, LUM-487) /
   *  rework rounds, read from the same server-side loadActuals source as the web
   *  delivery card so the two never drift. tokenCost null = NOT measured (≠ a
   *  measured 0). Optional so a new CLI tolerates an older server. */
  cost?: {
    tokenCost: number | null
    activeTimeSec: number
    reworkRounds: number
  }
  /** LUM-561: rework / send-back / leftover-follow-up traces, preserved even on
   *  a clean all-pass task so the report never wipes the struggle. Optional so a
   *  new CLI tolerates an older server that doesn't yet emit it. */
  struggleTrail?: {
    reworkRounds: Array<{ round: number; failed: number }>
    sendBacks: Array<{
      criterionId: string
      statement: string
      status: 'open' | 'resolved'
      failedAtRound: number
      resolvedAtRound: number | null
    }>
    followUps: Array<{ criterionId: string; statement: string; round: number }>
    pullRequests: Array<{ number: number; url: string }>
    reopens: Array<{ from: string; to: string; at: string }>
  }
  /** LUM-562: movement of pass rate / cost / rework across the task's attempts
   *  — the trend the single-point History/Cost snapshot hides. Optional so a new
   *  CLI tolerates an older server that doesn't yet emit it. */
  trend?: {
    passRate: Array<{ round: number; passed: number; failed: number }>
    cost: Array<{
      sessionId: string
      total: number
      loopCount: number
      at: string
    }>
    rework: {
      reworkRounds: number
      reopens: number
      extraPrCycles: number
      total: number
    }
  }
  /** LUM-564: the agent's CLAIM — what it SAYS it did — surfaced beside the
   *  measured verification conclusion so the report shows 声称 vs 核验 as two
   *  columns, not just the verification one. LUM-573: sourced from the frozen
   *  task-level claim snapshot (the AUTHORITATIVE merged-lineage session, not
   *  the trailing latest session), falling back to the live latest-session
   *  summary before a snapshot is frozen; same-source with the web card through
   *  the server's TaskAcceptanceStatus.claim. An unverified self-report
   *  (estimate-tier), never a measurement. Optional so a new CLI tolerates an
   *  older server that doesn't emit it. */
  claim?: {
    text: string | null
    // LUM-597: 'AGENT' = the agent's own verify self-report (authoritative);
    // RUN_SUMMARY/DIGEST = a summarizer paraphrase fallback (SYNTHESIZED).
    source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
  }
  /** LUM-583: whether the CLAIM faithfully reflects the delivery — the third
   *  state over 声称/核验, read from the persisted LUM-582 verdict (no LLM at
   *  read time). PENDING = not yet judged (≠ UNJUDGEABLE); STALE = judged
   *  against an older claim snapshot, the verdict still surfaced. Optional so a
   *  new CLI tolerates an older server that doesn't emit it. */
  faithfulness?: {
    state:
      | 'FAITHFUL'
      | 'UNDERREPORT'
      | 'OVERSTATED'
      | 'UNJUDGEABLE'
      | 'PENDING'
      | 'STALE'
    verdict: 'FAITHFUL' | 'UNDERREPORT' | 'OVERSTATED' | 'UNJUDGEABLE' | null
    evidence: string[]
    reasoning: string | null
    diffShas: string[]
    prNumbers: number[]
    judgedAt: string | null
    judgedClaimAt: string | null
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

  // LUM-564 声称 vs 核验: the agent's CLAIM (what it says it did) paired with
  // the measured verification conclusion (what was actually confirmed) — the
  // two columns regular 規律2 wants, instead of only the verification one. The
  // machine-verification rollup (LUM-470) lives on the verification side here
  // rather than as a standalone line, so the contrast is in one place.
  pushClaimVsVerification(lines, data)

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
      lines.push(`      ✓ ${v.verdict}@r${v.round}${machineTag}`)
      // LUM-457: a pass that vouches for a pre-edit version of the criterion —
      // render-only downgrade, the criterion still counts met.
      if (c.verdictStale || c.checkMismatch) {
        lines.push(
          '      ⚠ pre-edit version — criterion changed since this check; re-run `lumo verify` to re-confirm'
        )
      }
    }
    // LUM-563: drill the verdict's evidence into a navigable / re-runnable
    // reference instead of the inert raw pointer that used to ride the verdict
    // line — a commit URL (or `git show` fallback), a clickable path:line, or
    // the actual command + exit. Rendered for PASS and FAIL alike so a failure
    // is just as reproducible. When a criterion requires evidence but none is
    // recorded yet, say so explicitly (fail-closed) rather than leaving the
    // bare `[evidence]` tag pointing at nothing.
    if (v?.evidencePointer) {
      lines.push(
        `        ↳ evidence: ${sanitizeField(formatEvidenceDrilldown(v.evidencePointer, extras.repoWebUrl ?? null))}`
      )
    } else if (c.evidenceRequired) {
      lines.push('        ↳ evidence: pending — no reference recorded yet')
    }
    // LUM-511 Phase 5: send-back lifecycle (was this criterion's send-back
    // resolved, and by which PR).
    const sb = c.sendBackResolution
    if (sb) {
      if (sb.status === 'resolved') {
        const pr = sb.closingPrNumber ? ` · PR #${sb.closingPrNumber}` : ''
        lines.push(
          `      ↳ send-back (r${sb.failedAtRound}) resolved in r${sb.resolvedAtRound}${pr}`
        )
      } else {
        lines.push(`      ↳ send-back (r${sb.failedAtRound}) open`)
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

  pushCost(lines, data)

  pushStruggleTrail(lines, data)
  pushTrend(lines, data)

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

/** Compact a token count for the terminal — 1_200_000 → "1.2M", 850_000 →
 *  "850K", 0 → "0". Uses the SAME Intl compact formatter the web card's
 *  fmtCompact uses (notation:'compact', maximumFractionDigits:1) so the same
 *  number reads identically in both surfaces — no presentation drift (LUM-560). */
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

/** Active (non-idle) seconds → a compact "2h 14m" / "3m 5s" / "12s". 0 → "0s". */
function fmtDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  if (sec === 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  // Show seconds only when the duration is under an hour (keeps long runs tidy).
  if (s > 0 && h === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Append the "Claim vs verification" pairing (LUM-564) — 規律2 声称vs核验. The
 * verification conclusion (machine-verified vs human-override, LUM-470) was the
 * whole-system template, but the agent's run summary — its CLAIM of what it did
 * — lived on a different surface, so the "two-column" contrast was really one
 * column. This puts them side by side: the unverified self-report (estimate-
 * tier — 估, not 测) against the measured verdict (测), so a reader can weigh
 * 声称 against 核验 at a glance.
 *
 * Fail-closed on every axis: a missing claim renders an explicit "not generated
 * yet" line (never a fabricated claim); a not-yet-verified task renders the
 * verification side as explicitly unconfirmed (never an implied pass). The
 * claim text is same-source with the web card (latest session's LLM run
 * summary, else its STOP turn digest) so the two surfaces cannot drift.
 */
function pushClaimVsVerification(
  lines: string[],
  data: TaskStatusResponse
): void {
  lines.push('')
  lines.push('Claim vs verification:')

  // ── Claim (声称): the agent's self-report — estimate-tier, never measured.
  lines.push('  ▸ Claim — what the agent says it did')
  lines.push('    (agent self-report · estimated, not verification):')
  const claim = data.claim
  if (claim && claim.source === 'AGENT' && claim.text) {
    // LUM-597: the agent's OWN self-report (attached to verify) — the
    // authoritative claim faithfulness judges, not a summarizer paraphrase.
    for (const cl of sanitizeField(claim.text).split('\n')) {
      lines.push(`      ${cl}`)
    }
    lines.push('      ↳ source: agent self-report (verify --note)')
  } else if (claim && claim.source === 'RUN_SUMMARY' && claim.text) {
    for (const cl of sanitizeField(claim.text).split('\n')) {
      lines.push(`      ${cl}`)
    }
    lines.push('      ↳ source: synthesized run summary (no self-report)')
  } else if (claim && claim.source === 'DIGEST') {
    // LUM-583 ③ / LUM-574: a raw turn digest is not a claim — withhold it and
    // say the formal summary is still generating, same-source with the web card.
    lines.push(
      '      generating — the formal run summary is still being synthesized'
    )
  } else {
    // Fail-closed: no run summary → say so, never invent a claim. Run summaries
    // are synthesized when the bound task reaches DONE (LUM-481).
    lines.push(
      '      not generated yet — the agent run summary is synthesized when the task reaches DONE'
    )
  }

  // ── Faithfulness (LUM-583): the third state — is the claim itself true? Read
  // from the persisted LUM-582 verdict; PENDING (not yet judged) is distinct
  // from UNJUDGEABLE (a real verdict), STALE keeps the verdict but flags a
  // pending re-check. Skipped only when the server didn't emit it (older server).
  pushFaithfulness(lines, data.faithfulness)

  // ── Verification (核验): the measured verdict — machine-verified vs override.
  lines.push('  ▸ Verification — what was actually confirmed (measured):')
  const mv = data.machineVerification
  if (data.currentRound === 0) {
    // Nothing verified yet — the claim stands unconfirmed. Don't imply a pass.
    lines.push('      no verification has run yet — the claim is unconfirmed')
  } else {
    if (mv.total > 0) {
      lines.push(
        `      ${mv.machineVerified} machine-verified / ${mv.humanOverridden} human override (of ${mv.total} MACHINE criteria)`
      )
    }
    const met = data.criteria.length - data.nextActions.length
    lines.push(
      `      ${met} of ${data.criteria.length} criteria met by their latest verdict`
    )
  }
}

/**
 * Append the "Faithfulness" conclusion (LUM-583) — the third state over the
 * 声称/核验 columns: whether the agent's CLAIM is itself TRUE, judged
 * independently against the delivery (LUM-582). Same read model the web honest
 * report renders, so the two surfaces cannot drift. Fail-closed: PENDING (not
 * yet judged) reads distinctly from UNJUDGEABLE (a real verdict), and STALE
 * keeps the prior verdict while flagging a pending re-check. Skipped only when
 * the server didn't emit the field (older server) — never fabricated.
 */
function pushFaithfulness(
  lines: string[],
  f: TaskStatusResponse['faithfulness']
): void {
  if (!f) return // older server: field absent → don't fabricate a conclusion.
  const verdictPhrase = (
    v: 'FAITHFUL' | 'UNDERREPORT' | 'OVERSTATED' | 'UNJUDGEABLE'
  ): string => {
    switch (v) {
      case 'FAITHFUL':
        return 'faithful — the claim matches the delivery'
      case 'OVERSTATED':
        return 'overstated — the claim says more than the diff/PR shows'
      case 'UNDERREPORT':
        return 'under-reported — the claim says less than the diff/PR shows'
      default:
        return "unjudgeable — couldn't decide from the diff/PR"
    }
  }
  let body: string
  if (f.state === 'PENDING') {
    body =
      'not yet judged — the faithfulness check runs in a batch after delivery'
  } else if (f.state === 'STALE') {
    body = `${f.verdict ? verdictPhrase(f.verdict) : 'judged'} (stale — re-checked on the next batch)`
  } else {
    body = verdictPhrase(f.state)
  }
  const ev: string[] = []
  if (f.prNumbers.length > 0) {
    ev.push(`PR ${f.prNumbers.map(n => `#${n}`).join(', ')}`)
  }
  if (f.diffShas.length > 0) {
    ev.push(
      f.diffShas
        .slice(0, 3)
        .map(s => sanitizeField(s).slice(0, 7))
        .join(' ')
    )
  }
  lines.push('  ▸ Faithfulness — does the claim match the delivery (LUM-583):')
  lines.push(
    `      ${body}${ev.length > 0 ? ` · evidence: ${ev.join(' · ')}` : ''}`
  )
}

/**
 * Append the honest "Cost" section (LUM-560) — 规律 1: surface the costs a human
 * should weigh (token spend, active time, machine rework) on the same report as
 * the acceptance verdict, instead of leaving them scattered across the web
 * delivery card and `task lineage`. Every number is the server's, read from the
 * same loadActuals source as the web card (no drift). Token cost is fail-closed:
 * a null reads as an explicit "not recorded" line, never a silent or fake 0, so
 * 没测到 (no session usage) stays distinct from a measured 花了0. Skipped only
 * when the server didn't emit the field (older server) — never fabricated.
 */
function pushCost(lines: string[], data: TaskStatusResponse): void {
  const cost = data.cost
  if (!cost) return // older server: can't fabricate cost, so don't claim any.

  lines.push('')
  lines.push('Cost:')
  lines.push(
    cost.tokenCost == null
      ? '  Tokens: not recorded (no session usage captured)'
      : `  Tokens: ${fmtTokens(cost.tokenCost)}`
  )
  lines.push(`  Active time: ${fmtDuration(cost.activeTimeSec)} (non-idle)`)
  lines.push(
    `  Rework rounds: ${cost.reworkRounds}${cost.reworkRounds === 0 ? ' (no machine rework)' : ''}`
  )
}

/**
 * Append the honest "Struggle / rework / outstanding" section (LUM-561) — the
 * anti-mum-and-deaf block (kills a silent "Nothing outstanding"). It is ALWAYS
 * rendered when the contract exists, even on a clean 0-unmet task: a passing
 * task that bounced, was sent back, or left a follow-up behind still shows its
 * scars. When the trail is genuinely empty the block states the *basis* for
 * that ("none — N rounds run, 0 FAIL …"), or, when nothing has been verified,
 * that absence cannot be confirmed — never a bare clean slate. Skipped only
 * when the server didn't emit the field (older server).
 */
function pushStruggleTrail(lines: string[], data: TaskStatusResponse): void {
  const trail = data.struggleTrail
  if (!trail) return // older server: can't fabricate, so don't claim "none".

  lines.push('')
  lines.push('Struggle / rework / outstanding:')

  // A single PR is the happy path; >1 PR is the iteration signal. Reopens (a
  // bounce after IN_REVIEW/DONE) always count. These two catch the rework that
  // lives in PR cycles / status flips rather than in FAIL verdicts (LUM-561
  // follow-up — without them a 10-PR task like LUM-557 reads as one hiccup).
  const prIterated = trail.pullRequests.length > 1
  const empty =
    trail.reworkRounds.length === 0 &&
    trail.sendBacks.length === 0 &&
    trail.followUps.length === 0 &&
    trail.reopens.length === 0 &&
    !prIterated

  if (empty) {
    if (data.currentRound === 0) {
      // Honest fail-open: nothing was verified, so we cannot claim there were
      // no difficulties — say so rather than render an implicitly-clean slate.
      lines.push(
        '  No verification has run yet — cannot confirm there were no difficulties. Run `lumo verify`.'
      )
    } else {
      const rounds = `${data.currentRound} verification round${data.currentRound === 1 ? '' : 's'}`
      lines.push(
        `  None recorded — ${rounds} run, 0 FAIL, no send-backs, no reopens, no leftover follow-ups.`
      )
    }
    return
  }

  if (trail.reworkRounds.length > 0) {
    const parts = trail.reworkRounds.map(
      r => `round ${r.round} (${r.failed} FAIL)`
    )
    lines.push(`  Rework rounds: ${parts.join(', ')}`)
  }
  if (trail.sendBacks.length > 0) {
    lines.push('  Send-backs:')
    for (const s of trail.sendBacks) {
      const lifecycle =
        s.status === 'resolved'
          ? `resolved (sent back r${s.failedAtRound}${s.resolvedAtRound != null ? ` → r${s.resolvedAtRound}` : ''})`
          : `open (sent back r${s.failedAtRound})`
      lines.push(`    • ${sanitizeField(s.statement)} — ${lifecycle}`)
    }
  }
  if (trail.followUps.length > 0) {
    lines.push('  Follow-ups left behind:')
    for (const f of trail.followUps) {
      lines.push(`    • ${sanitizeField(f.statement)} — flagged r${f.round}`)
    }
  }
  // PR iteration — the dominant rework signal when the verify loop only ran
  // once but the work churned across many PRs (LUM-557). Only when >1 PR.
  if (prIterated) {
    const PR_CAP = 12
    const nums = trail.pullRequests.map(p => `#${p.number}`)
    const shown = nums.slice(0, PR_CAP).join(', ')
    const overflow =
      nums.length > PR_CAP ? `, +${nums.length - PR_CAP} more` : ''
    lines.push(
      `  PR iterations: ${trail.pullRequests.length} PRs (${shown}${overflow})`
    )
  }
  if (trail.reopens.length > 0) {
    lines.push(
      `  Reopened ${trail.reopens.length}× (bounced back after review/done):`
    )
    for (const r of trail.reopens) {
      lines.push(`    • ${r.from} → ${r.to}`)
    }
  }
}

/** Direction glyph for a delta — ↑ up, ↓ down, → flat. */
function arrow(delta: number): string {
  return delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
}

/** Pass rate of one round as an integer percent (0 verdicts → 0%). */
function passPct(p: { passed: number; failed: number }): number {
  const total = p.passed + p.failed
  return total === 0 ? 0 : Math.round((p.passed / total) * 100)
}

/**
 * Append the "Trend" section (LUM-562, 規律7 趨勢非快照) — the *movement* of the
 * task's key quantities across its attempts, not a single-point snapshot. Where
 * History lists each round's PASS/FAIL, Cost shows the running total, and
 * Struggle lists the scars, this shows direction: pass rate climbing, cost per
 * session rising/falling, rework accruing. The honesty rule (mirrors the
 * struggle trail): a single data point is NOT a trajectory — with one round and
 * one session the section says so outright rather than drawing a fake arrow off
 * a single value, closing the named "1-round pass = single point" gap. The
 * per-session cost reuses the same source as the Cost section, so the
 * trajectory's points sum to the Cost total (no in-report drift). Skipped only
 * when the server didn't emit the field (older server) — never fabricated.
 */
function pushTrend(lines: string[], data: TaskStatusResponse): void {
  const trend = data.trend
  if (!trend) return // older server: no trend data — don't invent one.

  const rounds = trend.passRate
  const cost = trend.cost
  const rw = trend.rework

  lines.push('')

  // Nothing to trend at all — no verification, no measured cost.
  if (rounds.length === 0 && cost.length === 0) {
    lines.push('Trend:')
    lines.push(
      '  No verification rounds or measured cost yet — nothing to trend. Run `lumo verify`.'
    )
    return
  }

  // A trajectory needs ≥2 points in at least one dimension. With a single
  // round AND a single session, every quantity is one data point — say so
  // plainly instead of implying a flat/healthy trend (the named gap).
  const hasTrajectory = rounds.length >= 2 || cost.length >= 2
  if (!hasTrajectory) {
    lines.push('Trend:')
    lines.push(
      '  Single attempt so far — no trajectory yet (a trend needs ≥2 rounds or sessions).'
    )
    const bits: string[] = []
    if (rounds.length === 1)
      bits.push(`pass rate r${rounds[0]!.round} ${passPct(rounds[0]!)}%`)
    if (cost.length === 1) bits.push(`cost ${fmtTokens(cost[0]!.total)} tokens`)
    bits.push(rw.total === 0 ? 'rework none' : `rework ${rw.total}`)
    lines.push(`  ${bits.join(' · ')}`)
    return
  }

  const sessionWord = cost.length === 1 ? 'session' : 'sessions'
  lines.push(`Trend (${rounds.length} rounds · ${cost.length} ${sessionWord}):`)

  // Pass rate across rounds — the climb (or fall) of the verify loop.
  if (rounds.length >= 2) {
    const seq = rounds.map(r => `r${r.round} ${passPct(r)}%`).join(' → ')
    const delta = passPct(rounds[rounds.length - 1]!) - passPct(rounds[0]!)
    const sign = delta > 0 ? `+${delta}` : `${delta}`
    lines.push(`  Pass rate: ${seq}  (${arrow(delta)} ${sign}pts)`)
  } else if (rounds.length === 1) {
    lines.push(
      `  Pass rate: r${rounds[0]!.round} ${passPct(rounds[0]!)}% (1 round — single point)`
    )
  }

  // Cost per session across the task's sessions — the spend trajectory.
  if (cost.length >= 2) {
    const first = cost[0]!.total
    const last = cost[cost.length - 1]!.total
    const total = cost.reduce((a, c) => a + c.total, 0)
    lines.push(
      `  Cost/session: ${fmtTokens(first)} → ${fmtTokens(last)} tokens  (${arrow(last - first)}), ${fmtTokens(total)} total over ${cost.length} sessions`
    )
  } else if (cost.length === 1) {
    lines.push(
      `  Cost: ${fmtTokens(cost[0]!.total)} tokens (1 session — single point)`
    )
  }

  // Rework accrual — monotonic from a clean baseline of 0.
  if (rw.total === 0) {
    lines.push('  Rework: none accrued (0) — clean across every attempt')
  } else {
    const parts: string[] = []
    if (rw.reworkRounds > 0)
      parts.push(
        `${rw.reworkRounds} FAIL round${rw.reworkRounds === 1 ? '' : 's'}`
      )
    if (rw.reopens > 0)
      parts.push(`${rw.reopens} reopen${rw.reopens === 1 ? '' : 's'}`)
    if (rw.extraPrCycles > 0)
      parts.push(
        `+${rw.extraPrCycles} PR cycle${rw.extraPrCycles === 1 ? '' : 's'}`
      )
    lines.push(
      `  Rework: ${rw.total} accrued — ${parts.join(', ')}  (↑ from 0)`
    )
  }
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
      // LUM-563: resolve the local repo's web base so a `commit:` evidence
      // pointer drills to a navigable URL; null (not a git repo / no origin)
      // falls back to a `git show` hint in the renderer.
      repoWebUrl: resolveRepoWebUrl(),
    })
  )
}
