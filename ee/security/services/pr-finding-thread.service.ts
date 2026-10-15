/**
 * LUM-1127 — the lifecycle of Lumo's inline review threads:
 *
 *   · a fingerprint a COMPLETE pass of its own layer no longer reports on the
 *     new head → Lumo resolves the thread with "✅ Addressed in `<sha>`";
 *   · a human resolves the thread on GitHub → recorded (webhook, with a
 *     GraphQL read-back as the backstop) and never re-posted;
 *   · an addressed fingerprint reported again → the thread is unresolved with
 *     a regression note;
 *   · the comment went outdated but the finding is still reported → a fresh
 *     comment on the new line, the old thread resolved with a "moved" note;
 *   · an AI-layer fingerprint is gone but the same issue is reported under a
 *     new one (the model relabelled its rule id, or quoted another line —
 *     `matchSuccessors`) → the thread is carried over to the new finding:
 *     it stays open, with no "Addressed" note and no second comment. A
 *     thread a human resolved takes the new fingerprint over too (stays
 *     resolved, no reply) unless the new finding blocks DONE or is more
 *     severe; a thread Lumo addressed is re-raised (a regression).
 *     The carry is kept on the row (`aliasFingerprints`, LUM-1127 follow-up
 *     #3): a finding under any of a thread's fingerprints already has that
 *     thread — whether or not the review has finished — so a sync running
 *     mid-review never posts the relabelled finding as a second thread;
 *   · two Lumo threads for one issue (posted before the carry was kept) →
 *     merged: the older keeps the issue, the newer is resolved with a short
 *     "duplicate" note (never "Addressed").
 *
 * "Fixed" is strict: absence only counts when the layer that produced the
 * finding ran whole (`RAN` — never PARTIAL / PAUSED / PENDING / FAILED) on
 * this head and, for the incremental AI review, read the finding's file.
 * A GitHub resolve never touches a finding's disposition, so a gate-blocking
 * finding still blocks DONE (`isBlockingFinding`) until a human dispositions
 * it in Lumo; only non-blocking ones leave "open" when their thread is
 * resolved.
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*`, the
 * database through the repository. Best effort throughout: a thread failure
 * is logged and retried by the next sync, never thrown at the write-back.
 */
import { logger } from '@/lib/logger'
import {
  prCommentClient,
  type ListedComment,
} from '@/lib/integrations/github/pr-comment-client'
import {
  reviewThreadClient,
  type ReviewThreadState,
} from '@/lib/integrations/github/review-threads'
import {
  prFindingThreadRepository,
  type FindingThreadPatch,
  type FindingThreadRow,
  type FindingThreadState,
  type StoredThreadIdentity,
} from '@/ee/security/repositories/pr-finding-thread.repository'
import { threadFingerprints } from '@/ee/security/security-scan/thread-fingerprints'
import type {
  FindingKind,
  FindingProvenance,
  ReviewFindingRow,
  ScanStatus,
} from '@/ee/security/repositories/pr-security-scan.repository'
import type {
  ScanStageKey,
  ScanStages,
} from '@/ee/security/security-scan/types'
import { isVerifierRejected } from '@/ee/security/security-scan/verifier'
import {
  evidenceHash,
  hashIdentity,
  isKeyedWith,
  matchSuccessors,
  sameIssueScore,
  titleTokens,
  type FindingIdentity,
} from '@/ee/security/security-scan/finding-successor'

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Hidden marker on every Lumo thread note, so nothing mistakes it for a finding comment. */
export const THREAD_NOTE_MARKER = '<!-- lumo-security:thread-note -->'

const FP_MARKER_RE = /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/
const RETRACTED_MARKER = '<!-- lumo-security:verifier-rejected -->'

const short = (sha: string): string => sha.slice(0, 7)

export function buildAddressedNote(headSha: string): string {
  return `✅ Addressed in \`${short(headSha)}\` — Lumo's latest complete review of this file no longer reports this finding.\n\n${THREAD_NOTE_MARKER}`
}

export function buildRegressionNote(headSha: string): string {
  return `⚠️ Reappeared in \`${short(headSha)}\` — Lumo reports this finding again, so the thread is reopened.\n\n${THREAD_NOTE_MARKER}`
}

export function buildMovedNote(headSha: string): string {
  return `↪️ Moved in \`${short(headSha)}\` — the finding is still reported at a new line; continued in a new comment.\n\n${THREAD_NOTE_MARKER}`
}

/** LUM-1127 follow-up #3 — a second thread for an issue that already has one. */
export function buildDuplicateNote(keptCommentUrl: string): string {
  return `🔗 Duplicate — the same issue is tracked in [Lumo's earlier thread](${keptCommentUrl}), so this one is closed.\n\n${THREAD_NOTE_MARKER}`
}

/**
 * Lumo's own App account: `<slug>[bot]` (type `Bot` over REST). GraphQL's
 * `resolvedBy` types every account `User` — the bot included (LUM-1127 prod:
 * `uselumo[bot]` / `User`) — so a `[bot]` login counts as a bot whatever the
 * type says (a human login cannot contain brackets). Without the slug
 * configured (dev, tests) any bot counts: a bot resolving a thread is never
 * a human.
 */
export function isLumoActor(
  actor: { type?: string | null; login?: string | null } | null | undefined
): boolean {
  if (!actor) return false
  if (actor.type !== 'Bot' && !actor.login?.endsWith('[bot]')) return false
  const slug = process.env.GITHUB_APP_SLUG
  if (!slug) return true
  return actor.login === slug || actor.login === `${slug}[bot]`
}

/** The scan layer that produced a finding (and alone can say it is gone). */
export function layerOf(t: {
  ruleId: string
  provenance: FindingProvenance
  kind: FindingKind
}): ScanStageKey {
  if (t.provenance === 'DETERMINISTIC') return 'secrets'
  if (t.provenance === 'EXTERNAL_TOOL')
    return t.kind === 'DEPENDENCY' ? 'supplyChain' : 'external'
  return t.ruleId.startsWith('hunt:') ? 'hunt' : 'judge'
}

/** `judgeReviewScope` as stored: an array of paths, or null for the whole diff. */
export function parseReviewScope(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((p): p is string => typeof p === 'string')
}

export interface CoverageScan {
  status: ScanStatus
  stages: ScanStages | null
  /** Raw Json — `parseReviewScope`. */
  judgeReviewScope?: unknown
  /** LUM-1144 — the row's causes; a size-cap partial review is scoped. */
  partialCauses?: ReadonlyArray<string> | null
}

/**
 * LUM-1144 — the AI review ran on part of an over-cap diff and recorded
 * exactly which files it read: those files were reviewed whole.
 */
function isScopedPartialJudge(scan: CoverageScan): boolean {
  const causes = scan.partialCauses ?? []
  return (
    scan.stages?.judge === 'PARTIAL' &&
    causes.includes('JUDGE_PARTIAL_OVER_CAP') &&
    !causes.includes('JUDGE_TRUNCATED') &&
    parseReviewScope(scan.judgeReviewScope) !== null
  )
}

/**
 * Did the layer that produced this finding read its file, whole, on this
 * head? Only then is the fingerprint's absence evidence of a fix.
 */
export function layerCoveredFile(
  scan: CoverageScan,
  t: {
    ruleId: string
    provenance: FindingProvenance
    kind: FindingKind
    filePath: string
  }
): boolean {
  if (scan.status !== 'CLEAN' && scan.status !== 'FINDINGS') return false
  const layer = layerOf(t)
  const scopedPartial = layer === 'judge' && isScopedPartialJudge(scan)
  if (scan.stages?.[layer] !== 'RAN' && !scopedPartial) return false
  if (layer !== 'judge') return true
  const scope = parseReviewScope(scan.judgeReviewScope)
  return scope === null || scope.includes(t.filePath)
}

function inlineEligible(
  f: Pick<ReviewFindingRow, 'line' | 'severity' | 'suggestedDisposition'>
): boolean {
  return (
    f.line !== null && f.severity !== 'LOW' && f.suggestedDisposition == null
  )
}

export type ThreadAction =
  /** Absent after a complete pass: resolve with the addressed note. */
  | { kind: 'ADDRESS'; row: FindingThreadRow; threadId: string | null }
  /** Addressed, then reported again: unresolve with the regression note. */
  | { kind: 'REOPEN'; row: FindingThreadRow; threadId: string | null }
  /**
   * Still reported but the comment is outdated: post afresh, resolve the old
   * one as moved. `fingerprint` = the finding the fresh comment is for when
   * it continues the row's under a new fingerprint; absent = the row's own.
   */
  | {
      kind: 'REPOST'
      row: FindingThreadRow
      threadId: string | null
      fingerprint?: string
    }
  /**
   * The row's fingerprint is gone but `successor` reports the same issue:
   * the thread keeps its state (open, or resolved by a human) and stands for
   * `successor` (no note, no comment).
   */
  | { kind: 'CARRY'; row: FindingThreadRow; successor: string }
  /** State-only change (GitHub already says so, or the verifier decided). */
  | {
      kind: 'SET_STATE'
      row: FindingThreadRow
      state: FindingThreadState
      resolvedByLogin: string | null
    }

export interface ThreadPlanInput {
  rows: FindingThreadRow[]
  /** Every finding on the current scan (any disposition). */
  findings: ReviewFindingRow[]
  /** The current scan's open findings (undecided, not persisting, not verifier-rejected). */
  open: ReviewFindingRow[]
  scan: CoverageScan
  headSha: string
  /** GitHub's view of the threads, by first-comment id; null = not read. */
  remote: Map<string, ReviewThreadState> | null
  /** LUM-1147 — the review profile's inline rule; absent = chill. */
  isInline?: ((f: ReviewFindingRow) => boolean) | undefined
  /**
   * LUM-1127 follow-up — line / title / evidence by fingerprint, for the
   * threads' findings this scan no longer reports and this scan's AI-layer
   * findings (`loadIdentities`). `null` = the lookup failed: no AI-layer
   * thread is addressed on this sync (the next one retries). Absent = no
   * same-issue matching (absence alone decides).
   */
  identities?: Map<string, FindingIdentity> | null | undefined
  /** Does this finding block DONE (the workspace policy)? Absent = never. */
  isBlocking?: ((f: ReviewFindingRow) => boolean) | undefined
  /**
   * LUM-1127 follow-up #2 — the key the stored identities are hashed with
   * (`findingIdentityKey`); every identity is compared in that hashed form.
   * Absent / null = no stored identity is in play (plain comparison).
   */
  identityKey?: string | null | undefined
}

export interface ThreadPlan {
  actions: ThreadAction[]
  /** Thread node ids learnt from GitHub, to store. */
  nodeIds: Array<{ row: FindingThreadRow; threadNodeId: string }>
  /**
   * LUM-1127 follow-up #2 — open AI-layer threads whose finding is gone but
   * whose identity is unknown (nothing recorded on the row, no finding row
   * left to read it from) while their file still has a finding that could
   * continue them: not addressed on this sync — the same issue may still be
   * reported under a new fingerprint.
   */
  unknownIdentity: FindingThreadRow[]
}

/**
 * Pure: what to do with each thread on this sync. Every rule that reads
 * GitHub's own state needs `remote`; without it only the scan-driven
 * transitions run (and those need a thread node id on the row).
 */
export function planThreadActions(input: ThreadPlanInput): ThreadPlan {
  const present = new Set(input.findings.map(f => f.fingerprint))
  const rejected = new Set(
    input.findings.filter(isVerifierRejected).map(f => f.fingerprint)
  )
  const openByFp = new Map(input.open.map(f => [f.fingerprint, f]))
  const isInline = input.isInline ?? inlineEligible
  const successors = successorsOf(input, present, rejected)
  const candidateFiles = successorCandidateFiles(input, rejected)
  const actions: ThreadAction[] = []
  const nodeIds: ThreadPlan['nodeIds'] = []
  const unknownIdentity: FindingThreadRow[] = []

  for (const row of input.rows) {
    const remote = input.remote?.get(row.commentId) ?? null
    if (remote && remote.id !== row.threadNodeId)
      nodeIds.push({ row, threadNodeId: remote.id })
    const threadId = remote?.id ?? row.threadNodeId
    let state = row.state

    // GitHub is the record of what a human did; the webhook is the fast
    // path, this read-back the backstop for a missed delivery.
    if (remote) {
      if (
        state === 'OPEN' &&
        remote.isResolved &&
        remote.resolvedBy &&
        !isLumoActor(remote.resolvedBy)
      ) {
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'RESOLVED_BY_USER',
          resolvedByLogin: remote.resolvedBy.login,
        })
        const carry = resolvedCarry(input, row, successors.get(row.fingerprint))
        if (carry) actions.push(carry)
        continue
      }
      if (
        (state === 'RESOLVED_BY_USER' || state === 'ADDRESSED') &&
        !remote.isResolved
      ) {
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'OPEN',
          resolvedByLogin: null,
        })
        state = 'OPEN'
      }
    }

    const fp = row.fingerprint
    // LUM-1127 follow-up #3: the thread stands for its own fingerprint and
    // every one it was carried to; the newest reported one is its finding.
    const fps = threadFingerprints(row)
    const reported = fps.filter(f => present.has(f))
    const openFp = [...fps].reverse().find(f => openByFp.has(f))
    const openNow = openFp ? openByFp.get(openFp) : undefined

    if (state === 'DISMISSED') {
      // The verifier's later verdict restored the comment: open again.
      if (openNow)
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'OPEN',
          resolvedByLogin: null,
        })
      continue
    }
    if (reported.length > 0 && reported.every(f => rejected.has(f))) {
      if (state === 'OPEN')
        actions.push({
          kind: 'SET_STATE',
          row,
          state: 'DISMISSED',
          resolvedByLogin: null,
        })
      continue
    }
    // Recorded as a human's resolve, but the resolver was Lumo itself (the
    // LUM-1127 misread of GraphQL's `User`-typed bot, or a sync racing
    // Lumo's own ADDRESS): it is Lumo's addressed thread, so a regression
    // reopens or reposts it like any other. A human's resolve — `@<app>
    // resolve` included, which records the asker — is never touched.
    if (
      state === 'RESOLVED_BY_USER' &&
      isLumoActor({ login: row.resolvedByLogin }) &&
      // …unless GitHub now names a human as the resolver.
      !(remote?.resolvedBy && !isLumoActor(remote.resolvedBy))
    ) {
      actions.push({
        kind: 'SET_STATE',
        row,
        state: 'ADDRESSED',
        resolvedByLogin: null,
      })
      state = 'ADDRESSED'
    }
    // A human closed the conversation: never re-posted, never reopened by Lumo.
    if (state === 'RESOLVED_BY_USER') {
      const carry = resolvedCarry(input, row, successors.get(fp))
      if (carry) actions.push(carry)
      continue
    }

    if (state === 'OPEN') {
      if (reported.length === 0) {
        // The same issue may still be reported under a new fingerprint:
        // unknown (lookup failed) → wait for the next sync; found → carry.
        if (row.provenance === 'LLM_JUDGE' && input.identities === null)
          continue
        const successor = successors.get(fp)
        if (
          // Not again on the head it was already addressed on (a human
          // reopened it there — Lumo does not fight that)…
          row.addressedInSha === input.headSha ||
          // …and never before its layer read the file whole (a sync running
          // mid-review sees the previous pass's findings): nothing is
          // addressed, but a finding that continues the thread is still
          // carried — it must never get a second thread.
          !layerCoveredFile(input.scan, row)
        ) {
          if (successor) actions.push({ kind: 'CARRY', row, successor })
          continue
        }
        // …and when nothing says what the thread's finding was, it cannot be
        // told apart from a relabel while the file still has a finding that
        // could continue it: never resolved on that (fail safe). With none
        // left in the file, no successor is possible — absence decides.
        if (
          !successor &&
          row.provenance === 'LLM_JUDGE' &&
          input.identities &&
          !input.identities.has(fp) &&
          candidateFiles.has(row.filePath)
        ) {
          unknownIdentity.push(row)
          continue
        }
        if (successor) {
          const next = openByFp.get(successor)
          if (next && remote?.isOutdated && isInline(next))
            actions.push({
              kind: 'REPOST',
              row,
              threadId,
              fingerprint: successor,
            })
          else actions.push({ kind: 'CARRY', row, successor })
          continue
        }
        actions.push({ kind: 'ADDRESS', row, threadId })
      } else if (openNow && remote?.isOutdated && isInline(openNow)) {
        actions.push({
          kind: 'REPOST',
          row,
          threadId,
          ...(openFp && openFp !== fp ? { fingerprint: openFp } : {}),
        })
      }
      continue
    }

    // ADDRESSED
    if (openNow) {
      // An outdated thread points at code that is gone: a fresh comment on
      // the new line reads better than reopening it.
      if (remote?.isOutdated && isInline(openNow))
        actions.push({
          kind: 'REPOST',
          row,
          threadId: null,
          ...(openFp && openFp !== fp ? { fingerprint: openFp } : {}),
        })
      else actions.push({ kind: 'REOPEN', row, threadId })
    }
  }
  return { actions, nodeIds, unknownIdentity }
}

/**
 * The state `planThreadActions` will treat a row as having on this sync,
 * from the stored state and GitHub's view (the same rules as the plan:
 * a human resolve recorded, an unresolve reopening, Lumo's own resolve not
 * taken for a human's).
 */
function effectiveState(
  r: FindingThreadRow,
  remote: ReviewThreadState | null
): FindingThreadState {
  if (r.state === 'DISMISSED') return r.state
  if (remote) {
    if (
      r.state === 'OPEN' &&
      remote.isResolved &&
      remote.resolvedBy &&
      !isLumoActor(remote.resolvedBy)
    )
      return 'RESOLVED_BY_USER'
    if (r.state !== 'OPEN' && !remote.isResolved) return 'OPEN'
  }
  if (
    r.state === 'RESOLVED_BY_USER' &&
    isLumoActor({ login: r.resolvedByLogin }) &&
    !(remote?.resolvedBy && !isLumoActor(remote.resolvedBy))
  )
    return 'ADDRESSED'
  return r.state
}

/**
 * Rows whose fingerprint this scan no longer reports → the current finding
 * that reports the same issue under a new fingerprint (`matchSuccessors`).
 * Open threads are matched first (a still-reported issue must not be
 * resolved), then threads a human resolved (the same issue is not raised
 * again). A thread Lumo addressed is never matched: the issue reappearing
 * there is a regression. Only AI-layer (LLM_JUDGE) fingerprints drift; a
 * current finding that owns a thread of its own, or that the verifier
 * rejected, continues nothing.
 */
function successorsOf(
  input: ThreadPlanInput,
  present: ReadonlySet<string>,
  rejected: ReadonlySet<string>
): Map<string, string> {
  const ids = input.identities
  if (!ids) return new Map()
  const owned = ownedFingerprints(input.rows)
  const byState = (state: FindingThreadState): FindingIdentity[] => {
    const out: FindingIdentity[] = []
    for (const r of input.rows) {
      if (r.provenance !== 'LLM_JUDGE' || isReported(r, present)) continue
      const remote = input.remote?.get(r.commentId) ?? null
      if (effectiveState(r, remote) !== state) continue
      const id = ids.get(r.fingerprint)
      if (id) out.push(id)
    }
    return out
  }
  const comparable = comparableWith(input.identityKey ?? null)
  const open = byState('OPEN').map(comparable)
  const resolved = byState('RESOLVED_BY_USER').map(comparable)
  if (open.length === 0 && resolved.length === 0) return new Map()
  const current: FindingIdentity[] = input.findings
    .filter(
      f =>
        f.provenance === 'LLM_JUDGE' &&
        !owned.has(f.fingerprint) &&
        !rejected.has(f.fingerprint)
    )
    .map(f => comparable(identityOfFinding(f, ids)))
  const out = matchSuccessors(open, current)
  const taken = new Set(out.values())
  for (const [prev, next] of matchSuccessors(
    resolved,
    current.filter(c => !taken.has(c.fingerprint))
  ))
    out.set(prev, next)
  return out
}

/** Every fingerprint some thread stands for (its own and its aliases). */
function ownedFingerprints(rows: readonly FindingThreadRow[]): Set<string> {
  return new Set(rows.flatMap(threadFingerprints))
}

/** Does this scan report the thread's finding under any of its fingerprints? */
function isReported(
  row: FindingThreadRow,
  present: ReadonlySet<string>
): boolean {
  return threadFingerprints(row).some(f => present.has(f))
}

/** Identities compare in their hashed form once a key is in play. */
function comparableWith(
  key: string | null
): (f: FindingIdentity) => FindingIdentity {
  return f => (key ? hashIdentity(f, key) : f)
}

/** A current finding as the same-issue match reads it. */
function identityOfFinding(
  f: ReviewFindingRow,
  ids: ReadonlyMap<string, FindingIdentity>
): FindingIdentity {
  return {
    fingerprint: f.fingerprint,
    ruleId: f.ruleId,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    severity: f.severity,
    evidence: ids.get(f.fingerprint)?.evidence ?? null,
  }
}

export interface DuplicateMerge {
  /** The older thread: it keeps the issue and takes the other's fingerprints. */
  keep: FindingThreadRow
  /** The newer thread: resolved with a duplicate note, its row dropped. */
  drop: FindingThreadRow
}

/** GitHub comment ids grow over time: the smaller one is the older thread. */
function isOlder(a: FindingThreadRow, b: FindingThreadRow): boolean {
  const x = Number(a.commentId)
  const y = Number(b.commentId)
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x < y
  return a.commentId < b.commentId
}

/**
 * LUM-1127 follow-up #3 — two open Lumo threads for one issue (a sync before
 * the carry was kept on the row posted the relabelled finding afresh): an
 * open AI-layer thread whose finding this scan no longer reports, and an
 * open thread that owns a reported finding that is the same issue
 * (`sameIssueScore`). The older thread keeps the issue; the newer one is
 * merged into it. Needs the identities (`loadIdentities`); none → nothing.
 * Pure.
 */
export function planDuplicateMerges(input: ThreadPlanInput): DuplicateMerge[] {
  const ids = input.identities
  if (!ids) return []
  const present = new Set(input.findings.map(f => f.fingerprint))
  const rejected = new Set(
    input.findings.filter(isVerifierRejected).map(f => f.fingerprint)
  )
  const comparable = comparableWith(input.identityKey ?? null)
  const openAi = input.rows.filter(
    r =>
      r.provenance === 'LLM_JUDGE' &&
      effectiveState(r, input.remote?.get(r.commentId) ?? null) === 'OPEN'
  )
  const ownerOf = new Map<string, FindingThreadRow>()
  for (const r of openAi)
    for (const f of threadFingerprints(r)) ownerOf.set(f, r)
  const out: DuplicateMerge[] = []
  const used = new Set<string>()
  for (const gone of openAi) {
    if (used.has(gone.id) || isReported(gone, present)) continue
    const was = ids.get(gone.fingerprint)
    if (!was) continue
    let best: { row: FindingThreadRow; score: number } | null = null
    for (const f of input.findings) {
      if (f.provenance !== 'LLM_JUDGE' || rejected.has(f.fingerprint)) continue
      const owner = ownerOf.get(f.fingerprint)
      if (!owner || owner.id === gone.id || used.has(owner.id)) continue
      const score = sameIssueScore(
        comparable(was),
        comparable(identityOfFinding(f, ids))
      )
      if (score !== null && (!best || score > best.score))
        best = { row: owner, score }
    }
    if (!best) continue
    used.add(gone.id)
    used.add(best.row.id)
    out.push(
      isOlder(gone, best.row)
        ? { keep: gone, drop: best.row }
        : { keep: best.row, drop: gone }
    )
  }
  return out
}

/**
 * Files holding a current AI-layer finding that could continue a thread
 * (the `successorsOf` candidates: not owning a thread, not verifier-rejected).
 * A same-issue match never crosses files.
 */
function successorCandidateFiles(
  input: ThreadPlanInput,
  rejected: ReadonlySet<string>
): Set<string> {
  const owned = ownedFingerprints(input.rows)
  return new Set(
    input.findings
      .filter(
        f =>
          f.provenance === 'LLM_JUDGE' &&
          !owned.has(f.fingerprint) &&
          !rejected.has(f.fingerprint)
      )
      .map(f => f.filePath)
  )
}

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const

/**
 * A thread a human resolved takes over the same issue's new fingerprint
 * (stays resolved, no reply, no new comment) — unless the new finding blocks
 * DONE or is more severe than the one they resolved (unknown severity → it
 * is raised).
 */
function resolvedCarry(
  input: ThreadPlanInput,
  row: FindingThreadRow,
  successor: string | undefined
): ThreadAction | null {
  if (!successor) return null
  const next = input.findings.find(f => f.fingerprint === successor)
  const was = input.identities?.get(row.fingerprint)?.severity
  if (!next || !was) return null
  if (input.isBlocking?.(next)) return null
  if (SEVERITY_RANK[next.severity] > SEVERITY_RANK[was]) return null
  return { kind: 'CARRY', row, successor }
}

/**
 * LUM-1127 follow-up #2 — the key the thread rows' identity hashes are made
 * with: a dedicated `LUMO_FINDING_IDENTITY_KEY`, else the deployment's
 * `CRON_SECRET` (mandatory for the cron routes; hashed under a domain prefix).
 * Null = not configured: no identity is recorded (the matching falls back to
 * the finding rows), never an unkeyed hash.
 */
export function findingIdentityKey(
  env: Record<string, string | undefined> = process.env
): string | null {
  const k = env.LUMO_FINDING_IDENTITY_KEY || env.CRON_SECRET
  return k && k.length > 0 ? k : null
}

/**
 * What a thread row records about the finding it stands for: keyed hashes of
 * the quoted line and the title words, never the code or the title.
 */
export function threadIdentityOf(
  f: Pick<ReviewFindingRow, 'ruleId' | 'line' | 'severity' | 'title'>,
  evidence: string | null,
  key: string
): Required<StoredThreadIdentity> {
  return {
    identityRuleId: f.ruleId,
    identityLine: f.line,
    identitySeverity: f.severity,
    identityEvidenceHash: evidenceHash(evidence, key),
    identityTitleTokens: titleTokens(f.title, key),
  }
}

/**
 * A row's recorded identity, as the same-issue match reads it; null = none
 * recorded, or recorded with another key (a rotated secret — then it is
 * re-recorded, and meanwhile treated as unknown, never as a mismatch).
 */
export function storedIdentityOf(
  row: FindingThreadRow,
  key: string | null
): FindingIdentity | null {
  if (!row.identityRuleId || !key) return null
  const hashes = {
    evidenceHash: row.identityEvidenceHash ?? null,
    titleTokens: row.identityTitleTokens ?? [],
  }
  if (!isKeyedWith(hashes, key)) return null
  return {
    fingerprint: row.fingerprint,
    ruleId: row.identityRuleId,
    provenance: row.provenance,
    filePath: row.filePath,
    line: row.identityLine ?? null,
    title: '',
    ...(row.identitySeverity ? { severity: row.identitySeverity } : {}),
    evidence: null,
    ...hashes,
  }
}

const sameTokens = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i])

/**
 * The identity writes this sync owes: an AI-layer row whose own finding is
 * reported gets its identity recorded (or its line / title / severity
 * refreshed — the quoted line is the fingerprint's own and does not change),
 * and a carried row takes over its successor's identity (its severity kept:
 * a human's resolve is weighed against what they resolved). No key → none.
 * Pure.
 */
export function planIdentityWrites(input: {
  rows: FindingThreadRow[]
  findings: ReviewFindingRow[]
  /** `loadIdentities`; null = the read failed (nothing new is recorded). */
  identities: Map<string, FindingIdentity> | null
  carried: ReadonlyArray<{ row: FindingThreadRow; successor: string }>
  key: string | null
}): Array<{ row: FindingThreadRow; patch: StoredThreadIdentity }> {
  const { key } = input
  if (!key) return []
  const byFp = new Map(input.findings.map(f => [f.fingerprint, f]))
  const out: Array<{ row: FindingThreadRow; patch: StoredThreadIdentity }> = []
  const carriedRows = new Set(input.carried.map(c => c.row.id))
  for (const row of input.rows) {
    if (row.provenance !== 'LLM_JUDGE' || carriedRows.has(row.id)) continue
    const f = byFp.get(row.fingerprint)
    if (!f) continue
    if (!storedIdentityOf(row, key)) {
      const known = input.identities?.get(row.fingerprint)
      if (known)
        out.push({ row, patch: threadIdentityOf(f, known.evidence, key) })
      continue
    }
    const tokens = titleTokens(f.title, key)
    if (
      row.identityRuleId !== f.ruleId ||
      (row.identityLine ?? null) !== f.line ||
      row.identitySeverity !== f.severity ||
      !sameTokens(row.identityTitleTokens ?? [], tokens)
    )
      out.push({
        row,
        patch: {
          identityRuleId: f.ruleId,
          identityLine: f.line,
          identitySeverity: f.severity,
          identityTitleTokens: tokens,
        },
      })
  }
  for (const { row, successor } of input.carried) {
    const f = byFp.get(successor)
    const known = input.identities?.get(successor)
    if (!f || !known) continue
    // The severity stays the thread's own (what a human resolved).
    const was =
      row.identitySeverity ??
      input.identities?.get(row.fingerprint)?.severity ??
      f.severity
    out.push({
      row,
      patch: {
        ...threadIdentityOf(f, known.evidence, key),
        identitySeverity: was,
      },
    })
  }
  return out
}

/** The fingerprint of a Lumo-authored thread-opening comment, else null. */
export function lumoThreadFingerprint(c: {
  body: string
  user: { type?: string; login?: string } | null
  in_reply_to_id?: number | null
}): string | null {
  if (c.in_reply_to_id) return null
  if (!isLumoActor(c.user)) return null
  return FP_MARKER_RE.exec(c.body)?.[1] ?? null
}

export interface ThreadCounts {
  open: number
  addressed: number
  resolved: number
}

function countStates(states: FindingThreadState[]): ThreadCounts {
  return {
    open: states.filter(s => s === 'OPEN').length,
    addressed: states.filter(s => s === 'ADDRESSED').length,
    resolved: states.filter(s => s === 'RESOLVED_BY_USER').length,
  }
}

// ── Sync side (called by the PR write-back) ─────────────────────────────────

export interface ThreadSyncContext {
  pullRequestId: string
  workspaceId: string
  repo: { owner: string; name: string }
  prNumber: number
  token: string
  headSha: string
  scan: CoverageScan
  findings: ReviewFindingRow[]
  open: ReviewFindingRow[]
  /** The PR's review comments, as the write-back listed them. */
  comments: ListedComment[]
  /**
   * LUM-1147 — would the write-back comment this row inline (the scan's
   * review profile)? Absent = the chill rule.
   */
  isInline?: (f: ReviewFindingRow) => boolean
  /** Does this finding block DONE (the workspace policy)? Absent = never. */
  isBlocking?: (f: ReviewFindingRow) => boolean
}

export interface ThreadReconcileResult {
  /** Fingerprints a human resolved on GitHub (never re-posted). */
  resolvedByUser: Set<string>
  /** Fingerprints whose existing comment must not stop a fresh post (moved / outdated regression). */
  repost: Map<string, { row: FindingThreadRow; oldThreadId: string | null }>
  /**
   * LUM-1127 follow-up — new fingerprint → the thread row it continues: the
   * finding already has its thread (that row's), so it gets no comment.
   */
  carried: Map<string, string>
  /** Thread states after this sync, for the summary. */
  counts: ThreadCounts
}

export const NO_THREADS: ThreadReconcileResult = {
  resolvedByUser: new Set(),
  repost: new Map(),
  carried: new Map(),
  counts: { open: 0, addressed: 0, resolved: 0 },
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Marker comments with no row yet (posted before LUM-1127, or a row write
 * that failed): adopt them, so existing threads join the lifecycle without a
 * backfill migration. A fingerprint whose layer cannot be looked up is left
 * alone — without it, its absence could never be judged.
 */
async function adoptUnknownComments(
  ctx: ThreadSyncContext,
  rows: FindingThreadRow[],
  remote: Map<string, ReviewThreadState> | null
): Promise<FindingThreadRow[]> {
  // A carried thread's aliases are known too: their comments (a duplicate
  // merged away) are never adopted as threads of their own.
  const known = ownedFingerprints(rows)
  // Listing is newest first: the first comment seen per fingerprint wins.
  const pending = new Map<string, ListedComment>()
  for (const c of ctx.comments) {
    const fp = lumoThreadFingerprint(c)
    if (fp && !known.has(fp) && !pending.has(fp)) pending.set(fp, c)
  }
  if (pending.size === 0) return []
  const meta = new Map(
    ctx.findings.map(f => [
      f.fingerprint,
      {
        ruleId: f.ruleId,
        provenance: f.provenance,
        kind: f.kind,
        filePath: f.filePath,
      },
    ])
  )
  const missing = [...pending.keys()].filter(fp => !meta.has(fp))
  for (const m of await prFindingThreadRepository.findLayerMetaByFingerprints(
    ctx.pullRequestId,
    missing
  ))
    meta.set(m.fingerprint, m)

  const adopted: FindingThreadRow[] = []
  for (const [fp, c] of pending) {
    const m = meta.get(fp)
    if (!m) continue
    const r = remote?.get(String(c.id)) ?? null
    const state: FindingThreadState = c.body.includes(RETRACTED_MARKER)
      ? 'DISMISSED'
      : r?.isResolved && r.resolvedBy && !isLumoActor(r.resolvedBy)
        ? 'RESOLVED_BY_USER'
        : 'OPEN'
    const resolvedByLogin =
      state === 'RESOLVED_BY_USER' ? (r?.resolvedBy?.login ?? null) : null
    await prFindingThreadRepository.upsert({
      pullRequestId: ctx.pullRequestId,
      workspaceId: ctx.workspaceId,
      fingerprint: fp,
      commentId: String(c.id),
      threadNodeId: r?.id ?? null,
      state,
      resolvedByLogin,
      ...m,
    })
    adopted.push({
      id: '',
      pullRequestId: ctx.pullRequestId,
      fingerprint: fp,
      commentId: String(c.id),
      threadNodeId: r?.id ?? null,
      state,
      resolvedByLogin,
      addressedInSha: null,
      ...m,
    })
  }
  return adopted
}

/**
 * LUM-1127 follow-up — the identities `planThreadActions` matches with: the
 * AI-layer threads' findings this scan no longer reports, plus this scan's
 * AI-layer findings in the same files (for their quoted evidence). A thread's
 * own identity is read off its row (LUM-1127 follow-up #2: a full re-review
 * of the same head deletes the scan's earlier finding rows); a row recorded
 * before that falls back to the newest finding row of its fingerprint. Also
 * reads the evidence of reported findings whose row has no identity yet, so
 * `planIdentityWrites` can record it. Nothing to match → an empty map; a
 * failed read → null (no AI-layer thread is addressed on this sync — a
 * still-reported issue is never resolved on a guess).
 */
async function loadIdentities(
  ctx: ThreadSyncContext,
  rows: FindingThreadRow[],
  remote: Map<string, ReviewThreadState> | null,
  key: string | null
): Promise<Map<string, FindingIdentity> | null> {
  const present = new Set(ctx.findings.map(f => f.fingerprint))
  const gone = rows.filter(r => {
    if (r.provenance !== 'LLM_JUDGE' || isReported(r, present)) return false
    const s = effectiveState(r, remote?.get(r.commentId) ?? null)
    return s === 'OPEN' || s === 'RESOLVED_BY_USER'
  })
  const unrecorded = rows.filter(
    r =>
      r.provenance === 'LLM_JUDGE' &&
      present.has(r.fingerprint) &&
      !storedIdentityOf(r, key)
  )
  if (gone.length === 0 && unrecorded.length === 0) return new Map()
  const out = new Map<string, FindingIdentity>()
  for (const r of gone) {
    const stored = storedIdentityOf(r, key)
    if (stored) out.set(r.fingerprint, stored)
  }
  const files = new Set(gone.map(r => r.filePath))
  const fingerprints = [
    ...gone.filter(r => !out.has(r.fingerprint)).map(r => r.fingerprint),
    ...unrecorded.map(r => r.fingerprint),
    ...ctx.findings
      .filter(f => f.provenance === 'LLM_JUDGE' && files.has(f.filePath))
      .map(f => f.fingerprint),
  ]
  if (fingerprints.length === 0) return out
  try {
    const found = await prFindingThreadRepository.findIdentitiesByFingerprints(
      ctx.pullRequestId,
      [...new Set(fingerprints)]
    )
    for (const f of found)
      if (!out.has(f.fingerprint)) out.set(f.fingerprint, f)
    return out
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] identity read failed pr=#${ctx.prNumber}: ${describe(error)}`
    )
    return null
  }
}

/** The row's aliases with `fp` added (once; never its own fingerprint). */
export function withAlias(row: FindingThreadRow, fp: string): string[] {
  const aliases = row.aliasFingerprints ?? []
  if (fp === row.fingerprint || aliases.includes(fp)) return aliases
  return [...aliases, fp]
}

/** The web URL of a review comment, for the duplicate note's link. */
function commentUrl(ctx: ThreadSyncContext, commentId: string): string {
  return `https://github.com/${ctx.repo.owner}/${ctx.repo.name}/pull/${ctx.prNumber}#discussion_r${commentId}`
}

/**
 * LUM-1127 follow-up #3 — run the planned merges: the newer thread is
 * resolved on GitHub with a duplicate note (no "Addressed"), its fingerprints
 * become the older thread's aliases, and its row is dropped. Returns the rows
 * the rest of this sync plans with. A merge that fails on GitHub leaves both
 * rows in the table but keeps the newer one out of this sync (never
 * "addressed" meanwhile); the next sync retries.
 */
async function mergeDuplicates(
  ctx: ThreadSyncContext,
  rows: FindingThreadRow[],
  merges: DuplicateMerge[],
  remote: Map<string, ReviewThreadState> | null
): Promise<FindingThreadRow[]> {
  if (merges.length === 0) return rows
  const skip = new Set<string>()
  const aliases = new Map<string, string[]>()
  for (const { keep, drop } of merges) {
    skip.add(drop.id)
    const r = remote?.get(drop.commentId) ?? null
    const threadId = r?.id ?? drop.threadNodeId
    if (!threadId) {
      logger.info(
        `[pr-finding-thread] duplicate fp=${drop.fingerprint} has no thread id yet — merged next sync`
      )
      continue
    }
    try {
      if (!r?.isResolved) {
        await reviewThreadClient.resolveThread({ threadId, token: ctx.token })
        await reply(
          ctx,
          drop.commentId,
          buildDuplicateNote(commentUrl(ctx, keep.commentId))
        )
      }
      let next = keep.aliasFingerprints ?? []
      for (const fp of threadFingerprints(drop))
        next = withAlias({ ...keep, aliasFingerprints: next }, fp)
      await prFindingThreadRepository.update(keep.id, {
        aliasFingerprints: next,
      })
      aliases.set(keep.id, next)
      await prFindingThreadRepository.delete(drop.id)
      logger.info(
        `[pr-finding-thread] merged duplicate fp=${drop.fingerprint} into fp=${keep.fingerprint} (same issue)`
      )
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] duplicate merge failed fp=${drop.fingerprint}: ${describe(error)}`
      )
    }
  }
  return rows
    .filter(r => !skip.has(r.id))
    .map(r => {
      const next = aliases.get(r.id)
      return next ? { ...r, aliasFingerprints: next } : r
    })
}

async function readRemote(
  ctx: ThreadSyncContext
): Promise<Map<string, ReviewThreadState> | null> {
  try {
    const threads = await reviewThreadClient.listReviewThreads({
      repo: ctx.repo,
      prNumber: ctx.prNumber,
      token: ctx.token,
    })
    const out = new Map<string, ReviewThreadState>()
    for (const t of threads)
      if (t.firstCommentId !== null) out.set(String(t.firstCommentId), t)
    return out
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] thread read failed pr=#${ctx.prNumber}: ${describe(error)}`
    )
    return null
  }
}

async function reply(
  ctx: ThreadSyncContext,
  commentId: string,
  body: string
): Promise<void> {
  try {
    await prCommentClient.createReviewLineReply({
      repo: ctx.repo,
      prNumber: ctx.prNumber,
      inReplyTo: Number(commentId),
      body,
      token: ctx.token,
    })
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] note failed comment=${commentId}: ${describe(error)}`
    )
  }
}

/** The quoted evidence of the posted AI-layer findings; null = the read failed. */
async function postedEvidence(
  ctx: ThreadSyncContext,
  posted: ReviewFindingRow[]
): Promise<Map<string, string> | null> {
  const fps = posted
    .filter(f => f.provenance === 'LLM_JUDGE')
    .map(f => f.fingerprint)
  if (fps.length === 0) return new Map()
  try {
    const found = await prFindingThreadRepository.findIdentitiesByFingerprints(
      ctx.pullRequestId,
      fps
    )
    return new Map(found.map(f => [f.fingerprint, f.evidence]))
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] evidence read failed pr=#${ctx.prNumber}: ${describe(error)}`
    )
    return null
  }
}

/** Runs one action; returns the row's state afterwards. */
async function execute(
  ctx: ThreadSyncContext,
  action: ThreadAction,
  remote: Map<string, ReviewThreadState> | null
): Promise<FindingThreadState> {
  const { row } = action
  if (action.kind === 'SET_STATE') {
    const resolving =
      action.state === 'RESOLVED_BY_USER' || action.state === 'ADDRESSED'
    await prFindingThreadRepository.update(row.id, {
      state: action.state,
      resolvedByLogin: action.resolvedByLogin,
      resolvedAt: resolving ? new Date() : null,
    })
    return action.state
  }
  if (action.kind === 'REPOST' || action.kind === 'CARRY') return row.state
  if (!action.threadId) {
    logger.info(
      `[pr-finding-thread] no thread id yet fp=${row.fingerprint} — retried next sync`
    )
    return row.state
  }
  if (action.kind === 'ADDRESS') {
    // Already resolved on GitHub (an earlier sync resolved it and then failed
    // to record it): record only — no second note.
    const already = remote?.get(row.commentId)?.isResolved === true
    if (!already) {
      await reviewThreadClient.resolveThread({
        threadId: action.threadId,
        token: ctx.token,
      })
      await reply(ctx, row.commentId, buildAddressedNote(ctx.headSha))
    }
    await prFindingThreadRepository.update(row.id, {
      state: 'ADDRESSED',
      threadNodeId: action.threadId,
      addressedInSha: ctx.headSha,
      resolvedAt: new Date(),
      resolvedByLogin: null,
    })
    return 'ADDRESSED'
  }
  // REOPEN
  await reviewThreadClient.unresolveThread({
    threadId: action.threadId,
    token: ctx.token,
  })
  await reply(ctx, row.commentId, buildRegressionNote(ctx.headSha))
  await prFindingThreadRepository.update(row.id, {
    state: 'OPEN',
    threadNodeId: action.threadId,
    addressedInSha: null,
    resolvedAt: null,
    resolvedByLogin: null,
  })
  return 'OPEN'
}

export const prFindingThreadService = {
  /**
   * Before the write-back posts: adopt marker comments, then resolve /
   * reopen / record each thread against this scan. Never throws.
   */
  async reconcile(ctx: ThreadSyncContext): Promise<ThreadReconcileResult> {
    let rows: FindingThreadRow[]
    try {
      rows = await prFindingThreadRepository.findByPullRequest(
        ctx.pullRequestId
      )
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] load failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
      return NO_THREADS
    }
    const hasMarkers = ctx.comments.some(c => lumoThreadFingerprint(c))
    if (rows.length === 0 && !hasMarkers) return NO_THREADS

    const remote = await readRemote(ctx)
    try {
      rows = [...rows, ...(await adoptUnknownComments(ctx, rows, remote))]
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] adoption failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
    }
    // Adopted rows carry no id until re-read; re-read so updates can target them.
    if (rows.some(r => r.id === '')) {
      try {
        rows = await prFindingThreadRepository.findByPullRequest(
          ctx.pullRequestId
        )
      } catch {
        rows = rows.filter(r => r.id !== '')
      }
    }

    const identityKey = findingIdentityKey()
    const identities = await loadIdentities(ctx, rows, remote, identityKey)
    // LUM-1127 follow-up #3: two threads for one issue → merge them first,
    // so the newer one is never "addressed" while its issue is reported.
    rows = await mergeDuplicates(
      ctx,
      rows,
      planDuplicateMerges({
        rows,
        findings: ctx.findings,
        open: ctx.open,
        scan: ctx.scan,
        headSha: ctx.headSha,
        remote,
        identities,
        identityKey,
      }),
      remote
    )
    const plan = planThreadActions({
      rows,
      findings: ctx.findings,
      open: ctx.open,
      scan: ctx.scan,
      headSha: ctx.headSha,
      remote,
      isInline: ctx.isInline,
      identities,
      isBlocking: ctx.isBlocking,
      identityKey,
    })
    for (const row of plan.unknownIdentity)
      logger.warn(
        `[pr-finding-thread] identity unknown fp=${row.fingerprint} pr=#${ctx.prNumber} — not addressed (may be the same issue under a new fingerprint)`
      )
    const carriedActions = plan.actions.flatMap(a =>
      a.kind === 'CARRY' ? [{ row: a.row, successor: a.successor }] : []
    )
    // One write per row: the carry kept on the row (its new alias) and the
    // identity it now stands for.
    const patches = new Map<
      string,
      { row: FindingThreadRow; patch: FindingThreadPatch }
    >()
    for (const { row, successor } of carriedActions)
      patches.set(row.id, {
        row,
        patch: { aliasFingerprints: withAlias(row, successor) },
      })
    for (const { row, patch } of planIdentityWrites({
      rows,
      findings: ctx.findings,
      identities,
      carried: carriedActions,
      key: identityKey,
    })) {
      const prev = patches.get(row.id)
      patches.set(row.id, { row, patch: { ...prev?.patch, ...patch } })
    }
    for (const { row, patch } of patches.values()) {
      try {
        await prFindingThreadRepository.update(row.id, patch)
      } catch (error) {
        logger.warn(
          `[pr-finding-thread] carry/identity write failed fp=${row.fingerprint}: ${describe(error)}`
        )
      }
    }
    const finalState = new Map(rows.map(r => [r.fingerprint, r.state]))
    for (const { row, threadNodeId } of plan.nodeIds) {
      try {
        await prFindingThreadRepository.update(row.id, { threadNodeId })
      } catch (error) {
        logger.warn(
          `[pr-finding-thread] node id write failed fp=${row.fingerprint}: ${describe(error)}`
        )
      }
    }
    const repost: ThreadReconcileResult['repost'] = new Map()
    const carried: ThreadReconcileResult['carried'] = new Map()
    // A finding under a fingerprint a thread was carried to earlier already
    // has that thread — mid-review or not, it never gets a second comment.
    const present = new Set(ctx.findings.map(f => f.fingerprint))
    for (const row of rows)
      for (const alias of row.aliasFingerprints ?? [])
        if (present.has(alias)) carried.set(alias, row.fingerprint)
    for (const action of plan.actions) {
      if (action.kind === 'CARRY') {
        // No GitHub call and no state change: the thread keeps the state
        // this sync gave it (an earlier action may have just set it).
        carried.set(action.successor, action.row.fingerprint)
        logger.info(
          `[pr-finding-thread] carried fp=${action.row.fingerprint} → ${action.successor} (same issue, new fingerprint)`
        )
        continue
      }
      if (action.kind === 'REPOST') {
        const fp = action.fingerprint ?? action.row.fingerprint
        repost.set(fp, {
          row: action.row,
          oldThreadId: action.threadId,
        })
        // Posted afresh on purpose: not suppressed as carried.
        carried.delete(fp)
        // About to be posted afresh: an open thread from this sync on.
        finalState.set(action.row.fingerprint, 'OPEN')
        continue
      }
      try {
        finalState.set(
          action.row.fingerprint,
          await execute(ctx, action, remote)
        )
      } catch (error) {
        logger.warn(
          `[pr-finding-thread] ${action.kind} failed fp=${action.row.fingerprint}: ${describe(error)}`
        )
      }
    }
    const resolvedByUser = new Set(
      [...finalState]
        .filter(([, s]) => s === 'RESOLVED_BY_USER')
        .map(([f]) => f)
    )
    // A finding carried onto a thread a human resolved is resolved with it.
    for (const [next, prev] of carried)
      if (finalState.get(prev) === 'RESOLVED_BY_USER') resolvedByUser.add(next)
    return {
      resolvedByUser,
      repost,
      carried,
      counts: countStates([...finalState.values()]),
    }
  },

  /**
   * After the write-back's review went out: record each new comment against
   * its fingerprint, and close the thread a moved finding left behind.
   * Never throws.
   */
  async recordPosted(
    ctx: ThreadSyncContext,
    reviewId: number,
    posted: ReviewFindingRow[],
    repost: ThreadReconcileResult['repost']
  ): Promise<void> {
    try {
      const comments = await prCommentClient.listReviewCommentsOfReview({
        repo: ctx.repo,
        prNumber: ctx.prNumber,
        reviewId,
        token: ctx.token,
      })
      const byFp = new Map(posted.map(f => [f.fingerprint, f]))
      const key = findingIdentityKey()
      const evidence = key ? await postedEvidence(ctx, posted) : null
      for (const c of comments) {
        const fp = FP_MARKER_RE.exec(c.body)?.[1]
        const f = fp ? byFp.get(fp) : undefined
        if (!fp || !f) continue
        const moved = repost.get(fp)
        // LUM-1127 follow-up #3: a thread continued under another fingerprint
        // (carried, then moved) stays one row — the original, re-pointed at
        // the fresh comment with that fingerprint among its aliases.
        const continued =
          moved && moved.row.fingerprint !== fp ? moved.row : null
        if (moved) {
          if (moved.oldThreadId) {
            try {
              await reviewThreadClient.resolveThread({
                threadId: moved.oldThreadId,
                token: ctx.token,
              })
              await reply(ctx, moved.row.commentId, buildMovedNote(ctx.headSha))
            } catch (error) {
              logger.warn(
                `[pr-finding-thread] moved resolve failed fp=${fp}: ${describe(error)}`
              )
            }
          }
        }
        const identity =
          key && f.provenance === 'LLM_JUDGE' && evidence?.has(fp)
            ? threadIdentityOf(f, evidence.get(fp) ?? null, key)
            : {}
        if (continued) {
          await prFindingThreadRepository.update(continued.id, {
            commentId: String(c.id),
            threadNodeId: null,
            state: 'OPEN',
            resolvedByLogin: null,
            resolvedAt: null,
            addressedInSha: null,
            aliasFingerprints: withAlias(continued, fp),
            ...identity,
          })
          continue
        }
        await prFindingThreadRepository.upsert({
          pullRequestId: ctx.pullRequestId,
          workspaceId: ctx.workspaceId,
          fingerprint: fp,
          commentId: String(c.id),
          threadNodeId: null,
          state: 'OPEN',
          ruleId: f.ruleId,
          provenance: f.provenance,
          kind: f.kind,
          filePath: f.filePath,
          // An AI-layer thread records what its finding was (LUM-1127
          // follow-up #2); evidence unknown → recorded on a later sync.
          ...identity,
        })
      }
    } catch (error) {
      logger.warn(
        `[pr-finding-thread] record failed pr=#${ctx.prNumber}: ${describe(error)}`
      )
    }
  },
}

// ── Webhook side ────────────────────────────────────────────────────────────

export interface ReviewThreadEvent {
  workspaceId: string
  pullRequestId: string
  action: string
  threadNodeId: string | null
  comments: Array<{
    id: number
    body: string
    user: { type?: string; login?: string } | null
    in_reply_to_id?: number | null
  }>
  sender: { login?: string; type?: string } | null
}

export type ReviewThreadOutcome =
  | 'ignored_self'
  | 'ignored_action'
  | 'not_lumo_thread'
  | 'recorded'
  | 'unchanged'

/**
 * A `pull_request_review_thread` delivery. Lumo's own resolve / unresolve
 * echoes back as one of these: the sender is Lumo's bot, so it is dropped
 * before anything is read — it is not a user action.
 */
export async function applyReviewThreadEvent(
  event: ReviewThreadEvent
): Promise<ReviewThreadOutcome> {
  if (event.action !== 'resolved' && event.action !== 'unresolved')
    return 'ignored_action'
  if (isLumoActor(event.sender)) return 'ignored_self'
  const login = event.sender?.login ?? null
  const rows = await prFindingThreadRepository.findByThreadRef(
    event.pullRequestId,
    {
      threadNodeId: event.threadNodeId,
      commentIds: event.comments.map(c => String(c.id)),
    }
  )

  if (rows.length === 0) {
    // A marker thread from before the table existed: adopt it now.
    const first = event.comments.find(c => lumoThreadFingerprint(c))
    const fp = first ? lumoThreadFingerprint(first) : null
    if (!first || !fp) return 'not_lumo_thread'
    // LUM-1127 follow-up #3: a duplicate merged into another thread — its
    // fingerprint is that thread's alias — is not adopted back.
    const all = await prFindingThreadRepository.findByPullRequest(
      event.pullRequestId
    )
    if (all.some(r => threadFingerprints(r).includes(fp))) return 'unchanged'
    const [meta] = await prFindingThreadRepository.findLayerMetaByFingerprints(
      event.pullRequestId,
      [fp]
    )
    if (!meta) return 'not_lumo_thread'
    const resolved = event.action === 'resolved'
    await prFindingThreadRepository.upsert({
      pullRequestId: event.pullRequestId,
      workspaceId: event.workspaceId,
      fingerprint: fp,
      commentId: String(first.id),
      threadNodeId: event.threadNodeId,
      state: resolved ? 'RESOLVED_BY_USER' : 'OPEN',
      resolvedByLogin: resolved ? login : null,
      ruleId: meta.ruleId,
      provenance: meta.provenance,
      kind: meta.kind,
      filePath: meta.filePath,
    })
    return 'recorded'
  }

  let changed = false
  for (const row of rows) {
    if (event.action === 'resolved' && row.state === 'OPEN') {
      await prFindingThreadRepository.update(row.id, {
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: login,
        resolvedAt: new Date(),
        ...(event.threadNodeId ? { threadNodeId: event.threadNodeId } : {}),
      })
      changed = true
    } else if (
      event.action === 'unresolved' &&
      (row.state === 'RESOLVED_BY_USER' || row.state === 'ADDRESSED')
    ) {
      await prFindingThreadRepository.update(row.id, {
        state: 'OPEN',
        resolvedByLogin: null,
        resolvedAt: null,
        ...(event.threadNodeId ? { threadNodeId: event.threadNodeId } : {}),
      })
      changed = true
    }
  }
  return changed ? 'recorded' : 'unchanged'
}

// ── Command side (LUM-1129 `@<app> resolve`) ────────────────────────────────

export interface ResolveByCommandInput {
  pullRequestId: string
  repo: { owner: string; name: string }
  prNumber: number
  /** Installation token with `pull_requests: write`. */
  token: string
  /** The GitHub login that asked — recorded as the thread's resolver. */
  login: string
  /** Fingerprints whose thread must stay open: their finding blocks DONE. */
  keep: ReadonlySet<string>
}

export interface ResolveByCommandResult {
  resolved: number
  /** Left open because the finding blocks DONE. */
  kept: number
  failed: number
}

/**
 * `@<app> resolve`: resolve every open Lumo thread on the PR on the asker's
 * behalf — recorded as their resolve (`RESOLVED_BY_USER`), so the next sync
 * never re-posts it. Conversation only: no finding's disposition is touched,
 * and a thread whose finding blocks DONE (`keep`) is left open, because
 * resolving it would hide a finding that still gates the task — those are
 * cleared by `lumo finding disposition` or the web panel. A GitHub failure
 * on one thread is counted, not thrown; only a failed row read throws.
 */
export async function resolveThreadsByCommand(
  input: ResolveByCommandInput
): Promise<ResolveByCommandResult> {
  const result: ResolveByCommandResult = { resolved: 0, kept: 0, failed: 0 }
  const open = (
    await prFindingThreadRepository.findByPullRequest(input.pullRequestId)
  ).filter(r => r.state === 'OPEN')
  // A carried thread is kept open when the finding it now stands for blocks.
  const targets = open.filter(
    r => !threadFingerprints(r).some(f => input.keep.has(f))
  )
  result.kept = open.length - targets.length
  if (targets.length === 0) return result

  let remote: Map<string, ReviewThreadState> | null = null
  try {
    const threads = await reviewThreadClient.listReviewThreads({
      repo: input.repo,
      prNumber: input.prNumber,
      token: input.token,
    })
    remote = new Map(
      threads
        .filter(t => t.firstCommentId !== null)
        .map(t => [String(t.firstCommentId), t])
    )
  } catch (error) {
    logger.warn(
      `[pr-finding-thread] command thread read failed pr=#${input.prNumber}: ${describe(error)}`
    )
  }

  for (const row of targets) {
    const r = remote?.get(row.commentId) ?? null
    const threadId = r?.id ?? row.threadNodeId
    if (!threadId) {
      result.failed += 1
      continue
    }
    try {
      if (!r?.isResolved)
        await reviewThreadClient.resolveThread({ threadId, token: input.token })
      // Already resolved on GitHub by someone else: credit them, not the asker.
      const by =
        r?.isResolved && r.resolvedBy && !isLumoActor(r.resolvedBy)
          ? r.resolvedBy.login
          : input.login
      await prFindingThreadRepository.update(row.id, {
        state: 'RESOLVED_BY_USER',
        resolvedByLogin: by,
        resolvedAt: new Date(),
        threadNodeId: threadId,
      })
      result.resolved += 1
    } catch (error) {
      result.failed += 1
      logger.warn(
        `[pr-finding-thread] command resolve failed fp=${row.fingerprint}: ${describe(error)}`
      )
    }
  }
  return result
}
