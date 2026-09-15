import { makeBudgetSection } from '@/lib/context/budget'
import { sanitizeField } from '@/lib/utils/sanitize'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'
import {
  effectiveReferentKind,
  type DeclarableReferentKind,
} from '../../../shared/src/referent-kind'

export interface CriterionCard {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  evidenceRequired: boolean
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  addedAtRound: number
  /** LUM-602: declared referent kind from the DB row; null on legacy rows. */
  referentKind?: DeclarableReferentKind | null
}

const CRITERIA_HEADING = '## Acceptance criteria (contract)'

const MANIFEST_STATEMENT_MAX = 80

/**
 * LUM-346 control-char strip + LUM-784 secret redaction, in that order. The
 * contract is trusted framing and carries no untrusted wrapper to put a
 * notice in, so the redaction token (`ghp_…(len 40)`) is the whole signal.
 */
function cleanText(value: string): string {
  return redactForInjection(sanitizeField(value)).text
}

/**
 * Provenance suffix for a criterion line. The round-0 agent draft is the
 * baseline and stays untagged; human revisions and review-time additions are
 * the feedback-loop signal worth surfacing inline.
 */
function provenanceTag(c: CriterionCard): string {
  if (c.source === 'HUMAN_EDIT') return ' ·（HUMAN_EDIT）'
  if (c.source === 'REVIEW_ADDED')
    return ` ·（REVIEW_ADDED · r${c.addedAtRound}）`
  return ''
}

/**
 * Render a single criterion card (no section heading). statement/checkpointer
 * are free text (agent/human-authored, may transcribe untrusted task content)
 * and the contract deliberately skips the untrusted wrappers — so the LUM-346
 * control-char strip happens HERE, at the render source, covering every
 * consumer (session-start hook envelope, attach echo, task context).
 *
 * LUM-602: when referentKind is set (non-null), appends `· ⟨<effectiveKind>⟩`
 * to the first line so reviewers can spot UNVERIFIED_ASSERTION at a glance.
 * Legacy rows (referentKind null/undefined) produce no tag — no noise on old
 * tasks.
 */
export function criterionCard(c: CriterionCard): string {
  const evidence = c.evidenceRequired ? ' · evidence required' : ''
  const kindTag =
    c.referentKind != null
      ? ` · ⟨${effectiveReferentKind({ declared: c.referentKind, verifierType: c.verifierType, checkpointer: c.checkpointer })}⟩`
      : ''
  const lines: string[] = [
    `- [${c.verifierType}] ${cleanText(c.statement)}${provenanceTag(c)}${evidence}${kindTag}`,
  ]
  if (c.checkpointer) lines.push(`  ↳ check: ${cleanText(c.checkpointer)}`)
  return lines.join('\n')
}

/** One-line manifest for an overflowed criterion. Same strip as the card. */
export function criterionManifest(c: CriterionCard): string {
  const statement = cleanText(c.statement)
  const s =
    statement.length > MANIFEST_STATEMENT_MAX
      ? `${statement.slice(0, MANIFEST_STATEMENT_MAX)}…`
      : statement
  return `- [${c.verifierType}] ${s}`
}

/** Render the full criteria section; "" when the task has no contract yet. */
export function renderCriteriaSection(criteria: CriterionCard[]): string {
  if (criteria.length === 0) return ''
  const lines: string[] = [CRITERIA_HEADING, '']
  for (const c of criteria) lines.push(criterionCard(c))
  return lines.join('\n').trimEnd()
}

/**
 * Budget-section wrapper for acceptance criteria (LUM-342). The contract is
 * the highest-priority session-start section: it's what the work will be
 * judged against, and at 3–7 short statements it's also the cheapest.
 */
export function criteriaBudgetSection(criteria: CriterionCard[]) {
  return makeBudgetSection(
    CRITERIA_HEADING,
    criteria,
    criterionCard,
    criterionManifest,
    '\n'
  )
}

/**
 * Session-start nudge injected when a bound, still-open task has no criteria
 * yet: the SKILL.md drafting guide tells the agent HOW to draft; this line
 * makes sure the agent notices it must, before the first line of code.
 *
 * LUM-497: an optional reference-class anchor (the outside view — how similar
 * delivered tasks historically failed) is appended below the nudge. Empty or
 * omitted leaves the section byte-identical to the pre-LUM-497 output, which
 * matters because this text is what makes an agent draft a contract at all.
 */
export function renderCriteriaDraftNudge(anchor?: string): string {
  const lines: string[] = [
    CRITERIA_HEADING,
    '',
    'This task has no acceptance criteria yet. Before writing the first line of code: read the task context, draft 3–7 outcome-level acceptance criteria, then submit and lock them with `lumo task criteria set <task> --file <criteria.json>`. Use the HUMAN type for criteria that cannot carry an executable check; repo-wide baselines (tests pass / tsc / i18n parity) do not take slots.',
  ]
  if (anchor && anchor.trim() !== '') lines.push('', anchor.trim())
  return lines.join('\n')
}
