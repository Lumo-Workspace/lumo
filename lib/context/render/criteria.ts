import { makeBudgetSection } from '@/lib/context/budget'

export interface CriterionCard {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  evidenceRequired: boolean
  source: 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'
  addedAtRound: number
}

const CRITERIA_HEADING = '## 验收标准（合约）'

const MANIFEST_STATEMENT_MAX = 80

/**
 * Provenance suffix for a criterion line. The round-0 agent draft is the
 * baseline and stays untagged; human revisions and review-time additions are
 * the feedback-loop signal worth surfacing inline.
 */
function provenanceTag(c: CriterionCard): string {
  if (c.source === 'HUMAN_EDIT') return ' ·（HUMAN_EDIT）'
  if (c.source === 'REVIEW_ADDED') return ` ·（REVIEW_ADDED · r${c.addedAtRound}）`
  return ''
}

/** Render a single criterion card (no section heading). */
export function criterionCard(c: CriterionCard): string {
  const evidence = c.evidenceRequired ? ' · 需证据' : ''
  const lines: string[] = [
    `- [${c.verifierType}] ${c.statement}${provenanceTag(c)}${evidence}`,
  ]
  if (c.checkpointer) lines.push(`  ↳ check: ${c.checkpointer}`)
  return lines.join('\n')
}

/** One-line manifest for an overflowed criterion. */
export function criterionManifest(c: CriterionCard): string {
  const s =
    c.statement.length > MANIFEST_STATEMENT_MAX
      ? `${c.statement.slice(0, MANIFEST_STATEMENT_MAX)}…`
      : c.statement
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
 */
export function renderCriteriaDraftNudge(): string {
  return [
    CRITERIA_HEADING,
    '',
    '该任务尚无验收标准。请在动第一行代码之前：读完任务上下文 → 草拟 3–7 条结果级验收标准 → `lumo task criteria set <task> --file <criteria.json>` 提交锁定。挂不上可执行检查的标准用 HUMAN 类型；仓库级基线（测试通过 / tsc / i18n parity）不占名额。',
  ].join('\n')
}
