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
 *     kind (same rule, or overlapping issue classes — `classMatch` `exact`)
 *     or carry a similar title; or
 *   · they sit within `SUCCESSOR_LINE_WINDOW` lines of each other and carry a
 *     similar title; or
 *   · they come from different layers (AI review ↔ exploit-path hunt) with
 *     related classes and sit within `SUCCESSOR_LINE_WINDOW` lines of each
 *     other — no title needed (LUM-1200 follow-up #3).
 *
 *   · (LUM-1127 follow-up #4, across rounds only — `acrossRounds`) they come
 *     from the same layer and sit on the same code: one issue whatever the
 *     rule id or class — unless a distinct finding of that layer was reported
 *     on that line in the same round (`crowded`, on either side), when the
 *     rules above decide. Production (probe PR 67, `src/server.ts:31`): one
 *     route issue reported as `review:logic_error` and `review:api_misuse`
 *     on an unchanged head, worded four ways.
 *
 * A thread keeps every identity it has carried (`history`, LUM-1127
 * follow-up #4): an earlier finding is matched by the best score over all of
 * them, so one rewording that shares little with the next never decides.
 *
 * Comparable layers: the same layer (AI review / exploit-path hunt), or the
 * other layer with related classes (`classMatch`: overlapping, or a broad
 * hunt category such as `hunt:logic`). Across layers the title is not
 * compared: the hunt states an exploit as a long sentence and the AI review
 * names the issue in a few words, so they share two words at best
 * (production, probe PR 65: "Unauthenticated session creation for any user
 * name" at `src/server.ts:41` and the hunt's 15-word claim at L42 opened two
 * threads; probe PR 66: `DISCOUNTS[code]` at L7 / L6). Within one layer the
 * title still decides — one layer can report two distinct issues on
 * adjacent lines. LUM-1200 groups the two layers' reports of one issue with
 * this same score (`groupSameIssue`), and keeps a thread open while the
 * other layer still reports its issue (`stillReportedElsewhere`).
 * Each earlier finding is matched to at most one current finding and vice
 * versa, best match first.
 */
import { createHash, createHmac } from 'node:crypto'
import { classMatch } from '@/ee/security/security-scan/issue-classes'

export interface FindingIdentity {
  fingerprint: string
  ruleId: string
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  filePath: string
  line: number | null
  title: string
  /** Absent = not known. */
  severity?: 'LOW' | 'MEDIUM' | 'HIGH'
  /** The quoted (redacted) evidence line; null = not known. */
  evidence: string | null
  /**
   * LUM-1127 follow-up #2 — a stored identity keeps no code: the quoted line
   * as `evidenceHash` and the title as `titleTokens` (`hashIdentity`, keyed).
   * When present they stand in for `evidence` / `title`; both sides of a
   * comparison must then be hashed with the same key.
   */
  evidenceHash?: string | null
  titleTokens?: readonly string[]
  /**
   * LUM-1127 follow-up #4 — the other identities the thread has carried
   * (hashed, oldest first); matched too, the best score wins. Absent = none.
   */
  history?: readonly IdentityVariant[]
  /**
   * LUM-1127 follow-up #4 — a distinct finding of the same layer was reported
   * on this identity's line in one round (a thread's history, or another
   * current finding): the same line alone no longer makes it the same issue.
   */
  crowded?: boolean
}

/**
 * LUM-1127 follow-up #4 — one identity a thread has carried, as stored:
 * hashes only (`evidenceHash` / `titleTokens`), never code or wording.
 */
export interface IdentityVariant {
  ruleId: string
  line: number | null
  evidenceHash: string | null
  titleTokens: readonly string[]
  /** Another finding of its layer sat on its line in that round. */
  crowded?: boolean
}

/**
 * How many identities a thread keeps: the first (what was posted) and the
 * most recent ones. A model rewords one issue a handful of ways; the cap
 * only bounds the row.
 */
export const IDENTITY_HISTORY_CAP = 12

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i])

/**
 * The history with `v` added: the union, oldest first. A variant already
 * held (same rule, line and title words, and no conflicting evidence hash)
 * is not added again — it only gains `crowded` and a missing evidence hash.
 * Over `IDENTITY_HISTORY_CAP` the oldest after the first are dropped. Pure.
 */
export function addIdentityVariant(
  history: readonly IdentityVariant[],
  v: IdentityVariant
): IdentityVariant[] {
  const out = history.map(h => ({ ...h }))
  const same = out.find(
    h =>
      h.ruleId === v.ruleId &&
      h.line === v.line &&
      sameList([...h.titleTokens].sort(), [...v.titleTokens].sort()) &&
      (h.evidenceHash === null ||
        v.evidenceHash === null ||
        h.evidenceHash === v.evidenceHash)
  )
  if (same) {
    if (same.evidenceHash === null && v.evidenceHash !== null)
      same.evidenceHash = v.evidenceHash
    if (v.crowded) same.crowded = true
    return out
  }
  out.push({
    ruleId: v.ruleId,
    line: v.line,
    evidenceHash: v.evidenceHash,
    titleTokens: [...v.titleTokens],
    ...(v.crowded ? { crowded: true } : {}),
  })
  return out.length > IDENTITY_HISTORY_CAP
    ? [out[0]!, ...out.slice(out.length - (IDENTITY_HISTORY_CAP - 1))]
    : out
}

/**
 * Fingerprints of the LLM-layer findings that share their layer, file and
 * line with another one: reported together in one round, the same line does
 * not make them one issue (`crowded`). Pure.
 */
export function crowdedFingerprints(
  findings: ReadonlyArray<
    Pick<
      FindingIdentity,
      'fingerprint' | 'ruleId' | 'provenance' | 'filePath' | 'line'
    >
  >
): Set<string> {
  const at = new Map<string, string[]>()
  for (const f of findings) {
    if (f.provenance !== 'LLM_JUDGE' || f.line === null) continue
    const k = JSON.stringify([layer(f.ruleId), f.filePath, f.line])
    const list = at.get(k)
    if (list) list.push(f.fingerprint)
    else at.set(k, [f.fingerprint])
  }
  const out = new Set<string>()
  for (const fps of at.values())
    if (new Set(fps).size > 1) for (const fp of fps) out.add(fp)
  return out
}

/** Options of the same-issue match. */
export interface SameIssueOptions {
  /**
   * `prev` is a thread's identity from an earlier round and `next` a finding
   * of this one: the same layer on the same code is one issue
   * (LUM-1127 follow-up #4). Off for findings of one round (grouping).
   */
  acrossRounds?: boolean
}

/**
 * Lines apart two findings may sit and still be one issue (inclusive): with
 * a similar title, or — across layers — with related classes.
 */
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

/** Shared content words from which the shorter title's coverage counts. */
const MIN_SHARED_WORDS = 3

/**
 * `titleSimilarity` over two word sets — plain words, or their hashes
 * (`titleTokens`): hashing keeps the counts, so the score is the same.
 */
function wordSimilarity(
  wa: ReadonlySet<string>,
  wb: ReadonlySet<string>
): number {
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  const jaccard = shared / (wa.size + wb.size - shared)
  const coverage =
    shared >= MIN_SHARED_WORDS ? shared / Math.min(wa.size, wb.size) : 0
  return Math.max(jaccard, coverage)
}

/**
 * How alike two titles are, 0…1: the Jaccard overlap of their content
 * words, or — once they share `MIN_SHARED_WORDS` — the share of the shorter
 * title's words the other holds, whichever is higher. The hunt states its
 * claim as a long sentence while the AI review names the issue in a few
 * words (probe PR 60: "Session token generated with Math.random despite
 * comment claiming CSPRNG" vs a 16-word hunt claim sharing five of its nine
 * words — Jaccard 0.25), so Jaccard alone never matched the two layers.
 */
export function titleSimilarity(a: string, b: string): number {
  return wordSimilarity(titleWords(a), titleWords(b))
}

/**
 * The id of an identity key: tags every keyed hash, so a hash made with
 * another key (a rotated secret) is recognised instead of silently failing
 * to match.
 */
export function identityKeyId(key: string): string {
  return createHash('sha256')
    .update(`lumo-finding-identity-key:${key}`)
    .digest('hex')
    .slice(0, 8)
}

const keyed = (key: string, text: string, length: number): string =>
  `${identityKeyId(key)}.${createHmac('sha256', `lumo-finding-identity:${key}`)
    .update(text)
    .digest('hex')
    .slice(0, length)}`

/**
 * A title's content words, each keyed-hashed (sorted, deduplicated): what a
 * thread row stores so the title can be compared (`titleSimilarity` gives
 * the same overlap on these — hashing keeps the counts) without keeping the
 * model's wording of customer code. Keyed (HMAC with a server secret): one
 * word alone is too guessable for a plain hash.
 */
export function titleTokens(title: string, key: string): string[] {
  return [
    ...new Set([...titleWords(title)].map(w => keyed(key, `w:${w}`, 16))),
  ].sort()
}

function normEvidence(evidence: string | null): string {
  return (evidence ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * The quoted evidence line, whitespace-normalised (as the AI review's
 * fingerprint normalises it) and keyed-hashed. Null when nothing was quoted.
 */
export function evidenceHash(
  evidence: string | null,
  key: string
): string | null {
  const line = normEvidence(evidence)
  return line.length === 0 ? null : keyed(key, `e:${line}`, 32)
}

/** Was every hash of this stored identity made with `key`? */
export function isKeyedWith(
  hashes: { evidenceHash: string | null; titleTokens: readonly string[] },
  key: string
): boolean {
  const prefix = `${identityKeyId(key)}.`
  return (
    (hashes.evidenceHash === null || hashes.evidenceHash.startsWith(prefix)) &&
    hashes.titleTokens.every(t => t.startsWith(prefix))
  )
}

/**
 * The identity in its stored (hashed) form, for comparing with stored ones.
 * Hashes once per identity — not once per compared pair.
 */
export function hashIdentity(f: FindingIdentity, key: string): FindingIdentity {
  if (f.titleTokens !== undefined && f.evidenceHash !== undefined) return f
  return {
    ...f,
    title: '',
    evidence: null,
    evidenceHash: f.evidenceHash ?? evidenceHash(f.evidence, key),
    titleTokens: f.titleTokens ?? titleTokens(f.title, key),
  }
}

/** Plain identities compare their text; hashed ones their hashes. */
const evidenceKeyOf = (f: FindingIdentity): string | null => {
  if (f.evidenceHash !== undefined) return f.evidenceHash
  const line = normEvidence(f.evidence)
  return line.length === 0 ? null : line
}

const titleKeyOf = (f: FindingIdentity): ReadonlySet<string> =>
  f.titleTokens !== undefined ? new Set(f.titleTokens) : titleWords(f.title)

function layer(ruleId: string): 'hunt' | 'judge' {
  return ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

/** One stored variant read as an identity of the same thread. */
function variantIdentity(
  prev: FindingIdentity,
  v: IdentityVariant
): FindingIdentity {
  return {
    fingerprint: prev.fingerprint,
    ruleId: v.ruleId,
    provenance: prev.provenance,
    filePath: prev.filePath,
    line: v.line,
    title: '',
    evidence: null,
    evidenceHash: v.evidenceHash,
    titleTokens: v.titleTokens,
    ...(prev.crowded ? { crowded: true } : {}),
  }
}

/**
 * How strongly `next` continues `prev` as the same issue; null = it does not.
 * Higher is a better match (used to pick one successor per finding). The
 * best over `prev` and every identity in its `history`.
 */
export function sameIssueScore(
  prev: FindingIdentity,
  next: FindingIdentity,
  opts: SameIssueOptions = {}
): number | null {
  let best = scoreOne(prev, next, opts)
  for (const v of prev.history ?? []) {
    const score = scoreOne(variantIdentity(prev, v), next, opts)
    if (score !== null && (best === null || score > best)) best = score
  }
  return best
}

function scoreOne(
  prev: FindingIdentity,
  next: FindingIdentity,
  opts: SameIssueOptions
): number | null {
  if (prev.provenance !== 'LLM_JUDGE' || next.provenance !== 'LLM_JUDGE')
    return null
  if (prev.filePath !== next.filePath) return null
  const sameRule = prev.ruleId === next.ruleId
  const classes = classMatch(prev.ruleId, next.ruleId)
  if (layer(prev.ruleId) !== layer(next.ruleId) && classes === null) return null

  const ev = evidenceKeyOf(prev)
  const sameEvidence = ev !== null && ev === evidenceKeyOf(next)
  const distance =
    prev.line !== null && next.line !== null
      ? Math.abs(prev.line - next.line)
      : null
  const sameCode = sameEvidence || distance === 0
  const near =
    sameCode || (distance !== null && distance <= SUCCESSOR_LINE_WINDOW)
  const similarity = wordSimilarity(titleKeyOf(prev), titleKeyOf(next))
  const similar = similarity >= SUCCESSOR_TITLE_SIMILARITY
  const sameKind = sameRule || classes === 'exact'

  // Different layers and related classes (checked above) on near lines.
  const crossLayerNear = layer(prev.ruleId) !== layer(next.ruleId) && near
  // LUM-1127 follow-up #4: a later round of the same layer on the same code.
  const sameLine =
    opts.acrossRounds === true &&
    layer(prev.ruleId) === layer(next.ruleId) &&
    sameCode &&
    !prev.crowded &&
    !next.crowded

  const match =
    sameLine ||
    (sameCode && (sameKind || similar)) ||
    (near && similar) ||
    crossLayerNear
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
  current: readonly FindingIdentity[],
  opts: SameIssueOptions = {}
): Map<string, string> {
  const pairs: Array<{ prev: string; next: string; score: number }> = []
  for (const p of previous)
    for (const n of current) {
      if (p.fingerprint === n.fingerprint) continue
      const score = sameIssueScore(p, n, opts)
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
