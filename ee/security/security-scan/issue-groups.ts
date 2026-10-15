/**
 * PURE — LUM-1200: one issue gets one Lumo thread.
 *
 * The AI review (`vuln:<kind>` / `review:<kind>`) and the exploit-path hunt
 * (`hunt:<category>`) look at the same diff independently and keep their own
 * fingerprints (`judgeFindingFingerprint` vs the hunt's), so the same bug
 * used to get two inline threads (production: probe PR 51,
 * `src/probe/run.ts:5`, `vuln:command_injection` and `hunt:injection`; probe
 * PR 60, `hunt:logic` at L13 / L20 beside the AI review's L14 / L19). This
 * module decides which findings are the same issue — the same file, the
 * other layer, and the same issue as `sameIssueScore` (finding-successor.ts)
 * reads it: the same line with a compatible class, or a line within its
 * window with a similar title — and which one of them keeps the thread.
 *
 * It is a grouping key computed at write-back time, NOT a fingerprint change:
 * threads, learnings, auto-resolve and reopen stay keyed on each finding's
 * own fingerprint, and both findings stay recorded. The merged finding is
 * listed in the kept finding's comment instead of getting its own.
 *
 * Standing: the kept finding is chosen blocking-first, so if either finding
 * blocks DONE the kept thread does. A thread a human resolved absorbs the
 * other layer's report of its issue (it stays resolved) only when that report
 * neither blocks DONE nor is more severe — the LUM-1127 carry rule.
 */
import { sameIssueScore } from '@/ee/security/security-scan/finding-successor'
import { issueClasses } from '@/ee/security/security-scan/issue-classes'

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

function layer(f: GroupableFinding): 'judge' | 'hunt' {
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
 * Group `findings` (the write-back's inline candidates) into issues. Within
 * each file, findings are ranked — blocking first (stricter standing), then
 * already on the PR (the thread people are reading stays), then severity,
 * then the AI review before the hunt, then line, then fingerprint — and each
 * joins the better-ranked group whose kept finding is the same issue from the
 * other layer (`sameIssueScore`, best score first), holding at most one
 * finding per layer (so two different AI-review issues are never joined
 * through one broad hunt finding). A finding that already has its own thread
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
          if (g.members.some(m => layer(m) === layer(f))) continue
          if (
            resolved.has(g.kept.fingerprint) &&
            (opts.isBlocking(f) ||
              SEVERITY_RANK[f.severity] > SEVERITY_RANK[g.kept.severity])
          )
            continue
          const score = sameIssueScore(identity(g.kept), identity(f))
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
