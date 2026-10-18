/**
 * LUM-780 — the pure verdicts behind the boundary-crossing re-judge: does the
 * CAUSE of an OPEN blocking crossing still hold, judged by the CURRENT
 * detector's criterion against the CURRENT state?
 *
 * Why this exists: a crossing only ever had an entrance. When the criterion
 * that produced it was fixed (LUM-770 → "is the rule text still in the
 * file", LUM-779 → "is a tracked test file actually missing") the fix only
 * gated NEW detections; every row the old criterion had already written kept
 * blocking DONE until a human ruled on it one by one — 22 + 11 such rows on
 * LUM-758 alone, every one of them re-injected at every session start.
 *
 * The rule of this module: the write a CAUSE_GONE verdict proposes is exactly
 * what the current detector would write for the same evidence today —
 * advisory, still OPEN, still on the panel, never blocking. Nothing here
 * dispositions anything (human-only, unchanged), nothing here is a batch
 * default: every verdict carries a machine-readable reason and a one-line
 * human-readable evidence string, and a cause that cannot be decided is
 * UNDECIDABLE — left exactly as it was (fail-closed).
 *
 * Pure: no I/O, no clock. The service feeds it the rows and the state.
 */
import type { BoundaryCrossingSeverity } from '@prisma/client'
import { isTestFilePath } from '../../shared/src/test-file-path'
import { isEvasionDecoded } from './evasion'

/** Which criterion judged a row — recorded on the trail so an auditor can
 *  tell which version of the detector's question was asked. Bump a value
 *  when its category's criterion changes semantics. */
export const REJUDGE_CRITERION_VERSION = {
  POLICY_WEAKENING: 'lum770-text-presence',
  TEST_FILE_DELETED: 'lum779-net-deletion',
} as const

export type RejudgeableCategory = keyof typeof REJUDGE_CRITERION_VERSION

export const REJUDGEABLE_CATEGORIES: readonly RejudgeableCategory[] = [
  'POLICY_WEAKENING',
  'TEST_FILE_DELETED',
]

export function isRejudgeableCategory(
  category: string
): category is RejudgeableCategory {
  return (REJUDGEABLE_CATEGORIES as readonly string[]).includes(category)
}

export type RejudgeOutcome = 'CAUSE_GONE' | 'STILL_HOLDS' | 'UNDECIDABLE'

/** Machine-readable reasons — one per branch, so a trail line is greppable. */
export type RejudgeReason =
  // POLICY_WEAKENING
  | 'RULE_TEXT_PRESENT'
  | 'RULE_TEXT_ABSENT'
  | 'SOURCE_UNREADABLE'
  | 'RULE_TEXT_UNKNOWN'
  // TEST_FILE_DELETED
  | 'NO_TEST_FILE_REMOVED'
  | 'TEST_FILE_REMOVED_IN_PR'
  | 'NO_LINKED_PR'
  | 'PR_FILES_UNREADABLE'
  // both
  | 'EVASION_DECODED'

export interface RejudgeVerdict {
  outcome: RejudgeOutcome
  reason: RejudgeReason
  /** One human-readable line: what was checked and what was seen. */
  evidence: string
  criterionVersion: string
  /** Present only on CAUSE_GONE — the row's new (advisory) shape. */
  write?: { severity: BoundaryCrossingSeverity; detail: string }
}

// Same cap the detector applies to `detail` (boundary-detector.service.ts
// DETAIL_MAX); duplicated rather than imported so this module stays free of
// the detector's I/O-bearing dependency graph.
const DETAIL_MAX = 200
function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX)}…` : t
}

/**
 * Markdown-insensitive comparison basis (LUM-770). A rule's `text` is what the
 * classifier extracted, with emphasis and code spans already stripped; the
 * source still carries them, so a raw `includes` is false for a rule that is
 * plainly still there. Shared with the policy compiler's own presence check so
 * detection and re-judge cannot drift apart.
 */
export function normalizeForPresence(text: string): string {
  return text.toLowerCase().replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * The rule-text side of the presence check. The classifier hands back the
 * sentence it extracted — and sometimes decorates it: 14 production rows cite
 * `use only \`prisma migrate deploy\` — … \`_prisma_migrations\` [for production
 * migrations]`, a trailing bracketed gloss that is nowhere in CLAUDE.md, so a
 * verbatim `includes` read a rule that is plainly still on line 78 as
 * "removed" — HIGH, blocking, 14 times. Only a TRAILING `[…]` gloss and
 * trailing punctuation are stripped, and only on the rule side: the source is
 * never loosened, so the check can still only pass when the rule's own words
 * are in the file (fail-closed direction unchanged).
 */
export function normalizeRuleTextForPresence(text: string): string {
  return normalizeForPresence(
    text.replace(/\s*\[[^\]]*\]\s*$/u, '').replace(/[.;:,]+\s*$/u, '')
  )
}

/** Is the rule's text still in the source? One predicate, shared by the
 *  detector (policy-compiler `emitWeakening`) and the re-judge, so the two
 *  can never disagree about the same evidence. */
export function ruleTextPresentIn(source: string, ruleText: string): boolean {
  const needle = normalizeRuleTextForPresence(ruleText)
  if (needle.length === 0) return false
  return normalizeForPresence(source).includes(needle)
}

/** Words too common to say anything about which rule a line states. */
const PRESENCE_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'in',
  'on',
  'at',
  'or',
  'and',
  'for',
  'with',
  'by',
  'as',
  'be',
  'is',
  'are',
  'it',
  'its',
  'this',
  'that',
  'any',
  'e',
  'g',
])

/** The content words of a text, unique, in order: lower-cased word tokens
 *  (identifiers like `_prisma_migrations` stay whole; a CJK character is a
 *  word of its own), stopwords dropped. */
export function presenceWords(text: string): string[] {
  const out: string[] = []
  for (const m of normalizeForPresence(text).matchAll(
    /[a-z0-9_]+|[\u3400-\u9fff]/gu
  )) {
    const w = m[0]
    if (PRESENCE_STOPWORDS.has(w) || out.includes(w)) continue
    out.push(w)
  }
  return out
}

/** Below this many content words a paraphrase match is too easy to hit by
 *  accident — such a rule must be present verbatim. */
const PARAPHRASE_MIN_WORDS = 5
/** Share of the rule's content words one source line must carry. */
const PARAPHRASE_MIN_SHARE = 0.85

/**
 * LUM-1236 follow-up — "is this COMPILER-EXTRACTED rule still in the source",
 * tolerant of the classifier rewording it. The rule text a POLICY_WEAKENING
 * judges is the model's extraction, and a recompile can reorder or rephrase
 * it: "Never `migrate dev`, `db push`, `migrate reset`, or direct edits to
 * `_prisma_migrations` in production" is no substring of CLAUDE.md, whose
 * line reads "**Production**: … (b) use **only** `prisma migrate deploy` —
 * never `migrate dev`, … `_prisma_migrations`, (c) …". The verbatim check read
 * that untouched line as deleted by a person (X953/X954, HIGH, blocking).
 *
 * Present when the verbatim check passes, or when ONE source line (with the
 * markdown heading it sits under, which often carries the qualifier) holds at
 * least 85% of the rule's content words and every identifier-like word (one
 * with `_` or a digit). Local on purpose: words scattered across the file are
 * no evidence — the same commands appear in the Dev line, so deleting the
 * Production line still reads as removed. Rules of fewer than five content
 * words must match verbatim. Only for the compiler's rule texts; the core
 * Forbidden source compares literal lines and keeps `ruleTextPresentIn`.
 */
export function compiledRuleTextPresentIn(
  source: string,
  ruleText: string
): boolean {
  if (ruleTextPresentIn(source, ruleText)) return true
  const words = presenceWords(ruleText.replace(/\s*\[[^\]]*\]\s*$/u, ''))
  if (words.length < PARAPHRASE_MIN_WORDS) return false
  const identifiers = words.filter(w => /[_0-9]/.test(w))
  let heading = ''
  for (const line of source.split('\n')) {
    if (/^\s*#{1,6}\s/.test(line)) {
      heading = line
      continue
    }
    if (line.trim() === '') continue
    const have = new Set(presenceWords(`${heading}\n${line}`))
    if (!identifiers.every(w => have.has(w))) continue
    const hits = words.filter(w => have.has(w)).length
    if (hits / words.length >= PARAPHRASE_MIN_SHARE) return true
  }
  return false
}

/** The rule text an emitted POLICY_WEAKENING quoted in its detail, for rows
 *  written before `policyRuleText` was stamped (LUM-780). Only a complete
 *  quote counts — a `clip`-truncated detail loses its closing quote and must
 *  not be judged on a prefix. */
export function ruleTextFromDetail(detail: string): string | null {
  const m = detail.match(/: "([^"]+)"$/)
  return m?.[1] ?? null
}

export interface PolicyWeakeningRow {
  detail: string
  policyRuleText: string | null
  /** LUM-1068: `forbidden:<id>` marks a row of the core Forbidden source. */
  policyRuleRef?: string | null
}

/** LUM-1068: `policyRuleRef` prefix of a core Forbidden-source row (a literal
 *  `## Forbidden` item, no classifier involved — lib/boundary-crossing/
 *  forbidden-rules.ts). The plugin's rows carry a bare LLM rule id. */
export const FORBIDDEN_RULE_REF_PREFIX = 'forbidden:'

/**
 * POLICY_WEAKENING: the current criterion (LUM-770) is "is the rule's text
 * still in the source". Present → a classifier decision, not a human edit:
 * the same evidence the compiler records as MEDIUM advisory today. Absent →
 * the rule really left the file: still HIGH, still blocking.
 */
export function rejudgePolicyWeakening(
  row: PolicyWeakeningRow,
  source: string | null
): RejudgeVerdict {
  const criterionVersion = REJUDGE_CRITERION_VERSION.POLICY_WEAKENING
  const text = row.policyRuleText ?? ruleTextFromDetail(row.detail)
  if (text == null || text.trim().length === 0) {
    return {
      outcome: 'UNDECIDABLE',
      reason: 'RULE_TEXT_UNKNOWN',
      evidence:
        'the rule text is not on the row and could not be recovered from its detail — cannot ask whether it is still in the source',
      criterionVersion,
    }
  }
  if (source == null) {
    return {
      outcome: 'UNDECIDABLE',
      reason: 'SOURCE_UNREADABLE',
      evidence:
        'the current CLAUDE.md/AGENTS.md source could not be read — not judged',
      criterionVersion,
    }
  }
  // LUM-1236 follow-up: a compiler row judges the model's extraction, which
  // a recompile may reword; a core Forbidden row is a literal line.
  const present = row.policyRuleRef?.startsWith(FORBIDDEN_RULE_REF_PREFIX)
    ? ruleTextPresentIn(source, text)
    : compiledRuleTextPresentIn(source, text)
  if (!present) {
    return {
      outcome: 'STILL_HOLDS',
      reason: 'RULE_TEXT_ABSENT',
      evidence: `rule text is no longer in the current CLAUDE.md/AGENTS.md source: "${text}"`,
      criterionVersion,
    }
  }
  return {
    outcome: 'CAUSE_GONE',
    reason: 'RULE_TEXT_PRESENT',
    evidence: `rule text is still in the current CLAUDE.md/AGENTS.md source: "${text}"`,
    criterionVersion,
    write: {
      severity: 'MEDIUM',
      detail: clip(
        row.policyRuleRef?.startsWith(FORBIDDEN_RULE_REF_PREFIX)
          ? `This Forbidden rule's text is back in CLAUDE.md/AGENTS.md (restored or moved), so it no longer reads as deleted (re-judged, LUM-780): "${text}"`
          : `The policy compiler stopped treating this rule as deterministic+blocking, but its text is UNCHANGED in CLAUDE.md — a classifier decision, not an edit (re-judged, LUM-780): "${text}"`
      ),
    },
  }
}

export interface PrFileEntry {
  filename: string
  /** GitHub's file status: added | removed | modified | renamed | copied | changed | unchanged. */
  status: string
}

export interface PrFileList {
  number: number
  /** null = the list could not be read (API error, too many pages). */
  files: PrFileEntry[] | null
}

export interface TestFileDeletedRow {
  detail: string
  severity: BoundaryCrossingSeverity
}

/** Tracked test files a PR removes — `removed` only; a rename is not a
 *  deletion and a deleted non-test file is not this detector's business. */
export function removedTestFiles(files: PrFileEntry[]): string[] {
  return files
    .filter(f => f.status === 'removed' && isTestFilePath(f.filename))
    .map(f => f.filename)
}

/**
 * TEST_FILE_DELETED: the current criterion (LUM-779) is "is a tracked test
 * file actually missing". Old rows carry no local-git probe, so the durable,
 * external answer is the task's linked PRs: if no linked PR removes a tracked
 * test file, the deletion the command looked like never landed anywhere —
 * the same evidence the detector records as advisory today. Any PR that does
 * remove one keeps the row blocking (evidence names the files). No PR, or a
 * PR whose file list could not be read → UNDECIDABLE, untouched.
 */
export function rejudgeTestFileDeleted(
  row: TestFileDeletedRow,
  prs: PrFileList[]
): RejudgeVerdict {
  const criterionVersion = REJUDGE_CRITERION_VERSION.TEST_FILE_DELETED
  if (isEvasionDecoded(row.detail)) {
    return {
      outcome: 'UNDECIDABLE',
      reason: 'EVASION_DECODED',
      evidence:
        'the command was only visible after decoding an obfuscated payload — deliberate obfuscation is never re-judged',
      criterionVersion,
    }
  }
  if (prs.length === 0) {
    return {
      outcome: 'UNDECIDABLE',
      reason: 'NO_LINKED_PR',
      evidence:
        'the task has no linked pull request — nothing external can say whether a tracked test file is missing',
      criterionVersion,
    }
  }
  const unreadable = prs.filter(p => p.files == null).map(p => `#${p.number}`)
  if (unreadable.length > 0) {
    return {
      outcome: 'UNDECIDABLE',
      reason: 'PR_FILES_UNREADABLE',
      evidence: `the file list of linked PR ${unreadable.join(', ')} could not be read — not judged`,
      criterionVersion,
    }
  }
  const removed = prs.flatMap(p =>
    removedTestFiles(p.files ?? []).map(f => `${f} (PR #${p.number})`)
  )
  if (removed.length > 0) {
    return {
      outcome: 'STILL_HOLDS',
      reason: 'TEST_FILE_REMOVED_IN_PR',
      evidence: `a linked PR removes a tracked test file: ${removed.join(', ')}`,
      criterionVersion,
    }
  }
  const prList = prs.map(p => `#${p.number}`).join(', ')
  return {
    outcome: 'CAUSE_GONE',
    reason: 'NO_TEST_FILE_REMOVED',
    evidence: `no linked PR (${prList}) removes a tracked test file`,
    criterionVersion,
    write: {
      severity: row.severity,
      detail: clip(
        `No linked PR removes a tracked test file (re-judged against PR ${prList}, LUM-780) — advisory — ${row.detail}`
      ),
    },
  }
}
