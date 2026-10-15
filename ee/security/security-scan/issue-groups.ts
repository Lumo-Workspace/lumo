/**
 * PURE — LUM-1200: one issue on one line gets one Lumo thread.
 *
 * The AI review (`vuln:<kind>`) and the exploit-path hunt (`hunt:<category>`)
 * look at the same diff independently and keep their own fingerprints
 * (`judgeFindingFingerprint` vs the hunt's), so the same bug used to get two
 * inline threads (production: probe PR 51, `src/probe/run.ts:5`,
 * `vuln:command_injection` and `hunt:injection`). This module decides which
 * findings are the same issue — same file, same line, different layer,
 * overlapping vulnerability class — and which one of them keeps the thread.
 *
 * It is a grouping key computed at write-back time, NOT a fingerprint change:
 * threads, learnings, auto-resolve and reopen stay keyed on each finding's
 * own fingerprint, and both findings stay recorded. The merged finding is
 * listed in the kept finding's comment instead of getting its own.
 *
 * Standing: the kept finding is chosen blocking-first, so if either finding
 * blocks DONE the kept thread does. (Both layers are LLM_JUDGE, which no
 * policy lets block DONE today; the rule holds if that ever changes.)
 */
type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface GroupableFinding {
  fingerprint: string
  ruleId: string
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  filePath: string
  line: number | null
  severity: Severity
}

/** The AI review kinds that the hunt's `injection` category covers (CWE-74 family). */
const INJECTION_KINDS = [
  'sql_injection',
  'command_injection',
  'xss',
  'path_traversal',
  'unsafe_eval',
] as const

/** Hunt category → the AI review kinds it can describe. Unlisted → its own class. */
const HUNT_CATEGORY_CLASSES: Readonly<Record<string, readonly string[]>> = {
  injection: INJECTION_KINDS,
  ssrf: ['ssrf'],
  idor: ['authz_logic', 'auth_bypass'],
}

const NO_CLASS: ReadonlySet<string> = new Set()

/**
 * The vulnerability classes a rule id stands for, in the AI review's kind
 * vocabulary. Only the two LLM layers have one: correctness findings
 * (`review:`), secrets and external-tool rules are never grouped.
 */
export function issueClasses(ruleId: string): ReadonlySet<string> {
  if (ruleId.startsWith('vuln:')) return new Set([ruleId.slice(5)])
  if (ruleId.startsWith('hunt:')) {
    const category = ruleId.slice(5)
    return new Set(HUNT_CATEGORY_CLASSES[category] ?? [`hunt:${category}`])
  }
  return NO_CLASS
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
}

export interface IssueGroups<F extends GroupableFinding> {
  /** Merged fingerprint → the fingerprint that keeps the thread. */
  mergedInto: Map<string, string>
  /** Kept fingerprint → the findings listed under its thread. */
  mergedOf: Map<string, F[]>
}

function overlaps(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

/**
 * Group `findings` (the write-back's inline candidates) into issues. Within
 * each file + line, findings are ranked — blocking first (stricter standing),
 * then already on the PR (the thread people are reading stays), then
 * severity, then the AI review before the hunt, then fingerprint — and each
 * joins the first better-ranked group whose kept finding is from the other
 * layer with an overlapping class, holding at most one finding per layer (so
 * two different AI-review classes are never joined through one broad hunt
 * category). A finding that already has its own thread is never merged.
 */
export function groupSameIssue<F extends GroupableFinding>(
  findings: readonly F[],
  opts: IssueGroupOptions<F>
): IssueGroups<F> {
  const out: IssueGroups<F> = { mergedInto: new Map(), mergedOf: new Map() }
  const buckets = new Map<string, F[]>()
  for (const f of findings) {
    if (f.provenance !== 'LLM_JUDGE' || f.line === null) continue
    if (issueClasses(f.ruleId).size === 0) continue
    const key = `${f.filePath}\u0000${f.line}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(f)
    else buckets.set(key, [f])
  }
  const rank = (f: F) => ({
    blocking: opts.isBlocking(f) ? 1 : 0,
    posted: opts.posted.has(f.fingerprint) ? 1 : 0,
  })
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    const ranked = [...bucket].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      return (
        rb.blocking - ra.blocking ||
        rb.posted - ra.posted ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (layer(a) === layer(b) ? 0 : layer(a) === 'judge' ? -1 : 1) ||
        (a.fingerprint < b.fingerprint
          ? -1
          : a.fingerprint > b.fingerprint
            ? 1
            : 0)
      )
    })
    const groups: Array<{ kept: F; members: F[] }> = []
    for (const f of ranked) {
      const group = opts.posted.has(f.fingerprint)
        ? undefined
        : groups.find(
            g =>
              g.members.every(m => layer(m) !== layer(f)) &&
              overlaps(issueClasses(g.kept.ruleId), issueClasses(f.ruleId))
          )
      if (!group) {
        groups.push({ kept: f, members: [f] })
        continue
      }
      group.members.push(f)
      out.mergedInto.set(f.fingerprint, group.kept.fingerprint)
      const listed = out.mergedOf.get(group.kept.fingerprint)
      if (listed) listed.push(f)
      else out.mergedOf.set(group.kept.fingerprint, [f])
    }
  }
  return out
}
