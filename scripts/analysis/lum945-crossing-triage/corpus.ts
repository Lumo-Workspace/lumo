/**
 * LUM-945 — the labelled corpus the context-triage judge is evaluated on.
 * Pure: maps one human-dispositioned BoundaryCrossing row (plus its task and
 * agent explanations) to a redacted, size-bounded corpus item. No I/O, so the
 * export script and the tests share exactly one mapping.
 *
 * Trust split (the design rule this eval exists to test):
 *   - `taskContext` — the task's title + description. Treated as the only
 *     admissible basis for a LEGIT verdict. NOTE: provenance is unverified —
 *     a task created through the CLI by an agent carries the human's actor, so
 *     nothing in the schema separates a human-written description from an
 *     agent-written one. The report states this limitation.
 *   - `agentStatements` — the agent's own `crossing explain` notes. Passed to
 *     the judge fenced as untrusted, never as evidence.
 *   - `labelNote` — the human reviewer's disposition note. Kept for error
 *     analysis only and NEVER rendered into a prompt (it would leak the label).
 */
import { redactForStorage } from '@/lib/security-scan/scan-secrets'

export type HumanLabel = 'FALSE_POSITIVE' | 'CONFIRMED'

export const HUMAN_LABELS: readonly HumanLabel[] = [
  'FALSE_POSITIVE',
  'CONFIRMED',
]

/** Categories excluded from the eval: TEST_TAMPERING lost its producer in LUM-942. */
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  'TEST_TAMPERING',
])

/** Size caps — keep one item well inside every candidate's context window. */
export const MAX_DETAIL_CHARS = 2000
export const MAX_TARGET_CHARS = 500
export const MAX_RULE_CHARS = 1000
export const MAX_DESCRIPTION_CHARS = 3000
export const MAX_STATEMENT_CHARS = 1500
export const MAX_STATEMENTS = 3

const EVASION_PREFIX = '[base64-decoded]'

export interface CorpusItem {
  id: string
  taskRef: string | null
  category: string
  severity: string
  reversible: boolean
  advisory: boolean
  /** Detail starts with the evasion marker the detector writes for decoded payloads. */
  evasion: boolean
  /** LUM-912 swapped the raw detail/target for a code-free description. */
  rawPurged: boolean
  detail: string
  target: string | null
  policyRuleText: string | null
  taskContext: { title: string; description: string } | null
  agentStatements: string[]
  label: HumanLabel
  labelNote: string | null
}

export interface CrossingRow {
  id: string
  category: string
  severity: string
  reversible: boolean
  advisory: boolean
  detail: string
  target: string | null
  policyRuleText: string | null
  disposition: string | null
  dispositionNote: string | null
  rawPurgedAt: Date | null
  task: {
    number: number
    title: string
    description: string | null
    team: { identifier: string }
  } | null
  explanations: { note: string }[]
}

function cap(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(truncated)`
}

function clean(text: string, max: number): string {
  return cap(redactForStorage(text).text, max)
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** Task descriptions are stored as rich HTML; the judge reads plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/div|\/pre)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isHumanLabel(v: string | null): v is HumanLabel {
  return v === 'FALSE_POSITIVE' || v === 'CONFIRMED'
}

/**
 * One row → one corpus item, or null when the row carries no human label
 * (AUTO_LEGIT / AUTO_SUPPRESSED / OPEN) or its category is excluded.
 */
export function toCorpusItem(row: CrossingRow): CorpusItem | null {
  if (!isHumanLabel(row.disposition)) return null
  if (EXCLUDED_CATEGORIES.has(row.category)) return null
  const task = row.task
  return {
    id: row.id,
    taskRef: task ? `${task.team.identifier}-${task.number}` : null,
    category: row.category,
    severity: row.severity,
    reversible: row.reversible,
    advisory: row.advisory,
    evasion: row.detail.startsWith(EVASION_PREFIX),
    rawPurged: row.rawPurgedAt !== null,
    detail: clean(row.detail, MAX_DETAIL_CHARS),
    target: row.target === null ? null : clean(row.target, MAX_TARGET_CHARS),
    policyRuleText:
      row.policyRuleText === null
        ? null
        : clean(row.policyRuleText, MAX_RULE_CHARS),
    taskContext: task
      ? {
          title: clean(task.title, 300),
          description: clean(
            htmlToText(task.description ?? ''),
            MAX_DESCRIPTION_CHARS
          ),
        }
      : null,
    agentStatements: row.explanations
      .slice(0, MAX_STATEMENTS)
      .map(e => clean(e.note, MAX_STATEMENT_CHARS)),
    label: row.disposition,
    labelNote:
      row.dispositionNote === null
        ? null
        : clean(row.dispositionNote, MAX_STATEMENT_CHARS),
  }
}
