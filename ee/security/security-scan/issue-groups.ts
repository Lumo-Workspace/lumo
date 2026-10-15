/**
 * PURE — LUM-1200: one issue gets one Lumo thread.
 *
 * The AI review (`vuln:<kind>` / `review:<kind>`) and the exploit-path hunt
 * (`hunt:<category>`) look at the same diff independently and keep their own
 * fingerprints (`judgeFindingFingerprint` vs the hunt's), so the same bug
 * used to get two inline threads (production: probe PR 51,
 * `src/probe/run.ts:5`, `vuln:command_injection` and `hunt:injection`; probe
 * PR 60, `hunt:logic` at L13 / L20 beside the AI review's L14 / L19). This
 * module decides which findings are the same issue — the same file, and the
 * same issue as `sameIssueScore` (finding-successor.ts) reads it: the same
 * line with a compatible class, a line within its window with a similar
 * title, or — across the two layers — a line within its window with a
 * compatible class (LUM-1200 follow-up #3) — and which one of them keeps the
 * thread.
 *
 * It is a grouping key computed at write-back time, NOT a fingerprint change:
 * threads, learnings, auto-resolve and reopen stay keyed on each finding's
 * own fingerprint, and both findings stay recorded. The merged finding is
 * listed in the kept finding's comment instead of getting its own.
 *
 * Limitation (LUM-1200 follow-up #2): never across files. A hunt finding is
 * placed at its sink; its call chain is stored as symbol names only, and its
 * entry's file:line only as text inside the (clipped) detail — nothing
 * structured says where in another file the chain starts, so an AI-review
 * finding at the source (probe PR 63: `src/server.ts:39`) and the hunt's
 * report of it at the sink (`src/services/session-store.ts:11`) keep two
 * threads rather than be matched on a guess.
 *
 * Standing: the kept finding is chosen blocking-first, so if either finding
 * blocks DONE the kept thread does. A thread a human resolved absorbs the
 * other layer's report of its issue (it stays resolved) only when that report
 * neither blocks DONE nor is more severe — the LUM-1127 carry rule.
 */
import {
  SUCCESSOR_LINE_WINDOW,
  sameIssueScore,
  type FindingIdentity,
} from '@/ee/security/security-scan/finding-successor'
import {
  classMatch,
  issueClasses,
} from '@/ee/security/security-scan/issue-classes'

export {
  classMatch,
  issueClasses,
} from '@/ee/security/security-scan/issue-classes'

type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface GroupableFinding {
  fingerprint: string
  ruleId: string
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  filePath: string
  line: number | null
  severity: Severity
  title: string
  /** The quoted evidence line; absent / null = not known. */
  evidence?: string | null
}

function layer(f: { ruleId: string }): 'judge' | 'hunt' {
  return f.ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

const SEVERITY_RANK: Record<Severity, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}

export interface IssueGroupOptions<F extends GroupableFinding> {
  /** Fingerprints that already have a Lumo comment on the PR. */
  posted: ReadonlySet<string>
  isBlocking: (f: F) => boolean
  /**
   * Fingerprints whose thread a human resolved. Another layer's report of
   * the same issue joins such a thread (and stays resolved with it) only
   * when it neither blocks DONE nor is more severe. Absent = none.
   */
  resolvedByUser?: ReadonlySet<string>
}

export interface IssueGroups<F extends GroupableFinding> {
  /** Merged fingerprint → the fingerprint that keeps the thread. */
  mergedInto: Map<string, string>
  /** Kept fingerprint → the findings listed under its thread. */
  mergedOf: Map<string, F[]>
}

function identity(f: GroupableFinding) {
  return {
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    severity: f.severity,
    evidence: f.evidence ?? null,
  }
}

/**
 * The best `sameIssueScore` of `f` against a group; null when it is the same
 * issue as none of it. LUM-1200 follow-up #2: the hunt runs several tasks
 * over one diff and two of them can report the same issue (production: probe
 * PR 64, `parseQuantity` reported twice by `hunt:logic` at L11 beside the AI
 * review's L13, the second worded unlike the AI review) — the second report
 * finds the thread through the first. Against the kept finding the full
 * rule applies; against another member only on the same code (same line or
 * quoted evidence), so a chain of nearby reports never walks a group across
 * distinct issues (L13 → L11 → L9).
 */
function bestScoreAgainst<F extends GroupableFinding>(
  g: { kept: F; members: readonly F[] },
  f: F
): number | null {
  let best: number | null = null
  for (const m of g.members) {
    if (m !== g.kept && !sameCode(m, f)) continue
    const score = sameIssueScore(identity(m), identity(f))
    if (score !== null && (best === null || score > best)) best = score
  }
  return best
}

function sameCode(a: GroupableFinding, b: GroupableFinding): boolean {
  if (a.line !== null && a.line === b.line) return true
  const ea = (a.evidence ?? '').replace(/\s+/g, ' ').trim()
  return ea.length > 0 && ea === (b.evidence ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Group `findings` (the write-back's inline candidates) into issues. Within
 * each file, findings are ranked — blocking first (stricter standing), then
 * already on the PR (the thread people are reading stays), then severity,
 * then the AI review before the hunt, then line, then fingerprint — and each
 * joins the better-ranked group holding a finding that is the same issue
 * (`sameIssueScore` against the kept finding, or against another member on
 * the same code — `bestScoreAgainst` — best score first). A group holds at
 * most one AI-review finding (so two different AI-review issues are never
 * joined through one broad hunt finding) but any number of hunt reports of
 * its issue — all listed in the one thread (LUM-1200 follow-up #2: two hunt
 * tasks reporting one issue got a second thread). A finding that already has
 * its own thread
 * is never merged; a human-resolved thread takes in only a finding that
 * neither blocks DONE nor is more severe.
 */
export function groupSameIssue<F extends GroupableFinding>(
  findings: readonly F[],
  opts: IssueGroupOptions<F>
): IssueGroups<F> {
  const out: IssueGroups<F> = { mergedInto: new Map(), mergedOf: new Map() }
  const resolved = opts.resolvedByUser ?? new Set<string>()
  const files = new Map<string, F[]>()
  for (const f of findings) {
    if (f.provenance !== 'LLM_JUDGE' || f.line === null) continue
    if (issueClasses(f.ruleId).size === 0) continue
    const bucket = files.get(f.filePath)
    if (bucket) bucket.push(f)
    else files.set(f.filePath, [f])
  }
  const rank = (f: F) => ({
    blocking: opts.isBlocking(f) ? 1 : 0,
    posted: opts.posted.has(f.fingerprint) ? 1 : 0,
  })
  for (const bucket of files.values()) {
    if (bucket.length < 2) continue
    const ranked = [...bucket].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      return (
        rb.blocking - ra.blocking ||
        rb.posted - ra.posted ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (layer(a) === layer(b) ? 0 : layer(a) === 'judge' ? -1 : 1) ||
        (a.line ?? 0) - (b.line ?? 0) ||
        (a.fingerprint < b.fingerprint
          ? -1
          : a.fingerprint > b.fingerprint
            ? 1
            : 0)
      )
    })
    const groups: Array<{ kept: F; members: F[] }> = []
    for (const f of ranked) {
      let best: { kept: F; members: F[] } | undefined
      let bestScore = -Infinity
      if (!opts.posted.has(f.fingerprint))
        for (const g of groups) {
          // One AI-review finding per group: the AI review names each issue
          // once, so two of its findings are two issues — never joined, not
          // even through a broad hunt finding both resemble.
          if (layer(f) === 'judge' && g.members.some(m => layer(m) === 'judge'))
            continue
          if (
            resolved.has(g.kept.fingerprint) &&
            (opts.isBlocking(f) ||
              SEVERITY_RANK[f.severity] > SEVERITY_RANK[g.kept.severity])
          )
            continue
          const score = bestScoreAgainst(g, f)
          if (score !== null && score > bestScore) {
            best = g
            bestScore = score
          }
        }
      if (!best) {
        groups.push({ kept: f, members: [f] })
        continue
      }
      best.members.push(f)
      out.mergedInto.set(f.fingerprint, best.kept.fingerprint)
      const listed = out.mergedOf.get(best.kept.fingerprint)
      if (listed) listed.push(f)
      else out.mergedOf.set(best.kept.fingerprint, [f])
    }
  }
  return out
}

/**
 * LUM-1200 follow-up #2 — is the issue an open thread stands for still
 * reported, although its own fingerprint is gone? Production (probe PR 64
 * @4cb6b57): a full re-review on the same head reworded the hunt's
 * `parseQuantity` report, the AI review still reported the issue (its thread
 * took the AI review's relabelled finding), and Lumo marked the hunt's
 * thread "✅ Addressed" — the issue was not fixed.
 *
 * True when a current finding is the same issue (`sameIssueScore`) and
 * either the thread is the hunt's — any layer's report of its issue keeps it
 * open, the hunt's own rewording included — or the report comes from the
 * other layer (the issue's group). Two AI-review threads of one issue stay
 * the LUM-1127 rule: the one whose finding is gone is addressed. `current`
 * must hold only findings still reported (not verifier-rejected).
 *
 * The other layer's report needs no similar title — a compatible class within
 * the line window is enough, as for grouping (LUM-1200 follow-up #3:
 * production, probe PR 65, the hunt's thread at `src/server.ts:42` was marked
 * addressed on the same head while the AI review still reported the issue
 * at L41).
 */
export function stillReportedElsewhere(
  prev: FindingIdentity,
  current: readonly FindingIdentity[]
): boolean {
  return current.some(
    c =>
      c.fingerprint !== prev.fingerprint &&
      (layer(prev) === 'hunt' || layer(c) !== layer(prev)) &&
      sameIssueScore(prev, c) !== null
  )
}

/** How far past `SUCCESSOR_LINE_WINDOW` a cross-layer pair is still reported as a near miss. */
export const CROSS_LAYER_NEAR_MISS_LINES = 10

export interface CrossLayerNearMiss {
  judgeRuleId: string
  huntRuleId: string
  distance: number
}

/**
 * LUM-1200 follow-up #3 — AI-review / hunt pairs in one file with related
 * classes that sit just outside the same-issue window (more than
 * `SUCCESSOR_LINE_WINDOW`, at most `CROSS_LAYER_NEAR_MISS_LINES` lines
 * apart), so they keep two threads. Production (probe PR 66): the hunt's
 * `orderTotal` report at L20 beside the AI review's `parseQuantity` at L13.
 * Not grouped — reported only, so the window can be tuned on real pairs.
 * A hunt finding already grouped with the AI review is left out.
 */
export function crossLayerNearMisses(
  findings: readonly GroupableFinding[],
  mergedInto: ReadonlyMap<string, string>
): CrossLayerNearMiss[] {
  const out: CrossLayerNearMiss[] = []
  const llm = findings.filter(
    f => f.provenance === 'LLM_JUDGE' && f.line !== null
  )
  for (const h of llm) {
    if (layer(h) !== 'hunt') continue
    for (const j of llm) {
      if (layer(j) !== 'judge' || j.filePath !== h.filePath) continue
      if (
        mergedInto.get(h.fingerprint) === j.fingerprint ||
        mergedInto.get(j.fingerprint) === h.fingerprint
      )
        continue
      const distance = Math.abs(j.line! - h.line!)
      if (
        distance <= SUCCESSOR_LINE_WINDOW ||
        distance > CROSS_LAYER_NEAR_MISS_LINES ||
        classMatch(j.ruleId, h.ruleId) === null
      )
        continue
      out.push({ judgeRuleId: j.ruleId, huntRuleId: h.ruleId, distance })
    }
  }
  return out
}
