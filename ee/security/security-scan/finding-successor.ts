/**
 * PURE — LUM-1127 follow-up: is a finding the model reports on the new head
 * the same issue as one Lumo already has a thread for, under a new
 * fingerprint?
 *
 * The AI review's fingerprint (`judgeFindingFingerprint`) is rule id + file +
 * the quoted evidence line. A full re-review can label the same issue with a
 * different rule id (production: probe PR 52, `scripts/probe.ts:3`, "console.log
 * used in scripts" was `review:doc_mismatch` on one review and
 * `review:api_misuse` on the next), so the old fingerprint looked fixed and
 * Lumo resolved a thread whose finding was still being reported.
 *
 * This is a rule-id-tolerant identity used only to decide that an absent
 * fingerprint is NOT fixed — it is never written as a fingerprint, so
 * dispositions, learnings and thread rows stay keyed on each finding's own
 * fingerprint. Two findings are the same issue when, in the same file and
 * from comparable layers:
 *
 *   · they sit on the same code — the same quoted evidence line (code moved
 *     by other edits keeps it) or the same line number — and are of the same
 *     kind (same rule, or overlapping vulnerability classes as LUM-1200's
 *     `issueClasses` groups them) or carry a similar title; or
 *   · they sit within `SUCCESSOR_LINE_WINDOW` lines of each other and carry a
 *     similar title.
 *
 * Comparable layers: the same layer (AI review / exploit-path hunt), or the
 * other layer with an overlapping class (the LUM-1200 cross-layer notion).
 * Each earlier finding is matched to at most one current finding and vice
 * versa, best match first.
 */
import { issueClasses } from '@/ee/security/security-scan/issue-groups'

export interface FindingIdentity {
  fingerprint: string
  ruleId: string
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  filePath: string
  line: number | null
  title: string
  /** The quoted (redacted) evidence line; null = not known. */
  evidence: string | null
}

/** Lines apart two findings may sit and still be one issue (with a similar title). */
export const SUCCESSOR_LINE_WINDOW = 3

/** Title-word overlap (Jaccard) from which two titles describe one issue. */
export const SUCCESSOR_TITLE_SIMILARITY = 0.5

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
])

function titleWords(title: string): Set<string> {
  const out = new Set<string>()
  for (const raw of title.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length === 0 || STOP_WORDS.has(raw)) continue
    // A light plural fold: "errors" / "error", "swallows" / "swallow".
    out.add(raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw)
  }
  return out
}

/** Jaccard overlap of the two titles' content words, 0…1. */
export function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a)
  const wb = titleWords(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return shared / (wa.size + wb.size - shared)
}

function normEvidence(e: string | null): string {
  return (e ?? '').replace(/\s+/g, ' ').trim()
}

function layer(ruleId: string): 'hunt' | 'judge' {
  return ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

function classesOverlap(a: string, b: string): boolean {
  const cb = issueClasses(b)
  for (const c of issueClasses(a)) if (cb.has(c)) return true
  return false
}

/**
 * How strongly `next` continues `prev` as the same issue; null = it does not.
 * Higher is a better match (used to pick one successor per finding).
 */
export function sameIssueScore(
  prev: FindingIdentity,
  next: FindingIdentity
): number | null {
  if (prev.provenance !== 'LLM_JUDGE' || next.provenance !== 'LLM_JUDGE')
    return null
  if (prev.filePath !== next.filePath) return null
  const sameRule = prev.ruleId === next.ruleId
  const overlap = classesOverlap(prev.ruleId, next.ruleId)
  if (layer(prev.ruleId) !== layer(next.ruleId) && !overlap) return null

  const ev = normEvidence(prev.evidence)
  const sameEvidence = ev.length > 0 && ev === normEvidence(next.evidence)
  const distance =
    prev.line !== null && next.line !== null
      ? Math.abs(prev.line - next.line)
      : null
  const sameCode = sameEvidence || distance === 0
  const near =
    sameCode || (distance !== null && distance <= SUCCESSOR_LINE_WINDOW)
  const similarity = titleSimilarity(prev.title, next.title)
  const similar = similarity >= SUCCESSOR_TITLE_SIMILARITY
  const sameKind = sameRule || overlap

  const match = (sameCode && (sameKind || similar)) || (near && similar)
  if (!match) return null
  return (
    (sameEvidence ? 4 : 0) +
    (distance === 0 ? 2 : 0) +
    (sameKind ? 1 : 0) +
    similarity -
    (distance ?? SUCCESSOR_LINE_WINDOW) / 100
  )
}

/**
 * Pair each earlier finding with the current finding that continues it, if
 * any: earlier fingerprint → current fingerprint, one-to-one, best score
 * first (ties by fingerprint, so the result does not depend on input order).
 */
export function matchSuccessors(
  previous: readonly FindingIdentity[],
  current: readonly FindingIdentity[]
): Map<string, string> {
  const pairs: Array<{ prev: string; next: string; score: number }> = []
  for (const p of previous)
    for (const n of current) {
      if (p.fingerprint === n.fingerprint) continue
      const score = sameIssueScore(p, n)
      if (score !== null)
        pairs.push({ prev: p.fingerprint, next: n.fingerprint, score })
    }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      (a.prev < b.prev ? -1 : a.prev > b.prev ? 1 : 0) ||
      (a.next < b.next ? -1 : a.next > b.next ? 1 : 0)
  )
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const { prev, next } of pairs) {
    if (out.has(prev) || taken.has(next)) continue
    out.set(prev, next)
    taken.add(next)
  }
  return out
}
