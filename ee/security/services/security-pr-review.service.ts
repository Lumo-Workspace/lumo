/**
 * LUM-735 Task 2 — post a scan back to its pull request.
 *
 * One summary comment per PR (upserted by `SUMMARY_MARKER`) plus one inline
 * review comment per open finding that sits on a line this PR added (skipped
 * once its fingerprint marker is already on the PR). Every writer of findings
 * calls `sync(scanId)`: stage A after `persistResult`, and both workflows
 * after their persist — so the function must be idempotent (the markers do
 * that) and must never throw (a failed comment must not fail a scan).
 *
 * P8: only already-redacted fields reach a body — `title`, `detail`,
 * `ruleId`, `filePath`, `line`, `severity`, `provenance`, `externalRef`.
 * `evidence` is not even loaded: `findByIdForReview` selects the review's
 * columns and leaves that one behind, so the red line is structural.
 * The external-failure reason is the other half of P8 — only the workflow's
 * scrubbed text (marked by `EXTERNAL_ERROR_PREFIX`) is ever published;
 * stage A's raw `error.message` carries no prefix and stays off the PR.
 *
 * Layering: service — GitHub through `@/lib/integrations/github`, the database
 * through the repository, no Prisma and no HTTP of its own. No LLM import, so
 * stage A can import it statically (it is not behind the gateway boundary).
 */
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import {
  prCommentClient,
  GithubApiError,
  type ListedComment,
} from '@/lib/integrations/github/pr-comment-client'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import type {
  FindingKind,
  FindingProvenance,
  FindingSeverity,
  ReviewFindingRow,
  ScanForReview,
} from '@/ee/security/repositories/pr-security-scan.repository'
import { isBlockingFinding } from '@/ee/security/services/pr-security-scan-gate'
import {
  DEFAULT_SECURITY_POLICY,
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'
import type {
  ScanStageKey,
  ScanStages,
} from '@/ee/security/security-scan/types'
import { EXTERNAL_ERROR_PREFIX } from '@/ee/security/security-scan/stages'
import {
  parseRepoConfigNotice,
  type RepoConfigNotice,
} from '@/ee/security/security-scan/repo-config'
import { formatRepoConfigNotice } from '@/ee/security/security-scan/repo-config-notice'
import {
  DEFAULT_REVIEW_PROFILE,
  heldByProfile,
  inlineEligibleUnder,
  parseReviewProfile,
  type ReviewProfile,
} from '@/ee/security/security-scan/review-profile'
import { REPO_CONFIG_PATH } from '@/ee/security/validation/repo-config'
import {
  blockingCheckCount,
  checksForHead,
  formatPreMergeChecks,
  overrideFromColumns,
  type PreMergeChecksOverride,
  type PreMergeChecksRecord,
} from '@/ee/security/security-scan/pre-merge-checks'
import { isDowngradedPath } from '@/lib/security-scan/secret-patterns'
import { isSuggestEnabled } from '@/ee/security/services/security-suggest.config'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import {
  isVerifierRejected,
  verifierAppliesTo,
  verifierHolding,
} from '@/ee/security/security-scan/verifier'
import {
  SCAN_STAGE_DISPLAY_ORDER,
  SCAN_STAGE_DESCRIPTIONS,
  SCAN_STAGE_LABELS,
  SCAN_UNFINISHED_NOTE,
  SCANNING_OFF_NOTE,
  formatHuntOverCap,
  formatHuntProgress,
  formatJudgeOverCap,
  formatJudgePartial,
  formatReviewPathSkips,
  type ReviewPathSkipsInput,
  formatPrTooLarge,
  formatTurnedOffNote,
  isCodeReviewFinding,
  isOwnedUnfinished,
  isReviewRateLimited,
  isReviewIgnored,
  heldStageLabel,
  scanCoverageState,
  turnedOffLayers,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type JudgePartialInput,
  type HuntProgressInput,
  type PrTooLargeInput,
  scanStageLabel,
  scanStageStateLabel,
} from '@/shared/src/security-scan'
import { parseReviewPathSkips } from '@/ee/security/security-scan/reviewable-path'
import { resolvePublicUrl } from '@/lib/utils/public-url'
import { huntBatchProgress } from '@/ee/security/security-scan/hunt/batches'
import { scanSizeCaps } from '@/ee/security/security-scan/size-caps'
import {
  neutralizeSummaryText,
  parsePrSummary,
  stripHtmlComments,
} from '@/ee/security/security-scan/pr-summary'
import { sanitizeField } from '@/shared/src/sanitize'
import { scrubScanIfZeroRetention } from '@/ee/security/services/scan-evidence-retention.service'
import { loadSecurityLayers } from '@/ee/security/services/security-workspace-switches.service'
import {
  NO_THREADS,
  layerOf,
  prFindingThreadService,
  type ThreadCounts,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'
import {
  crossLayerNearMisses,
  groupSameIssue,
  groupingCandidates,
} from '@/ee/security/security-scan/issue-groups'
import { prReviewVerdictService } from '@/ee/security/services/pr-review-verdict.service'
import { issueAssessmentReviewService } from '@/ee/security/services/issue-assessment-review.service'
import { requestChangesOffService } from '@/ee/security/services/request-changes-off.service'
import {
  parseCodeSuggestion,
  suggestionAnchor,
  suggestionBlock,
  type CodeSuggestion,
} from '@/ee/security/security-scan/code-suggestion'
import {
  buildWalkthrough,
  changedFilesSection,
  type ChangedFile,
} from '@/ee/security/security-scan/pr-walkthrough'
import { parseHighLevelSummary } from '@/ee/security/security-scan/pr-description-summary'
import { sequenceDiagramSection } from '@/ee/security/security-scan/sequence-diagram'
import { prDescriptionSummaryService } from '@/ee/security/services/pr-description-summary.service'

/** How many inline comments one sync may post. The rest wait for the next one. */
export const REVIEW_MAX_INLINE = 50

/**
 * LUM-1150 — how long a write-back's claim on a finding's inline comment
 * holds. A sync posts within seconds; a claim older than this belongs to a
 * writer that died between claiming and posting, and is taken over.
 */
export const INLINE_CLAIM_TTL_MS = 5 * 60_000

export const SUMMARY_MARKER = '<!-- lumo-security:summary -->'

export const fingerprintMarker = (fp: string): string =>
  `<!-- lumo-security:fp:${fp} -->`

const FINGERPRINT_MARKER_RE = /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/g

/** Stage order in the summary line; only keys the scan actually carries show. */
const STAGE_ORDER: readonly ScanStageKey[] = SCAN_STAGE_DISPLAY_ORDER

// Same ordering as the panel (`pr-security-scan.service`): worst severity
// first, then the layer we trust most. Copied rather than imported — that
// service reaches the LLM gateway and is only ever loaded dynamically.
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}
const PROVENANCE_RANK: Record<FindingProvenance, number> = {
  DETERMINISTIC: 0,
  EXTERNAL_TOOL: 1,
  LLM_JUDGE: 2,
}

export interface SyncResult {
  /** The summary comment went out (created or updated). */
  posted: boolean
  /** Inline comments posted by THIS sync. */
  inline: number
  /** Open findings on added lines this sync did not post: already on the PR (or being posted by a concurrent sync), over the cap, or lost to a 422. */
  skipped: number
}

const NOTHING: SyncResult = { posted: false, inline: 0, skipped: 0 }

// ── Pure builders ───────────────────────────────────────────────────────────

/** Every fingerprint Lumo has already commented on, read back out of the PR. */
export function parseFingerprintMarkers(bodies: string[]): Set<string> {
  const out = new Set<string>()
  for (const body of bodies) {
    for (const m of body.matchAll(FINGERPRINT_MARKER_RE)) {
      if (m[1]) out.add(m[1])
    }
  }
  return out
}

/** The tool slug of an `ext:<tool>:<rule>` id, or null for any other shape. */
function externalTool(ruleId: string): string | null {
  const parts = ruleId.split(':')
  return parts[0] === 'ext' && parts[1] ? parts[1] : null
}

export function provenanceLabel(f: {
  provenance: FindingProvenance
  ruleId: string
}): string {
  if (f.provenance === 'DETERMINISTIC') return 'pattern'
  if (f.provenance === 'LLM_JUDGE') return 'LLM review'
  return externalTool(f.ruleId) ?? 'external tool'
}

/**
 * LUM-988 — what kind of problem the comment is about, when the heading would
 * otherwise read as a security finding. Only the AI review's correctness
 * findings carry one; every other row is security by construction.
 */
export function findingKindLabel(kind: FindingKind | undefined): string | null {
  return kind === 'CORRECTNESS' ? 'bug' : null
}

/** The line every retracted comment shows the reader. */
export const VERIFIER_RETRACTION_NOTE =
  "Rejected by Lumo's verifier after reading the code"

/**
 * LUM-988 — how a sync recognises a retracted comment: ONLY this marker, an
 * HTML comment Lumo writes and a reader never sees — never the visible note,
 * which a finding's title or the model-written detail can repeat word for
 * word (on its own line, too). A comment retracted before the marker existed
 * (PRs 1277–1279) reads as not retracted: if its row is still rejected, the
 * next sync re-retracts it and adds the marker.
 */
export const VERIFIER_RETRACTION_MARKER =
  '<!-- lumo-security:verifier-rejected -->'
export function isRetractedComment(body: string): boolean {
  return body.includes(VERIFIER_RETRACTION_MARKER)
}

/**
 * LUM-988 — a retracted comment whose finding is open again but no longer
 * qualifies for an inline comment (now LOW, suggested false positive, no
 * line): one neutral line instead of the full comment the write-back would
 * not post today — and never left saying "rejected".
 */
export function buildReopenedNote(
  f: Pick<ReviewFindingRow, 'title' | 'fingerprint' | 'kind' | 'severity'>
): string {
  const kindLabel = findingKindLabel(f.kind)
  return [
    `**Lumo · LLM review${kindLabel ? ` · ${kindLabel}` : ''} · ${f.severity}** — ${neutralizeSummaryText(f.title, 200)}`,
    'Open in Lumo — counted in the summary, no longer commented on the diff.',
    fingerprintMarker(f.fingerprint),
  ].join('\n\n')
}

/**
 * Would the write-back give this row an inline comment today (ignoring
 * holds)? LUM-1147: decided by the scan's review profile.
 */
function inlineEligible(
  f: ReviewFindingRow,
  policy: SecurityPolicy,
  profile: ReviewProfile = DEFAULT_REVIEW_PROFILE
): boolean {
  return inlineEligibleUnder(profile, f, policy)
}

/**
 * LUM-988 — the body an already-posted inline comment is edited to when the
 * verifier rejects its finding after the hold window: struck title, the
 * verifier's reason (model text, neutralised like the PR summary), and the
 * same fingerprint marker so dedup still recognises it.
 */
export function buildRetractedComment(
  f: Pick<ReviewFindingRow, 'title' | 'fingerprint' | 'kind' | 'severity'> & {
    verifierReason?: string | null
  }
): string {
  const kindLabel = findingKindLabel(f.kind)
  const reason = neutralizeSummaryText(f.verifierReason ?? '', 400)
  return [
    `**Lumo · LLM review${kindLabel ? ` · ${kindLabel}` : ''} · ${f.severity}** — ~~${neutralizeSummaryText(f.title, 200)}~~`,
    reason
      ? `${VERIFIER_RETRACTION_NOTE}: ${reason}`
      : `${VERIFIER_RETRACTION_NOTE}.`,
    `${VERIFIER_RETRACTION_MARKER}\n${fingerprintMarker(f.fingerprint)}`,
  ].join('\n\n')
}

/**
 * LUM-988 — is this comment Lumo's own? GitHub types every App's bot user as
 * `Bot`, so the type alone also matches another App quoting Lumo's marker.
 * Lumo's App posts as `<GITHUB_APP_SLUG>[bot]`; without the slug configured
 * (dev, tests) the type is all there is to go on.
 */
export function isLumoBotComment(c: {
  user: { type?: string; login?: string } | null
}): boolean {
  if (c.user?.type !== 'Bot') return false
  const slug = process.env.GITHUB_APP_SLUG
  return slug ? c.user.login === `${slug}[bot]` : true
}

/**
 * Keeps Lumo's inline comments in step with the verifier's LATEST verdict,
 * both ways — verdicts are model output and can flip between pushes while
 * the evidence-keyed fingerprint stays the same:
 *   · a rejected row whose comment is still in its original form → edited to
 *     the retraction (struck title + reason);
 *   · an open row whose comment carries the retraction from an earlier
 *     push's rejection → restored to the normal inline comment, so the PR
 *     never says "rejected" about a finding Lumo counts as open.
 * Only Lumo's own comments (`isLumoBotComment`). Best effort, per comment: a
 * failed edit is logged and retried by the next sync.
 */
async function reconcileVerifierComments(input: {
  rejected: ReviewFindingRow[]
  open: ReviewFindingRow[]
  comments: Array<{
    id: number
    body: string
    user: { type?: string; login?: string } | null
  }>
  policy: SecurityPolicy
  /** LUM-1147 — the scan's review profile. */
  profile: ReviewProfile
  repo: { owner: string; name: string }
  token: string
}): Promise<void> {
  const edits: Array<{ id: number; body: string }> = []
  const ours = input.comments.filter(isLumoBotComment)
  for (const f of input.rejected) {
    const marker = fingerprintMarker(f.fingerprint)
    for (const c of ours)
      if (c.body.includes(marker) && !isRetractedComment(c.body))
        edits.push({ id: c.id, body: buildRetractedComment(f) })
  }
  for (const f of input.open) {
    if (f.provenance !== 'LLM_JUDGE') continue
    const marker = fingerprintMarker(f.fingerprint)
    for (const c of ours)
      if (c.body.includes(marker) && isRetractedComment(c.body))
        edits.push({
          id: c.id,
          body: inlineEligible(f, input.policy, input.profile)
            ? buildInlineComment(f, input.policy)
            : buildReopenedNote(f),
        })
  }
  for (const e of edits) {
    try {
      await prCommentClient.updateReviewLineComment({
        repo: input.repo,
        externalId: String(e.id),
        body: e.body,
        token: input.token,
      })
    } catch (error) {
      logger.warn(
        `[security-pr-review] verifier comment edit failed comment=${e.id}: ${error instanceof Error ? error.message : error}`
      )
    }
  }
}

export type InlineFinding = Pick<
  ReviewFindingRow,
  | 'provenance'
  | 'ruleId'
  | 'severity'
  | 'title'
  | 'detail'
  | 'externalRef'
  | 'fingerprint'
  | 'disposition'
  | 'suggestedDisposition'
> &
  // Optional so a caller built before LUM-988 still compiles; absent = security.
  Partial<Pick<ReviewFindingRow, 'kind'>>

/**
 * The rule-docs link as a markdown link target, or null to drop it. Only an
 * http(s) URL with no HTML comment in it (cutting one out would leave a broken
 * link); `href` percent-encodes whitespace and angle brackets, and parentheses
 * are encoded too so the target cannot close the markdown link early.
 */
export function ruleDocsHref(ref: string | null): string | null {
  if (!ref || ref !== stripHtmlComments(ref)) return null
  try {
    const url = new URL(ref)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29')
  } catch {
    return null
  }
}

/**
 * LUM-1150 — the fix a new inline comment for `f` carries, or null. Only an
 * actionable LLM_JUDGE row; the stored range must contain the row's line.
 */
export function inlineSuggestion(
  f: Pick<ReviewFindingRow, 'provenance' | 'severity' | 'line'> & {
    codeSuggestion?: unknown
  }
): CodeSuggestion | null {
  if (f.provenance !== 'LLM_JUDGE' || f.severity === 'LOW' || f.line === null)
    return null
  const s = parseCodeSuggestion(f.codeSuggestion)
  if (!s || f.line < s.startLine || f.line > s.endLine) return null
  return s
}

/**
 * LUM-1150 — the rows of one review allowed to carry their suggestion. Two
 * suggestions over overlapping lines of the same file cannot both be
 * committed (the second goes stale once the first lands), so at most one per
 * overlapping range is kept: higher severity first, then the earlier range,
 * then the fingerprint so the choice is deterministic. The others keep their
 * comment, without the suggestion and on their own line.
 */
export function suggestionWinners(rows: ReviewFindingRow[]): Set<string> {
  const ranked = rows
    .map(f => ({ f, s: inlineSuggestion(f) }))
    .filter(
      (x): x is { f: ReviewFindingRow; s: CodeSuggestion } => x.s !== null
    )
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.f.severity] - SEVERITY_RANK[a.f.severity] ||
        a.s.startLine - b.s.startLine ||
        a.s.endLine - b.s.endLine ||
        (a.f.fingerprint < b.f.fingerprint ? -1 : 1)
    )
  const kept: Array<{ path: string; s: CodeSuggestion }> = []
  const winners = new Set<string>()
  for (const { f, s } of ranked) {
    const overlaps = kept.some(
      k =>
        k.path === f.filePath &&
        s.startLine <= k.s.endLine &&
        k.s.startLine <= s.endLine
    )
    if (overlaps) continue
    kept.push({ path: f.filePath, s })
    winners.add(f.fingerprint)
  }
  return winners
}

/**
 * LUM-1150 — one inline comment of the review: anchored on exactly the
 * suggestion's lines when it carries one, else on the finding's line.
 */
export function inlineReviewComment(
  f: ReviewFindingRow,
  policy: SecurityPolicy,
  withSuggestion: boolean,
  alsoReported: readonly AlsoReportedFinding[] = []
): {
  path: string
  line: number
  start_line?: number
  start_side?: 'RIGHT'
  side: 'RIGHT'
  body: string
} {
  const suggestion = withSuggestion ? inlineSuggestion(f) : null
  return {
    path: f.filePath,
    ...(suggestion ? suggestionAnchor(suggestion) : { line: f.line as number }),
    side: 'RIGHT',
    body: buildInlineComment(f, policy, suggestion, alsoReported),
  }
}

/**
 * P8: `evidence` is not a parameter here, so it cannot leak by accident.
 * LUM-1150: `suggestion` (already validated) becomes a GitHub suggestion
 * block — only for a comment anchored on exactly its lines.
 */
export function buildInlineComment(
  f: InlineFinding,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY,
  suggestion: CodeSuggestion | null = null,
  alsoReported: readonly AlsoReportedFinding[] = []
): string {
  const kindLabel = findingKindLabel(f.kind)
  // Model / scanner text (title, detail, rule-docs link): no HTML comments,
  // so it can never carry one of Lumo's state markers (a fake fingerprint or
  // retraction marker). The title stays on the heading line.
  const blocks: string[] = [
    `**Lumo · ${provenanceLabel(f)}${kindLabel ? ` · ${kindLabel}` : ''} · ${f.severity}** — ${stripHtmlComments(f.title).replace(/\s+/g, ' ').trim()}`,
  ]
  const detail = stripHtmlComments(f.detail).trim()
  if (detail.length > 0) blocks.push(detail)
  if (suggestion) blocks.push(suggestionBlock(suggestion))
  const footer: string[] = []
  const href = ruleDocsHref(f.externalRef)
  if (href) footer.push(`[Rule docs](${href})`)
  // LUM-1200: the thread carries the stricter standing of its issue group.
  if (
    isBlockingFinding(f, policy) ||
    alsoReported.some(m => isBlockingFinding(m, policy))
  )
    footer.push('blocks DONE')
  if (footer.length > 0) blocks.push(footer.join(' · '))
  for (const m of alsoReported) blocks.push(alsoReportedLine(m))
  blocks.push(fingerprintMarker(f.fingerprint))
  return blocks.join('\n\n')
}

/**
 * LUM-1200 — a finding listed under another finding's thread because both
 * report the same issue (`groupSameIssue`). Only the columns the line shows.
 */
export type AlsoReportedFinding = Pick<
  ReviewFindingRow,
  | 'fingerprint'
  | 'ruleId'
  | 'provenance'
  | 'kind'
  | 'severity'
  | 'title'
  | 'disposition'
  | 'persisting'
>

/** Hidden marker naming a finding listed in another finding's thread. */
export const alsoReportedMarker = (fp: string): string =>
  `<!-- lumo-security:also:${fp} -->`

/**
 * One line naming the merged finding's layer, severity and title (model
 * text: no HTML comments, one line), then its hidden marker so a later sync
 * can tell it is already listed.
 */
export function alsoReportedLine(m: AlsoReportedFinding): string {
  const label = SCAN_STAGE_LABELS[layerOf(m)]
  const title = stripHtmlComments(m.title).replace(/\s+/g, ' ').trim()
  return `Same issue also reported by **${label}** · ${m.severity} — ${title}\n${alsoReportedMarker(m.fingerprint)}`
}

/**
 * LUM-1200 — an inline comment already on the PR, with the merged findings
 * it does not list yet added just above its fingerprint marker; null when
 * every one is listed already (or the marker is missing), so a sync edits a
 * comment at most once per merged finding.
 */
export function withAlsoReported(
  body: string,
  keptFingerprint: string,
  merged: readonly AlsoReportedFinding[]
): string | null {
  const missing = merged.filter(
    m => !body.includes(alsoReportedMarker(m.fingerprint))
  )
  if (missing.length === 0) return null
  const marker = fingerprintMarker(keptFingerprint)
  const at = body.lastIndexOf(marker)
  if (at === -1) return null
  const lines = missing.map(alsoReportedLine).join('\n\n')
  return `${body.slice(0, at)}${lines}\n\n${body.slice(at)}`
}

export interface SummaryInput {
  repo?: string
  prNumber?: number
  headSha: string
  /**
   * LUM-832 — the scan row's status: a FAILED stage A must not read as
   * checked just because the layers it reached all ran. Optional so older
   * callers keep compiling; absent reads as "decide from the layers".
   */
  status?: string
  stages: ScanStages
  /**
   * Some layer is not whole (LUM-832: for a cause that is ours — the
   * summary never names it).
   */
  partial: boolean
  /** LUM-832 — a batched hunt's covered source files; absent when un-batched. */
  huntProgress?: HuntProgressInput | null
  /** LUM-832 — the hunt did not run: the diff was over its file cap. */
  huntOverCap?: HuntOverCapInput | null
  /** LUM-832 — the AI review did not run: the diff was over its size cap. */
  judgeOverCap?: JudgeOverCapInput | null
  /** LUM-1144 — the AI review ran on part of an over-cap diff. */
  judgePartial?: JudgePartialInput | null
  /** LUM-1079 — the whole PR was too large to scan: nothing ran. */
  prTooLarge?: PrTooLargeInput | null
  /**
   * LUM-1215 — what the path filters left out of the AI review (built-in
   * defaults named, the repository's own counted); absent/null = nothing.
   */
  reviewPathSkips?: ReviewPathSkipsInput | null
  /** LUM-832 — the causes on the row; absent/empty reads as unattributed. */
  partialCauses?: string[]
  /** Open (non-dependency) findings per external tool, from the `ext:<tool>:` prefix. */
  externalCounts: Record<string, number>
  /** Undispositioned and not persisting. */
  open: number
  /**
   * LUM-988 — how many of `open` are AI-review bugs (kind CORRECTNESS), so
   * the headline does not present them as security findings. Optional:
   * absent reads as 0.
   */
  openBugs?: number
  blocking: number
  /**
   * LUM-738 — DEPENDENCY rows: `open` = undispositioned and new to this
   * PR, `persisting` = already on the default branch. Omitted (undefined)
   * on scans that never ran the supply-chain layer.
   */
  dependencies?: { open: number; persisting: number }
  /**
   * LUM-740 — open LOW findings get no inline comment; one summary line
   * instead. `allDowngradedPaths` = every one sits in a test/fixture/doc
   * path (`isDowngradedPath`), which is what the line then says.
   */
  low?: { count: number; allDowngradedPaths: boolean }
  /** LUM-740 — open findings the falsifier suggested as false positives (no inline comment). */
  suggested?: number
  /**
   * LUM-988 — AI-review findings the agentic verifier rejected after reading
   * the code: not open, not commented, one line in the summary. Absent = 0.
   */
  verifierRejected?: number
  error: string | null
  taskUrl: string | null
  /** LUM-849 — the scan's raw `prSummary` Json; parsed (and neutralised) here. */
  prSummary?: unknown
  /** LUM-849 — paths of the findings the reader should look at first. */
  attentionFiles?: string[]
  /** LUM-849 — the reviewed head commit on GitHub, for the footer. */
  commitUrl?: string | null
  /**
   * LUM-1127 — where Lumo's inline threads stand: still open, resolved by
   * Lumo as addressed, resolved by a human on GitHub. Absent = no line.
   */
  threads?: ThreadCounts
  /**
   * LUM-1129 — the App's mention handle (`@uselumo`) when PR comment
   * commands are on; absent/null = the summary mentions the CLI only.
   */
  commandHandle?: string | null
  /** LUM-1130 — the request-changes workflow is on: list `approve` too. */
  approveCommand?: boolean
  /**
   * LUM-1146 — how `.lumo.yaml` was read for this scan; absent/null = not
   * read (nothing to say).
   */
  repoConfig?: RepoConfigNotice | null
  /**
   * LUM-1148 — the pre-merge checks' results on this head, and the PR's
   * override of them; absent/null = no check ran (no block).
   */
  preMergeChecks?: PreMergeChecksRecord | null
  preMergeOverride?: PreMergeChecksOverride | null
  /** LUM-1147 — the scan's review profile; absent = chill (said nowhere). */
  reviewProfile?: ReviewProfile
  /**
   * LUM-1147 — open findings the profile kept off the diff (quiet's MEDIUM
   * ones): listed in the summary, folded. Absent/empty = no list.
   */
  profileHeld?: Array<
    Pick<ReviewFindingRow, 'severity' | 'title' | 'filePath' | 'line'> &
      Partial<Pick<ReviewFindingRow, 'kind'>>
  >
  /**
   * LUM-1212 — open findings the profile would comment inline but that have
   * no line (the model gave none and its evidence anchored nowhere): listed
   * by name, saying why. Absent/empty = no list.
   */
  unanchored?: Array<
    Pick<ReviewFindingRow, 'severity' | 'title' | 'filePath'> &
      Partial<Pick<ReviewFindingRow, 'kind'>>
  >
  /**
   * LUM-1151 — where the high-level summary (`prSummary`) is shown:
   * `comment` (absent = here, as before), `description` (the PR
   * description holds it; this comment points there) or `off` (nowhere).
   */
  highLevelSummary?: 'comment' | 'description' | 'off'
  /** LUM-1151 — the PR's changed files, for the walkthrough; absent = none. */
  changedFiles?: ChangedFile[] | null
  /**
   * LUM-1155 — the scan's raw `sequenceDiagram` Json: a walkthrough section
   * when it parses and its Mermaid validates; absent = none.
   */
  sequenceDiagram?: unknown
}

/** LUM-1147 — how many held findings the summary lists by name. */
export const PROFILE_HELD_MAX_LISTED = 25

/**
 * LUM-1147 — the findings the review profile kept off the diff, grouped in
 * one folded list (title, file and line), so a quiet review still says
 * what it found.
 */
export function profileHeldBlock(input: SummaryInput): string | null {
  const held = input.profileHeld ?? []
  if (held.length === 0) return null
  const profile = input.reviewProfile ?? DEFAULT_REVIEW_PROFILE
  const rows = held.slice(0, PROFILE_HELD_MAX_LISTED).map(f => {
    const kind = findingKindLabel(f.kind)
    const where = f.line !== null ? `${f.filePath}:${f.line}` : f.filePath
    return `- **${f.severity}**${kind ? ` · ${kind}` : ''} — ${neutralizeSummaryText(f.title, 200)} — ${codePath(where)}`
  })
  const rest = held.length - rows.length
  if (rest > 0) rows.push(`- and ${rest} more — shown in Lumo`)
  const noun = held.length === 1 ? 'finding' : 'findings'
  return `<details>\n<summary>${held.length} more ${noun} not commented on the diff (review profile: ${profile})</summary>\n\n${rows.join('\n')}\n\n</details>`
}

/**
 * LUM-1212 — the findings that would be on the diff but have no line to sit
 * on, in one folded list (title and file), so they are not only a count.
 */
export function unanchoredBlock(
  rows: SummaryInput['unanchored']
): string | null {
  const list = rows ?? []
  if (list.length === 0) return null
  const shown = list.slice(0, PROFILE_HELD_MAX_LISTED).map(f => {
    const kind = findingKindLabel(f.kind)
    return `- **${f.severity}**${kind ? ` · ${kind}` : ''} — ${neutralizeSummaryText(f.title, 200)} — ${codePath(f.filePath)}`
  })
  const rest = list.length - shown.length
  if (rest > 0) shown.push(`- and ${rest} more — shown in Lumo`)
  const head =
    list.length === 1
      ? '1 finding could not be placed on a line of the diff'
      : `${list.length} findings could not be placed on a line of the diff`
  return `<details>\n<summary>${head} (the review gave no line its quoted code matches)</summary>\n\n${shown.join('\n')}\n\n</details>`
}

/** LUM-740 — the LOW line: the rows the PR does not get an inline comment for. */
function lowLine(input: SummaryInput): string | null {
  const low = input.low
  if (!low || low.count === 0) return null
  const noun = low.count === 1 ? 'finding' : 'findings'
  const where = low.allDowngradedPaths ? ' in test/fixture paths' : ''
  return `- ${low.count} low-severity ${noun}${where} — shown in Lumo only`
}

/** LUM-1127 — "Review threads: N open · M addressed · K resolved on GitHub". */
export function threadsLine(threads: ThreadCounts | undefined): string | null {
  // Only once a thread has moved on: a PR whose threads are all freshly
  // open says nothing the open-findings verdict above does not.
  if (!threads || threads.addressed + threads.resolved === 0) return null
  return `**Review threads:** ${threads.open} open · ${threads.addressed} addressed · ${threads.resolved} resolved on GitHub`
}

/** LUM-1129 — the reviewer commands a PR comment takes, folded. */
export function commandsBlock(handle: string, approve = false): string {
  const rows = [
    ['review', 'incremental review of the changes since the last complete one'],
    ['full review', 'review the whole PR again'],
    ['pause', 'stop automatic AI reviews on new pushes'],
    ['resume', 'resume them and reset the reviewed-commit count'],
    [
      'resolve',
      "resolve Lumo's open threads (findings that block DONE stay open)",
    ],
    // LUM-1148: the per-PR override of the pre-merge checks.
    [
      'ignore pre-merge checks',
      'ignore failed pre-merge checks on this PR (findings that block DONE stay)',
    ],
    // LUM-1130: only where the request-changes workflow is on.
    ...(approve
      ? [
          [
            'approve',
            "resolve Lumo's threads and approve (refused while a finding blocks DONE)",
          ],
        ]
      : []),
    // LUM-1153
    ['configuration', 'show the effective review settings for this PR'],
    // LUM-1151
    ['summary', "write Lumo's summary of the PR into its description again"],
    // LUM-1155
    ['diagram', "draw the sequence diagram of the PR's call flow again"],
  ].map(([c, what]) => `- \`${handle} ${c}\` — ${what}`)
  // LUM-1154: anything else addressed to Lumo is a question it answers.
  rows.push(
    `- \`${handle} <question>\` — ask about this PR's code, here, on a line, or in reply to a Lumo finding`
  )
  // LUM-1152: the one directive that lives in the description, not a comment.
  const ignore = `In the PR description, \`${handle} ignore\` skips automatic AI reviews until it is removed.`
  return `<details>\n<summary>Lumo commands</summary>\n\nComment on this PR (write access required):\n\n${rows.join('\n')}\n\n${ignore}\n\n</details>`
}

/** LUM-740 — the suggested-false-positive line. */
/** LUM-988 — one line for the findings the verifier took out, so they are not silently gone. */
function verifierRejectedLine(input: SummaryInput): string | null {
  const n = input.verifierRejected ?? 0
  if (n === 0) return null
  const noun = n === 1 ? 'AI review finding' : 'AI review findings'
  return `- ${n} ${noun} rejected by the verifier after reading the code — shown in Lumo only`
}

function suggestedLine(input: SummaryInput): string | null {
  const n = input.suggested ?? 0
  if (n === 0) return null
  const noun =
    n === 1 ? 'suspected false positive' : 'suspected false positives'
  return `- ${n} ${noun} (LLM) — confirm or overrule in Lumo`
}

/**
 * P8 — the scrubbed reason, or null. `error` is one column with two writers:
 * the ingest workflow (scrubbed, prefixed) and stage A's own catch-all (a raw
 * `error.message`). Only the prefixed one may be published, and only the text
 * after the prefix is printed. LUM-738: the managed run stamps the same
 * prefixed reason for a supply-chain failure, so either FAILED layer
 * unlocks it — the label says which scanner.
 */
function scrubbedFailureReason(
  input: SummaryInput
): { label: string; reason: string } | null {
  const label =
    input.stages.external === 'FAILED'
      ? `${SCAN_STAGE_LABELS.external} failed`
      : input.stages.supplyChain === 'FAILED'
        ? 'Dependency scan failed'
        : null
  if (!label) return null
  if (!input.error?.startsWith(EXTERNAL_ERROR_PREFIX)) return null
  const reason = input.error.slice(EXTERNAL_ERROR_PREFIX.length)
  return reason.length > 0 ? { label, reason } : null
}

/**
 * LUM-738 — what osv-scanner found, split new / already on main. LUM-849:
 * a phrase for the Dependencies layer line, no longer a line of its own.
 */
function dependencyResult(input: SummaryInput): string | null {
  const state = input.stages.supplyChain
  if (!state) return null
  if (state === 'SKIPPED') return 'no package sources found'
  const d = input.dependencies
  if (!d) return null
  if (d.open === 0 && d.persisting === 0) {
    return state === 'RAN' ? 'no known vulnerabilities' : null
  }
  const noun =
    d.open === 1 ? 'vulnerable dependency' : 'vulnerable dependencies'
  const tail = d.persisting > 0 ? ` (${d.persisting} already on main)` : ''
  return `${d.open} ${noun}${tail}`
}

/**
 * LUM-849 — one line per layer: its name, its state (plus what it counted),
 * then what it looks for. The name and state alone ("Exploit paths:
 * checked") told a reader nothing about what had been checked.
 */
function layerLines(input: SummaryInput): string[] {
  const counts = Object.entries(input.externalCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
  const lines: string[] = []
  for (const key of STAGE_ORDER) {
    const state = input.stages[key]
    if (!state) continue
    const extra =
      key === 'external' && counts.length > 0
        ? counts.map(([tool, n]) => `${tool} ${n}`).join(', ')
        : key === 'hunt' && input.huntProgress
          ? formatHuntProgress(input.huntProgress)
          : key === 'supplyChain'
            ? dependencyResult(input)
            : null
    // LUM-1137 / LUM-1152: a paused layer of a rate-limited or ignored
    // scan says so.
    const label =
      (state === 'PAUSED' ? heldStageLabel(input.partialCauses) : null) ??
      scanStageStateLabel(state)
    const status = [label, extra].filter(Boolean).join(' · ')
    lines.push(
      `- **${scanStageLabel(key)}** (${status}): ${SCAN_STAGE_DESCRIPTIONS[key]}`
    )
  }
  return lines
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** LUM-849 — how many paths the attention line names before "and N more". */
export const ATTENTION_MAX_FILES = 5

/**
 * A finding path as inline code. Paths can be model-authored (the judge's
 * `filePath`), so anything that could close the code span or open markup is
 * dropped first.
 */
function codePath(path: string): string {
  return `\`${sanitizeField(path)
    .replace(/[`<>\r\n]/g, '')
    .slice(0, 200)}\``
}

/** LUM-1146 — untrusted text (config keys, parser messages) as inline code. */
function codeText(text: string): string {
  return `\`${sanitizeField(text)
    .replace(/[`<>\r\n]/g, '')
    .slice(0, 200)}\``
}

/** LUM-849 — "Files needing attention": where the reader should look first. */
function attentionLine(files: string[] | undefined): string | null {
  const distinct = [...new Set(files ?? [])].filter(f => f.trim().length > 0)
  if (distinct.length === 0) return null
  const shown = distinct.slice(0, ATTENTION_MAX_FILES).map(codePath)
  const rest = distinct.length - shown.length
  const tail = rest > 0 ? ` and ${rest} more` : ''
  return `**Files needing attention:** ${shown.join(', ')}${tail}`
}

/** LUM-849 — the judge's "what this PR does": a sentence plus its bullets. */
function intentBlocks(raw: unknown): string[] {
  const summary = parsePrSummary(raw)
  if (!summary) return []
  const blocks = [summary.intent]
  if (summary.changes.length > 0)
    blocks.push(summary.changes.map(c => `- ${c}`).join('\n'))
  return blocks
}

/**
 * LUM-1151 — the high-level summary where the repository wants it: here
 * (the default for a caller that does not say), a pointer when the PR
 * description holds it, nothing when it is off.
 */
function summaryBlocks(input: SummaryInput): string[] {
  const where = input.highLevelSummary ?? 'comment'
  if (where === 'off') return []
  if (where === 'description')
    return parsePrSummary(input.prSummary)
      ? ['_Summary of the changes: in the PR description._']
      : []
  return [...intentBlocks(input.prSummary), ...staleSummaryLine(input)]
}

/**
 * LUM-1151 — the summary is an earlier review's, kept because the whole-PR
 * summary could not be refreshed for this commit: say so.
 */
function staleSummaryLine(input: SummaryInput): string[] {
  const sha = parsePrSummary(input.prSummary)?.describesSha
  if (!sha || input.headSha.startsWith(sha) || sha.startsWith(input.headSha))
    return []
  return [
    `_Summary of the PR as of \`${sha.slice(0, 7)}\`; Lumo could not refresh it for \`${input.headSha.slice(0, 7)}\` and will on the next review._`,
  ]
}

/**
 * LUM-849 — the bounded verdict, first. It never grades the PR or calls it
 * safe to merge: it says what the checks that ran found, the way the outcome
 * well only ever rejects.
 */
function verdictLine(
  input: SummaryInput,
  coverage: ReturnType<typeof scanCoverageState>,
  owned: boolean
): string {
  if (input.open > 0) {
    const noun = input.open === 1 ? 'finding' : 'findings'
    const bugs = input.openBugs ?? 0
    const notes = [
      ...(bugs > 0
        ? [
            `${bugs} ${bugs === 1 ? 'is a bug' : 'are bugs'} from the AI code review, not security`,
          ]
        : []),
      ...(input.blocking > 0 ? [`${input.blocking} blocking DONE`] : []),
    ]
    return `**${input.open} open ${noun}**${notes.length > 0 ? ` (${notes.join(' · ')})` : ''}`
  }
  if (coverage === 'IN_PROGRESS')
    return '**No open findings yet — the scan is still running.**'
  // LUM-1079: nothing ran — never "no findings", never ours to finish.
  if (input.prTooLarge) return '**Not scanned — this PR is too large.**'
  // LUM-832: a fault or shortfall of ours — owned, never "a layer hit its
  // budget cap", which blamed the PR's size for a budget we chose.
  if (owned) return `**No open findings so far — ${SCAN_UNFINISHED_NOTE}.**`
  // A size cap is the only gap: say what WAS checked; the notice below says
  // which layer did not run, and why.
  // LUM-892: a layer turned off in settings is not "checked" either — the
  // verdict only speaks for the layers that ran; the notice names the rest.
  if (coverage === 'UNFINISHED' || coverage === 'TURNED_OFF')
    return '**No open findings in the checks that ran.**'
  return '**No open findings on lines this PR added.**'
}

/**
 * LUM-849 — laid out for the reader deciding whether to merge (after
 * Greptile's summary): verdict → what the PR does → where to look → notices,
 * with the per-layer detail folded away and the reviewed commit in the
 * footer. No confidence score.
 */
export function buildSummary(input: SummaryInput): string {
  // LUM-832 — the same three states as the web panel and the CLI.
  const coverage = scanCoverageState({
    ...(input.status !== undefined ? { status: input.status } : {}),
    stages: input.stages,
    partial: input.partial,
  })
  const owned = isOwnedUnfinished({
    ...(input.status !== undefined ? { status: input.status } : {}),
    stages: input.stages,
    partial: input.partial,
    partialCauses: input.partialCauses ?? [],
    hasSizeNotice: Boolean(
      input.huntOverCap ||
      input.judgeOverCap ||
      input.judgePartial ||
      input.prTooLarge
    ),
  })
  const blocks: string[] = [
    '### 🛡️ Lumo security scan',
    verdictLine(input, coverage, owned),
    ...summaryBlocks(input),
  ]
  const attention = attentionLine(input.attentionFiles)
  if (attention) blocks.push(attention)
  const threads = threadsLine(input.threads)
  if (threads) blocks.push(threads)
  // LUM-1148: the pre-merge checks — failures in a table, passes folded.
  const checks = formatPreMergeChecks(
    input.preMergeChecks ?? null,
    input.preMergeOverride ?? null,
    {
      handle: input.commandHandle ?? null,
      requestChanges: input.approveCommand === true,
    }
  )
  if (checks) blocks.push(checks)

  const notices: string[] = []
  if (Object.values(input.stages).includes('PAUSED')) {
    const command =
      input.prNumber && input.repo
        ? `lumo pr scan ${input.prNumber} --repo ${sanitizeField(input.repo)} --review incremental`
        : 'lumo pr scan <number> --repo <owner/repo> --review incremental'
    const h = input.commandHandle
    // LUM-1152: the description opted this PR out of automatic review.
    if (isReviewIgnored(input.partialCauses))
      notices.push(
        h
          ? `- Automatic AI review is skipped: this PR's description contains \`${h} ignore\`. Secret, scanner and dependency checks are not affected. Remove it from the description to have the next push reviewed, or comment \`${h} review\` for a review now (CLI: \`${command}\`).`
          : `- Automatic AI review is skipped: this PR's description asks Lumo to ignore it. Secret, scanner and dependency checks are not affected. Remove that line from the description to have the next push reviewed, or request a review now with \`${command}\`.`
      )
    // LUM-1137: over the hourly cap — the next push is reviewed anyway.
    else if (isReviewRateLimited(input.partialCauses))
      notices.push(
        h
          ? `- Automatic AI review is rate-limited: this PR's author reached the hourly limit of automatic reviews. This commit has not been fully reviewed. The next push after the limit resets is reviewed automatically, or comment \`${h} review\` for a review now (CLI: \`${command}\`).`
          : `- Automatic AI review is rate-limited: this PR's author reached the hourly limit of automatic reviews. This commit has not been fully reviewed. The next push after the limit resets is reviewed automatically, or request a review now with \`${command}\`.`
      )
    else
      notices.push(
        h
          ? `- Automatic AI checks are paused on this PR (paused by a reviewer, or after its limit of reviewed commits). This commit has not been fully reviewed. Comment \`${h} review\` for an incremental review or \`${h} full review\`, and \`${h} resume\` to review every push again (CLI: \`${command}\`).`
          : `- Automatic AI checks are paused on this PR (paused by a reviewer, or after its limit of reviewed commits). This commit has not been fully reviewed. Request an incremental review with \`${command}\`, or use \`--review full\`. Use \`--resume\` to review every push again.`
      )
  }
  // With findings open, the owned note still has to be said once.
  if (input.open > 0 && owned)
    notices.push(`- ${capitalize(SCAN_UNFINISHED_NOTE)}.`)
  // LUM-1079: the whole PR was too large — why, and what to do.
  if (input.prTooLarge) notices.push(`- ${formatPrTooLarge(input.prTooLarge)}`)
  // LUM-832: a layer over its size cap did not run — stated as a limit on
  // the change, with how to get the layer.
  if (input.judgeOverCap)
    notices.push(`- ${formatJudgeOverCap(input.judgeOverCap)}`)
  // LUM-1144: the AI review read part of an over-cap diff — which files it
  // skipped, and how to get them reviewed.
  if (input.judgePartial)
    notices.push(
      `- ${formatJudgePartial(input.judgePartial, {
        renderPath: codePath,
        howTo: input.commandHandle
          ? `split the PR, or narrow it and comment \`${input.commandHandle} full review\``
          : 'split the PR, or narrow it and request a full review',
      })}`
    )
  if (input.huntOverCap)
    notices.push(`- ${formatHuntOverCap(input.huntOverCap)}`)
  // LUM-1215: files the path filters left out — a built-in default never
  // hides a file silently; each is named, with how to include it.
  if (input.reviewPathSkips)
    for (const line of formatReviewPathSkips(input.reviewPathSkips, {
      renderPath: codePath,
    }))
      notices.push(`- ${line}`)
  // LUM-892: the customer's own choice, said as such — never "didn't finish".
  const turnedOff = turnedOffLayers(input.stages)
  if (turnedOff.length > 0) notices.push(`- ${formatTurnedOffNote(turnedOff)}`)
  const low = lowLine(input)
  if (low) notices.push(low)
  const suggested = suggestedLine(input)
  if (suggested) notices.push(suggested)
  const rejected = verifierRejectedLine(input)
  if (rejected) notices.push(rejected)
  // LUM-1146: an invalid / unreadable `.lumo.yaml` is never silently ignored.
  notices.push(...formatRepoConfigNotice(input.repoConfig, { code: codeText }))
  if (notices.length > 0) blocks.push(notices.join('\n'))
  const held = profileHeldBlock(input)
  if (held) blocks.push(held)
  const unanchored = unanchoredBlock(input.unanchored)
  if (unanchored) blocks.push(unanchored)
  const failure = scrubbedFailureReason(input)
  if (failure) blocks.push(`⚠ ${failure.label}: ${failure.reason}`)

  // LUM-1151: what the PR changes, file by file — folded.
  // LUM-1155: and the main call flow, as a sequence diagram.
  const walkthrough = buildWalkthrough([
    changedFilesSection(input.changedFiles),
    sequenceDiagramSection(input.sequenceDiagram),
  ])
  if (walkthrough) blocks.push(walkthrough)

  // The per-layer lines stay, folded: detail for whoever wants it, not the
  // first thing a reader has to decode — and each says what it looks for.
  const layers = layerLines(input)
  if (layers.length > 0) {
    blocks.push(
      `<details>\n<summary>What was checked</summary>\n\n${layers.join('\n')}\n\n</details>`
    )
  }

  // LUM-1129: the PR comment commands, folded like the layer detail.
  if (input.commandHandle)
    blocks.push(commandsBlock(input.commandHandle, input.approveCommand))

  const sha = input.headSha.slice(0, 7)
  const footer = [
    `Reviewed commit: ${input.commitUrl ? `[${sha}](${input.commitUrl})` : sha}`,
  ]
  if (input.repoConfig?.base.status === 'loaded')
    footer.push(`Settings: \`${REPO_CONFIG_PATH}\``)
  // LUM-1147: a non-default profile is said, so fewer / more comments read
  // as a choice.
  if (input.reviewProfile && input.reviewProfile !== DEFAULT_REVIEW_PROFILE)
    footer.push(`Review profile: ${input.reviewProfile}`)
  if (input.taskUrl) footer.push(`[Open in Lumo](${input.taskUrl})`)
  blocks.push(footer.join(' · '))
  blocks.push(SUMMARY_MARKER)
  return blocks.join('\n\n')
}

/**
 * LUM-892 — what the PR's summary comment says once the workspace has turned
 * scanning off. It replaces an earlier scan's body, so a "no findings" for an
 * older commit does not stand as this PR's answer. Findings from earlier
 * scans stay in Lumo (and still gate DONE); they are just not repeated here.
 */
export function buildScanningOffSummary(): string {
  return [
    '### 🛡️ Lumo security scan',
    `**${SCANNING_OFF_NOTE}**`,
    'Results an earlier scan showed here were for an older commit and are no longer kept up to date. Findings from those scans that still need a decision stay open in Lumo.',
    SUMMARY_MARKER,
  ].join('\n\n')
}

// ── sync ────────────────────────────────────────────────────────────────────

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/')
  return { owner: parts[0] ?? '', name: parts[1] ?? '' }
}

function taskUrlOf(pr: ScanForReview['pullRequest']): string | null {
  if (!pr.task) return null
  const identifier = `${pr.task.team.identifier}-${pr.task.number}`
  return `${resolvePublicUrl()}/workspace/${pr.workspace.slug}/my-tasks/${identifier}`
}

/** LUM-849 — the reviewed head on GitHub; null for a repo name we cannot trust. */
export function commitUrlOf(repo: string, sha: string): string | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[0-9a-f]{7,40}$/i.test(sha))
    return null
  return `https://github.com/${repo}/commit/${sha}`
}

function describe(error: unknown): string {
  if (error instanceof GithubApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : String(error)
}

/**
 * LUM-1150 — every writer of a scan syncs it (stage A, the hunt, the managed
 * run, the verifier), and two of them finishing together both listed the PR's
 * comments before either posted: the same finding went up twice. The marker
 * check cannot see a comment that is still in flight, so each sync claims
 * the rows it is about to post and posts only the ones it won.
 *
 * Fail-open: a claim store that cannot be reached posts them all, as before
 * the claim existed — a missing comment is worse than a rare duplicate.
 */
async function claimForPosting(
  rows: ReviewFindingRow[],
  where: string
): Promise<{ won: ReviewFindingRow[]; claimedIds: string[] }> {
  if (rows.length === 0) return { won: [], claimedIds: [] }
  try {
    const won = await prSecurityScanRepository.claimInlineComments(
      rows.map(f => f.id),
      new Date(Date.now() - INLINE_CLAIM_TTL_MS)
    )
    const kept = rows.filter(f => won.has(f.id))
    if (kept.length < rows.length)
      logger.info(
        `[security-pr-review] ${rows.length - kept.length} inline comment(s) claimed by a concurrent sync ${where}`
      )
    return { won: kept, claimedIds: kept.map(f => f.id) }
  } catch (error) {
    logger.warn(
      `[security-pr-review] inline claim failed ${where}: ${describe(error)} — posting unclaimed`
    )
    return { won: rows, claimedIds: [] }
  }
}

/** LUM-1150 — a post that did not land gives its claims back. Never throws. */
async function releaseClaims(ids: string[], where: string): Promise<void> {
  if (ids.length === 0) return
  try {
    await prSecurityScanRepository.releaseInlineCommentClaims(ids)
  } catch (error) {
    // The claims expire after INLINE_CLAIM_TTL_MS; a later sync posts then.
    logger.warn(
      `[security-pr-review] inline claim release failed ${where}: ${describe(error)}`
    )
  }
}

/**
 * LUM-1127 — the token the thread lifecycle runs with. GitHub refuses
 * `resolveReviewThread` / `unresolveReviewThread` to a pull-request-only
 * token, so threads get their own mint (`reviewThreadWrite`). A refused mint
 * must not take the summary down with it: fall back to the pull-request
 * token — the thread mutations then fail, are logged, and the next sync
 * retries them.
 */
async function threadToken(
  workspaceId: string,
  repository: string,
  fallback: string,
  where: string
): Promise<string> {
  try {
    return await getRepoToken(
      workspaceId,
      repository,
      REPO_TOKEN_PERMISSIONS.reviewThreadWrite
    )
  } catch (error) {
    logger.warn(
      `[security-pr-review] thread token mint failed ${where}: ${describe(error)}`
    )
    return fallback
  }
}

/**
 * LUM-1150 — how long the claim on creating a PR's summary holds. The
 * holder does one id re-check and one create (seconds); past this it died
 * and its claim is taken over. Short, because a sync that lost the claim
 * waits it out rather than leave its summary unwritten (follow-up #3).
 */
export const SUMMARY_CLAIM_TTL_MS = 60_000
/**
 * LUM-1150 — a sync that lost the summary claim polls (backing off) for the
 * winner's comment id (then writes its own body into it) and asks for the
 * claim again (a holder that released without an id, or died). It never
 * gives up before the claim could have expired.
 */
const SUMMARY_WAIT_FIRST_STEP_MS = 250
const SUMMARY_WAIT_MAX_STEP_MS = 2_000
const SUMMARY_WAIT_MAX_MS = SUMMARY_CLAIM_TTL_MS + 10_000

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface SummaryTarget {
  repo: { owner: string; name: string }
  prNumber: number
  token: string
  body: string
  scanId: string
  pullRequestId: string
  where: string
}

/** Lumo's own summary comment: carries the marker AND is the App's bot's. */
function isLumoSummaryComment(c: {
  body: string
  user: { type?: string; login?: string } | null
}): boolean {
  return c.body.includes(SUMMARY_MARKER) && isLumoBotComment(c)
}

/** LUM-740 — remember the id on the scan row. Best effort, never throws. */
async function rememberSummaryId(t: SummaryTarget, id: string): Promise<void> {
  try {
    await prSecurityScanRepository.setSummaryCommentId(t.scanId, id)
  } catch (error) {
    // A missed write only costs one listing next time.
    logger.warn(
      `[security-pr-review] summary id write failed ${t.where}: ${describe(error)}`
    )
  }
}

async function findPrSummaryId(pullRequestId: string): Promise<string | null> {
  try {
    return await prSecurityScanRepository.findSummaryCommentIdByPullRequest(
      pullRequestId
    )
  } catch {
    return null
  }
}

/** Update `id` in place; false when it is gone on GitHub (404). */
async function updateSummaryIfPresent(
  t: SummaryTarget,
  id: string
): Promise<boolean> {
  try {
    await prCommentClient.updateIssueComment({
      repo: t.repo,
      externalId: id,
      body: t.body,
      token: t.token,
    })
    return true
  } catch (error) {
    if (error instanceof GithubApiError && error.status === 404) return false
    throw error
  }
}

async function createSummaryComment(t: SummaryTarget): Promise<string> {
  const created = await prCommentClient.createIssueComment({
    repo: t.repo,
    prNumber: t.prNumber,
    body: t.body,
    token: t.token,
  })
  const id = String(created.id)
  await rememberSummaryId(t, id)
  return id
}

/** LUM-1150 — try to take the PR's summary claim; throws when the store is down. */
function claimSummary(t: SummaryTarget): Promise<Date | null> {
  return prSecurityScanRepository.claimSummaryComment(
    t.pullRequestId,
    new Date(Date.now() - SUMMARY_CLAIM_TTL_MS)
  )
}

/**
 * LUM-1150 — this sync holds the claim: re-check for an id (a writer that
 * finished just before), else create. The claim is always given back.
 */
async function writeSummaryUnderClaim(
  t: SummaryTarget,
  gone: string | null,
  claimedAt: Date
): Promise<string> {
  try {
    const existing = await findPrSummaryId(t.pullRequestId)
    if (
      existing &&
      existing !== gone &&
      (await updateSummaryIfPresent(t, existing))
    ) {
      await rememberSummaryId(t, existing)
      return existing
    }
    // The id is on the row before the claim goes: a sync that claims next
    // finds it in its re-check.
    return await createSummaryComment(t)
  } finally {
    try {
      await prSecurityScanRepository.releaseSummaryCommentClaim(
        t.pullRequestId,
        claimedAt
      )
    } catch (error) {
      // The claim expires after SUMMARY_CLAIM_TTL_MS.
      logger.warn(
        `[security-pr-review] summary claim release failed ${t.where}: ${describe(error)}`
      )
    }
  }
}

/**
 * LUM-1150 — create the PR's summary, single-writer per PR. Two write-backs
 * (e.g. the hunt and the verifier finishing together) both found no summary
 * and both created one; the second was never updated again. Now each claims
 * the PR first: the winner re-checks for an id and creates; the loser waits
 * for the winner's id and writes its own body into that comment.
 * `gone` is an id known to be deleted on GitHub (never adopted again).
 *
 * Follow-up #3: the loser never leaves its summary unwritten while the
 * claim could still free up. It used to give up after ~6 s — a holder whose
 * create failed (claim released, no id) or that died (claim live for 5 min)
 * left the PR on an older body, possibly "the scan is still running". It
 * now keeps asking for the claim too, and takes it over once released or
 * expired. Null only past SUMMARY_WAIT_MAX_MS (logged as a warning).
 *
 * Fail-open: a claim store that cannot be reached creates, as before the
 * claim existed — a missing summary is worse than a rare duplicate (which
 * the next scan's heal removes).
 */
async function createSummaryOnce(
  t: SummaryTarget,
  firstGone: string | null
): Promise<string | null> {
  let gone = firstGone
  const deadline = Date.now() + SUMMARY_WAIT_MAX_MS
  // Quick at first (the holder usually finishes in about a second), then
  // backing off: a long wait costs a few dozen reads, not hundreds.
  let step = SUMMARY_WAIT_FIRST_STEP_MS
  for (let first = true; ; first = false) {
    if (!first) {
      await sleep(step)
      step = Math.min(step * 2, SUMMARY_WAIT_MAX_STEP_MS)
      const id = await findPrSummaryId(t.pullRequestId)
      if (id && id !== gone) {
        if (await updateSummaryIfPresent(t, id)) {
          await rememberSummaryId(t, id)
          return id
        }
        // Deleted on GitHub meanwhile: never adopted again.
        gone = id
      }
    }
    let claimedAt: Date | null
    try {
      claimedAt = await claimSummary(t)
    } catch (error) {
      logger.warn(
        `[security-pr-review] summary claim failed ${t.where}: ${describe(error)} — creating unclaimed`
      )
      return createSummaryComment(t)
    }
    if (claimedAt) return writeSummaryUnderClaim(t, gone, claimedAt)
    if (Date.now() >= deadline) {
      logger.warn(
        `[security-pr-review] summary not written — the claim stayed held for ${SUMMARY_WAIT_MAX_MS / 1000}s ${t.where}`
      )
      return null
    }
  }
}

/**
 * LUM-1150 — a PR that carries more than one Lumo summary (written before
 * the claim existed, or by a fail-open create): keep the OLDEST — update it
 * with this body and remember its id — and delete the other Lumo-authored
 * summaries. Only bot comments carrying the marker are touched, and never on
 * a PR another workspace also holds (its summary looks the same, LUM-924).
 * Best effort, never throws; a failed update deletes nothing.
 */
async function healDuplicateSummaries(
  t: SummaryTarget,
  written: string
): Promise<void> {
  try {
    if (
      await prSecurityScanRepository.isPullRequestHeldElsewhere(t.pullRequestId)
    )
      return
    const listing = await prCommentClient.listIssueComments({
      repo: t.repo,
      prNumber: t.prNumber,
      token: t.token,
    })
    const mine = listing
      .filter(isLumoSummaryComment)
      .sort((a, b) => a.id - b.id)
    if (mine.length < 2) return
    const keep = String(mine[0]!.id)
    if (keep !== written) {
      if (!(await updateSummaryIfPresent(t, keep))) return
      await rememberSummaryId(t, keep)
    }
    for (const extra of mine.slice(1)) {
      try {
        await prCommentClient.deleteIssueComment({
          repo: t.repo,
          externalId: String(extra.id),
          token: t.token,
        })
      } catch (error) {
        if (!(error instanceof GithubApiError && error.status === 404))
          logger.warn(
            `[security-pr-review] duplicate summary ${extra.id} not deleted ${t.where}: ${describe(error)}`
          )
      }
    }
    logger.info(
      `[security-pr-review] kept summary ${keep}, removed ${mine.length - 1} duplicate(s) ${t.where}`
    )
  } catch (error) {
    logger.warn(
      `[security-pr-review] duplicate summary check failed ${t.where}: ${describe(error)}`
    )
  }
}

/**
 * LUM-1151 — a head's file list never changes, and one scan is synced
 * several times (stage A, the hunt, the managed run): the list is read once
 * per (repository, PR, head) per server instance. Bounded; a failed read
 * is never kept.
 */
const CHANGED_FILES_CACHE_MAX = 200
const changedFilesCache = new Map<string, ChangedFile[]>()

/** Test hook: forget every cached file list. */
export function clearChangedFilesCache(): void {
  changedFilesCache.clear()
}

/**
 * LUM-1151 — the PR's changed files for the walkthrough; null (no table)
 * when GitHub does not answer. Never throws.
 */
async function changedFilesBestEffort(
  repo: { owner: string; name: string },
  prNumber: number,
  headSha: string,
  token: string,
  where: string
): Promise<ChangedFile[] | null> {
  const key = `${repo.owner}/${repo.name}#${prNumber}@${headSha}`.toLowerCase()
  const cached = changedFilesCache.get(key)
  if (cached) return cached
  try {
    const files = await prCommentClient.listPullRequestFiles({
      repo,
      prNumber,
      token,
    })
    const list = (files ?? []).map(f => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      previousFilename: f.previous_filename ?? null,
    }))
    if (changedFilesCache.size >= CHANGED_FILES_CACHE_MAX) {
      const oldest = changedFilesCache.keys().next().value
      if (oldest !== undefined) changedFilesCache.delete(oldest)
    }
    changedFilesCache.set(key, list)
    return list
  } catch (error) {
    logger.warn(
      `[security-pr-review] changed files unavailable ${where}: ${describe(error)}`
    )
    return null
  }
}

/**
 * LUM-740 — one summary per PR, keyed by a comment id that lives on the scan
 * row (§6 L5 item 6). Order of preference: the id on this scan; the id an
 * earlier scan of the same PR stored; the legacy marker search over the PR's
 * bot comments (skipped when another workspace holds the PR, LUM-924); a
 * fresh create (single-writer per PR, LUM-1150). A stored id whose comment is
 * gone (404) falls through to a create. The id written is remembered on the
 * scan row. The first write of each scan also heals duplicates (LUM-1150);
 * later writes of the same scan update by id without listing. Returns
 * whether the summary was written.
 */
async function upsertSummary(
  t: SummaryTarget & { scanCommentId: string | null }
): Promise<boolean> {
  let known = t.scanCommentId
  let fromEarlierScan = false
  if (!known) {
    known = await findPrSummaryId(t.pullRequestId)
    fromEarlierScan = known !== null
  }

  let written: string | null
  if (known) {
    if (await updateSummaryIfPresent(t, known)) {
      written = known
      if (fromEarlierScan) await rememberSummaryId(t, known)
    } else {
      // The comment was deleted on GitHub: start a new one.
      written = await createSummaryOnce(t, known)
    }
  } else if (
    // LUM-924: when another workspace holds this PR too, its summary carries
    // the same marker under the same App bot — a marker match cannot tell
    // whose it is, so each workspace keeps to the comment id it recorded.
    await prSecurityScanRepository.isPullRequestHeldElsewhere(t.pullRequestId)
  ) {
    written = await createSummaryOnce(t, null)
  } else {
    // Legacy path (rows written before the id column existed): find Lumo's
    // own summary by marker. A human quoting the marker must never be
    // mistaken for it — only a bot-authored comment is eligible. `user` is
    // null on comments whose account has since been deleted; such a comment
    // is simply not ours.
    const issueComments = await prCommentClient.listIssueComments({
      repo: t.repo,
      prNumber: t.prNumber,
      token: t.token,
    })
    const mine = issueComments
      .filter(isLumoSummaryComment)
      .sort((a, b) => a.id - b.id)[0]
    if (mine && (await updateSummaryIfPresent(t, String(mine.id)))) {
      written = String(mine.id)
      await rememberSummaryId(t, written)
    } else {
      written = await createSummaryOnce(t, null)
    }
  }

  if (written === null) return false
  if (!t.scanCommentId) await healDuplicateSummaries(t, written)
  return true
}

/**
 * LUM-1200 — edit each kept finding's comment already on the PR so it lists
 * the findings merged into it since it was posted. Lumo's own thread-opening
 * comments only (the newest one per fingerprint — an older one was left
 * behind by a move); a retracted comment is left alone. Best effort: a failed
 * edit is logged and retried by the next sync, never thrown.
 */
async function listMergedInPostedThreads(input: {
  comments: ListedComment[]
  keptOnPr: string[]
  alsoReportedOf: (fp: string) => ReviewFindingRow[]
  /**
   * LUM-1200 follow-up #4 — the fingerprint whose marker a kept finding's
   * thread carries: its own, or (relabelled since, `threads.carried`) the
   * one the thread was posted under. Looking the comment up by the kept
   * finding's new fingerprint found nothing, so reports merged in later
   * rounds were never listed.
   */
  threadFingerprintOf: (fp: string) => string
  repo: { owner: string; name: string }
  token: string
  where: string
}): Promise<void> {
  for (const fp of input.keptOnPr) {
    const merged = input.alsoReportedOf(fp)
    if (merged.length === 0) continue
    const posted = (markerFp: string) =>
      input.comments
        .filter(
          c =>
            isLumoBotComment(c) &&
            !c.in_reply_to_id &&
            c.body.includes(fingerprintMarker(markerFp)) &&
            !isRetractedComment(c.body)
        )
        .sort((a, b) => b.id - a.id)[0]
    const threadFp = input.threadFingerprintOf(fp)
    const markerFp = posted(threadFp) ? threadFp : fp
    const comment = posted(markerFp)
    if (!comment) continue
    const body = withAlsoReported(comment.body, markerFp, merged)
    if (body === null) continue
    try {
      await prCommentClient.updateReviewLineComment({
        repo: input.repo,
        externalId: String(comment.id),
        body,
        token: input.token,
      })
    } catch (error) {
      logger.warn(
        `[security-pr-review] merged-finding edit failed ${input.where} comment=${comment.id}: ${describe(error)}`
      )
    }
  }
}

/** LUM-1150 — stage A has not persisted its result yet (the body says so). */
function isStageAUnfinished(status: string): boolean {
  return status === 'RUNNING' || status === 'PENDING'
}

/**
 * LUM-1150 follow-up #3 — did stage A finish after this sync read the row?
 * A check that cannot be made answers no (the final write-back still comes
 * from stage A itself).
 */
async function stageAFinishedSince(
  scanId: string,
  where: string
): Promise<boolean> {
  try {
    const status = await prSecurityScanRepository.findStatusById(scanId)
    return status !== null && !isStageAUnfinished(status)
  } catch (error) {
    logger.warn(
      `[security-pr-review] status re-check failed ${where}: ${describe(error)}`
    )
    return false
  }
}

export const securityPrReviewService = {
  /**
   * LUM-892 — the workspace turned scanning off: rewrite the summary comment
   * an earlier scan left on this PR to say so. A PR Lumo never commented on
   * gets nothing (turning scanning off must not start posting). Best effort
   * and idempotent — never throws, and a deleted comment is left deleted.
   */
  async markScanningOff(pr: {
    id: string
    workspaceId: string
    repo: string
    number: number
  }): Promise<{ updated: boolean }> {
    const where = `pr=#${pr.number}`
    try {
      const commentId =
        await prSecurityScanRepository.findSummaryCommentIdByPullRequest(pr.id)
      if (!commentId) return { updated: false }
      const token = await getRepoToken(
        pr.workspaceId,
        pr.repo,
        REPO_TOKEN_PERMISSIONS.pullRequestWrite
      )
      await prCommentClient.updateIssueComment({
        repo: parseRepo(pr.repo),
        externalId: commentId,
        body: buildScanningOffSummary(),
        token,
      })
      return { updated: true }
    } catch (error) {
      logger.warn(
        `[security-pr-review] scanning-off notice failed ${where}: ${describe(error)}`
      )
      return { updated: false }
    }
  },

  /**
   * Post (or refresh) the security review on the scan's PR. Best effort: any
   * GitHub or database failure is logged and reported in the result, never
   * thrown — the callers are `waitUntil` and workflow steps that must not be
   * failed by a comment.
   */
  async sync(scanId: string): Promise<SyncResult> {
    const result = await securityPrReviewService.syncReview(scanId)
    // LUM-911: a zero-retention workspace keeps the scan's code only until
    // its review is on the PR.
    await scrubScanIfZeroRetention(scanId)
    return result
  },

  /** `sync` without the zero-retention scrub that follows it. */
  async syncReview(scanId: string): Promise<SyncResult> {
    let scan: ScanForReview | null
    try {
      scan = await prSecurityScanRepository.findByIdForReview(scanId)
    } catch (error) {
      logger.warn(
        `[security-pr-review] load failed scan=${scanId}: ${describe(error)}`
      )
      return NOTHING
    }
    if (!scan || !scan.pullRequest?.number) return NOTHING

    const pr = scan.pullRequest
    const repo = parseRepo(pr.repo)
    const where = `scan=${scanId} pr=#${pr.number}`

    // LUM-901: a late writer (this scan's hunt or managed run landing after a
    // newer push, or after the workspace turned scanning off) must not put an
    // old summary back over the newer scan's or the scanning-off notice. A
    // check that cannot be made leaves the comment alone.
    try {
      if (pr.headSha && pr.headSha !== scan.headSha) return NOTHING
      if (!(await loadSecurityLayers(pr.workspaceId)).scan) {
        logger.info(`[security-pr-review] scanning off — not synced ${where}`)
        return NOTHING
      }
      if (await prSecurityScanRepository.hasNewerScanThan(scan.id)) {
        logger.info(`[security-pr-review] superseded — not synced ${where}`)
        return NOTHING
      }
    } catch (error) {
      logger.warn(
        `[security-pr-review] currency check failed ${where}: ${describe(error)}`
      )
      return NOTHING
    }

    let posted = false
    let inline = 0
    let skipped = 0
    let finishedMeanwhile = false
    // LUM-1150: claims this sync holds on comments it has not posted yet.
    let pendingClaims: string[] = []
    try {
      const token = await getRepoToken(
        pr.workspaceId,
        pr.repo,
        REPO_TOKEN_PERMISSIONS.pullRequestWrite
      )

      // LUM-738: a persisting row (already on the default branch) is not
      // this PR's — it is neither open, nor blocking, nor commented inline.
      const undecided = scan.findings.filter(
        f => f.disposition === null && !f.persisting
      )
      // LUM-988: a row the agentic verifier rejected is not open — it gets
      // no inline comment and no count, only the summary's one line.
      const unrejected = undecided.filter(f => !isVerifierRejected(f))
      const verifierRejected = undecided.length - unrejected.length
      // LUM-740: the workspace policy says what blocks DONE (LLM never).
      const policy = parseSecurityPolicy(pr.workspace?.securityPolicy)
      // LUM-1130: the request-changes workflow (off by default).
      const requestChanges =
        pr.workspace?.securityRequestChangesEnabled === true
      // LUM-1147: which findings this scan comments inline.
      const profile = parseReviewProfile(scan.reviewProfile)
      const isInline = (f: ReviewFindingRow) =>
        inlineEligible(f, policy, profile)

      const reviewComments = await prCommentClient.listReviewComments({
        repo,
        prNumber: pr.number,
        token,
      })
      // LUM-1127: the inline threads' lifecycle — resolve what a complete
      // pass no longer reports, reopen regressions, honour a human's resolve.
      const threadCtx: ThreadSyncContext = {
        pullRequestId: pr.id,
        workspaceId: pr.workspaceId,
        repo,
        prNumber: pr.number,
        token: await threadToken(pr.workspaceId, pr.repo, token, where),
        headSha: scan.headSha,
        scan: {
          status: scan.status,
          stages: scan.stages,
          judgeReviewScope: scan.judgeReviewScope ?? null,
          partialCauses: scan.partialCauses ?? [],
        },
        findings: scan.findings,
        open: unrejected,
        comments: reviewComments,
        isInline,
        isBlocking: f => isBlockingFinding(f, policy),
      }
      const threads = await prFindingThreadService
        .reconcile(threadCtx)
        .catch(() => NO_THREADS)
      const existing = parseFingerprintMarkers(reviewComments.map(c => c.body))
      // LUM-1127: never re-post a thread a human resolved (even once its
      // comment has fallen out of the listing window); a moved finding gets a
      // fresh comment although its old one still carries the marker.
      for (const fp of threads.resolvedByUser) existing.add(fp)
      for (const fp of threads.repost.keys()) existing.delete(fp)
      // LUM-1127 follow-up: a finding that continues an open thread under a
      // new fingerprint (relabelled rule id) already has that thread.
      for (const fp of threads.carried.keys()) existing.add(fp)
      // LUM-1200: one issue, one thread. The AI review and the hunt
      // reporting the same issue — the same line with a compatible class, or
      // a nearby line with a similar title (`sameIssueScore`) — are grouped:
      // the kept finding owns the thread, the merged one is listed in it
      // (both stay recorded, each keeps its fingerprint). Grouped over every
      // undecided inline row — a thread a human resolved included — so a
      // merged row follows its kept thread rather than surfacing on its own;
      // a resolved thread takes in only a row that neither blocks DONE nor is
      // more severe (the LUM-1127 carry rule), so the other layer never
      // re-raises an issue the developer resolved. A disposition never
      // cascades: once the kept row is dispositioned it leaves this set, and
      // a merged row still open gets its own thread.
      // LUM-1200 follow-up #5: a finding that already has a thread is
      // grouped whatever its severity — a thread owner relabelled LOW still
      // takes in the other layer's report of its issue (only inline-eligible
      // findings are ever posted; see `candidates`).
      const groupable = groupingCandidates(unrejected, isInline, existing)
      const issueGroups = groupSameIssue(groupable, {
        posted: existing,
        isBlocking: f => isBlockingFinding(f, policy),
        resolvedByUser: threads.resolvedByUser,
      })
      // LUM-1200 follow-up #3: a cross-layer pair just outside the line
      // window keeps two threads; logged (rule ids and distance only) so the
      // window can be tuned on real pairs.
      const nearMisses = crossLayerNearMisses(groupable, issueGroups.mergedInto)
      if (nearMisses.length > 0)
        logger.info(
          'security-pr-review: cross-layer reports outside the same-issue window',
          { scanId: scan.id, nearMisses }
        )
      // LUM-1127: a thread a human resolved on GitHub closes a non-blocking
      // finding. A gate-blocking one stays open (and blocking) until it is
      // dispositioned in Lumo — resolving a conversation is not a decision.
      // LUM-1200: a merged finding shares its kept finding's thread.
      const resolvedThread = (f: ReviewFindingRow) =>
        threads.resolvedByUser.has(
          issueGroups.mergedInto.get(f.fingerprint) ?? f.fingerprint
        )
      const open = unrejected.filter(
        f => !resolvedThread(f) || isBlockingFinding(f, policy)
      )
      const blocking = open.filter(f => isBlockingFinding(f, policy)).length
      // LUM-1148: the pre-merge checks of THIS head, and the PR's override.
      const checksRecord = checksForHead(scan.preMergeChecks, scan.headSha)
      const checksOverride = overrideFromColumns(pr)
      const failingChecks = blockingCheckCount(checksRecord, checksOverride)
      const externalCounts: Record<string, number> = {}
      for (const f of open) {
        const tool = externalTool(f.ruleId)
        if (
          f.provenance === 'EXTERNAL_TOOL' &&
          tool &&
          f.kind !== 'DEPENDENCY'
        ) {
          externalCounts[tool] = (externalCounts[tool] ?? 0) + 1
        }
      }
      const dependencies = scan.stages?.supplyChain
        ? {
            open: open.filter(f => f.kind === 'DEPENDENCY').length,
            persisting: scan.findings.filter(
              f => f.kind === 'DEPENDENCY' && f.persisting
            ).length,
          }
        : undefined

      // LUM-988: a verdict that landed after the hold window finds its
      // comment already on the PR — edit it to say so, rather than leave a
      // comment the summary calls "shown in Lumo only".
      await reconcileVerifierComments({
        rejected: undecided.filter(isVerifierRejected),
        open,
        comments: reviewComments,
        policy,
        profile,
        repo,
        token,
      })
      // LUM-740: LOW rows and LLM-suggested false positives stay off the
      // diff — the summary carries one line for each group instead.
      // LUM-1147: a LOW row the profile comments inline (assertive, or one
      // that blocks DONE, or a path instruction asked for) is not "shown in
      // Lumo only"; one quiet holds back is listed by name instead.
      // LUM-1212: would be inline but has no line — listed by name instead.
      const unanchored = open.filter(
        f =>
          f.line === null &&
          inlineEligibleUnder(profile, { ...f, line: 0 }, policy) &&
          !issueGroups.mergedInto.has(f.fingerprint)
      )
      const lowRows = open.filter(
        f =>
          f.severity === 'LOW' &&
          !isInline(f) &&
          !heldByProfile(profile, f, policy) &&
          !unanchored.includes(f)
      )
      const low = {
        count: lowRows.length,
        allDowngradedPaths: lowRows.every(f => isDowngradedPath(f.filePath)),
      }
      // `== null`: rows read by callers written before the column existed
      // (tests, older projections) carry `undefined`, which is "not suggested".
      const suggested = open.filter(f => f.suggestedDisposition != null).length
      // LUM-740: the hunt run syncs concurrently with the managed run —
      // until the suggested-disposition pass has stamped this scan, an
      // EXTERNAL_TOOL row may still become a suggested false positive, so it
      // waits (the summary still counts it). Deterministic rows never wait.
      const holdExternal = isSuggestEnabled() && scan.suggestedAt == null
      // LUM-988: likewise LLM_JUDGE rows while the verifier is running — the
      // summary posts at once; their inline comments wait for its verdicts
      // (or for VERIFIER_HOLD_MS, after which they post unverified).
      const holdJudge = verifierHolding(
        {
          verifierStartedAt: scan.verifierStartedAt ?? null,
          verifiedAt: scan.verifiedAt ?? null,
        },
        Date.now()
      )
      // Only findings on a line this PR added can carry an inline comment;
      // the rest are still counted by the summary.
      // LUM-1147: the review profile decides which (HIGH and blocking always).
      const candidates = open.filter(
        f =>
          isInline(f) &&
          // LUM-1200: listed in its kept finding's thread instead.
          !issueGroups.mergedInto.has(f.fingerprint) &&
          !(holdExternal && f.provenance === 'EXTERNAL_TOOL') &&
          // Only rows the verifier may reject wait for it.
          !(holdJudge && f.provenance === 'LLM_JUDGE' && verifierAppliesTo(f))
      )
      const unposted = candidates
        .filter(f => !existing.has(f.fingerprint))
        .sort(
          (a, b) =>
            SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
            PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance]
        )
        .slice(0, REVIEW_MAX_INLINE)
      // LUM-1150: a concurrent sync of this scan may be posting some of them.
      const claim = await claimForPosting(unposted, where)
      const selected = claim.won
      pendingClaims = claim.claimedIds
      // Already on the PR (or being posted by a concurrent sync), or over the
      // cap and waiting for the next sync.
      skipped = candidates.length - selected.length
      // LUM-1200: the merged findings each kept thread lists — only those
      // still open (a merged row a human closed with its thread is not).
      const openFps = new Set(open.map(f => f.fingerprint))
      const alsoReportedOf = (fp: string): ReviewFindingRow[] =>
        (issueGroups.mergedOf.get(fp) ?? []).filter(m =>
          openFps.has(m.fingerprint)
        )

      // LUM-1151: the high-level summary goes into the PR description when
      // the repository wants it there — before the comment, which then only
      // points to it. Not written (a failed edit, a closed PR): the comment
      // keeps it, as before.
      const summaryMode = parseHighLevelSummary(scan.highLevelSummary)
      let summaryWhere: 'comment' | 'description' | 'off' = summaryMode
      if (summaryMode === 'description') {
        const outcome =
          pr.state === undefined || pr.state === 'open'
            ? await prDescriptionSummaryService.sync({
                repo,
                prNumber: pr.number,
                token,
                prSummary: scan.prSummary,
                headSha: scan.headSha,
                commitUrl: commitUrlOf(pr.repo, scan.headSha),
              })
            : 'not_open'
        if (outcome !== 'written' && outcome !== 'unchanged')
          summaryWhere = 'comment'
      }
      const changedFiles = await changedFilesBestEffort(
        repo,
        pr.number,
        scan.headSha,
        token,
        where
      )

      const summary = buildSummary({
        repo: pr.repo,
        prNumber: pr.number,
        headSha: scan.headSha,
        stages: scan.stages ?? {},
        status: scan.status,
        partial: scan.partial,
        huntProgress: huntBatchProgress(
          scan.huntJob,
          (scan.stages as ScanStages | null)?.hunt
        ),
        ...scanSizeCaps({
          stages: scan.stages as ScanStages | null,
          partialCauses: scan.partialCauses ?? [],
          huntAudit: scan.huntAudit,
          judgeBudget: scan.judgeBudget,
          error: scan.error,
        }),
        partialCauses: scan.partialCauses ?? [],
        externalCounts,
        open: open.length,
        // Same predicate as every other surface (CORRECTNESS ⇔ review:).
        openBugs: open.filter(f => isCodeReviewFinding(f.ruleId)).length,
        blocking,
        ...(dependencies ? { dependencies } : {}),
        low,
        suggested,
        verifierRejected,
        error: scan.error,
        taskUrl: taskUrlOf(pr),
        commandHandle: prCommandHandle(),
        approveCommand: requestChanges,
        repoConfig: parseRepoConfigNotice(scan.repoConfig),
        reviewPathSkips: parseReviewPathSkips(scan.reviewPathSkips),
        preMergeChecks: checksRecord,
        preMergeOverride: checksOverride,
        reviewProfile: profile,
        profileHeld: open.filter(f => heldByProfile(profile, f, policy)),
        unanchored,
        prSummary: scan.prSummary,
        highLevelSummary: summaryWhere,
        changedFiles,
        sequenceDiagram: scan.sequenceDiagram,
        // LUM-849: the rows a reader acts on — LOW and suggested false
        // positives stay off the diff, so they stay off this line too.
        attentionFiles: open
          .filter(f => f.severity !== 'LOW' && f.suggestedDisposition == null)
          .map(f => f.filePath),
        commitUrl: commitUrlOf(pr.repo, scan.headSha),
        threads: {
          ...threads.counts,
          // About to be posted below: open threads from this sync on.
          open:
            threads.counts.open +
            selected.filter(f => !threads.repost.has(f.fingerprint)).length,
        },
      })
      // LUM-740: the id goes on the scan row so the next writer (this scan's
      // own hunt run, or the next push's scan) updates it instead of listing.
      // LUM-1150: false = a concurrent sync of this PR is creating it.
      posted = await upsertSummary({
        repo,
        prNumber: pr.number,
        token,
        body: summary,
        scanId: scan.id,
        scanCommentId: scan.summaryCommentId,
        pullRequestId: pr.id,
        where,
      })
      // LUM-1150 follow-up #3: this body was built while stage A was still
      // running; if it finished meanwhile, a slower interim write may have
      // landed over (or instead of) its final one — write again below.
      if (posted && isStageAUnfinished(scan.status))
        finishedMeanwhile = await stageAFinishedSince(scanId, where)

      // LUM-1149: requirements of the linked task / issue this head does not
      // address — one review comment per distinct set. Never throws.
      await issueAssessmentReviewService.flagUnmet({
        repo,
        prNumber: pr.number,
        token,
        headSha: scan.headSha,
        record: checksRecord,
      })

      // LUM-1200: a finding merged into a thread already on the PR (the
      // hunt lands minutes after the AI review) is listed in that comment.
      await listMergedInPostedThreads({
        comments: reviewComments,
        keptOnPr: [...issueGroups.mergedOf.keys()].filter(
          fp => existing.has(fp) && openFps.has(fp)
        ),
        alsoReportedOf,
        threadFingerprintOf: fp => threads.carried.get(fp) ?? fp,
        repo,
        token,
        where,
      })

      if (selected.length > 0) {
        const winners = suggestionWinners(selected)
        const postReview = (withSuggestions: boolean) =>
          prCommentClient.createReview({
            repo,
            prNumber: pr.number,
            token,
            commitId: scan.headSha,
            body: `🛡️ Lumo security scan — ${scan.headSha.slice(0, 7)}`,
            // LUM-1130: actionable inline comments request changes when the
            // workspace turned the workflow on; otherwise only annotate.
            event: requestChanges ? 'REQUEST_CHANGES' : 'COMMENT',
            comments: selected.map(f =>
              inlineReviewComment(
                f,
                policy,
                withSuggestions && winners.has(f.fingerprint),
                alsoReportedOf(f.fingerprint)
              )
            ),
          })
        try {
          let review
          try {
            review = await postReview(true)
          } catch (error) {
            // LUM-1150: a suggestion's range GitHub will not take must not
            // cost the comments — retry once with every comment back on its
            // own line and no suggestion. Anything else goes to the handler.
            if (
              !(error instanceof GithubApiError && error.status === 422) ||
              winners.size === 0
            )
              throw error
            logger.warn(
              `[security-pr-review] suggestions rejected ${where}: ${describe(error)} — posting without them`
            )
            review = await postReview(false)
          }
          inline = selected.length
          // On the PR now: the markers guard it from here on.
          pendingClaims = []
          // LUM-1127: give each new comment its thread row.
          if (review?.id)
            await prFindingThreadService.recordPosted(
              threadCtx,
              review.id,
              selected,
              threads.repost
            )
        } catch (error) {
          // Whatever the failure, none of `selected` made it onto the PR —
          // count them as skipped either way so the next sync retries them.
          // 422 is GitHub refusing a line that is not in the diff it sees
          // (a stale sha, a file collapsed as too large): the summary is
          // already out, so warn and let the next sync try again. Any other
          // error is unexpected and rethrown to the outer catch below.
          skipped += selected.length
          // LUM-1150: none of them landed — the next sync must be able to
          // claim them again.
          await releaseClaims(pendingClaims, where)
          pendingClaims = []
          if (error instanceof GithubApiError && error.status === 422) {
            logger.warn(
              `[security-pr-review] review rejected ${where}: ${describe(error)}`
            )
          } else {
            throw error
          }
        }
      }

      // LUM-1130: request changes while anything is open; approve once the
      // latest head's complete review leaves nothing open. Never throws.
      if (requestChanges) {
        const newThreads =
          inline > 0
            ? selected.filter(f => !threads.repost.has(f.fingerprint)).length
            : 0
        const postedNow = new Set(
          inline > 0 ? selected.map(f => f.fingerprint) : []
        )
        await prReviewVerdictService.apply({
          repo,
          prNumber: pr.number,
          token,
          headSha: scan.headSha,
          scan: {
            status: scan.status,
            partial: scan.partial,
            stages: (scan.stages as ScanStages | null) ?? null,
          },
          openThreads: threads.counts.open + newThreads,
          blocking,
          failingChecks,
          unpostedActionable: open.filter(
            f =>
              isInline(f) &&
              // LUM-1200: rides on its kept finding's thread.
              !issueGroups.mergedInto.has(f.fingerprint) &&
              !existing.has(f.fingerprint) &&
              !postedNow.has(f.fingerprint)
          ).length,
        })
      } else if (pr.state === 'open') {
        // LUM-1140: the mode is off — a "changes requested" Lumo left while
        // it was on (one the bulk pass on turning it off missed) is
        // dismissed here. Never approves; never throws.
        await requestChangesOffService.withdrawOnPullRequest(
          {
            id: pr.id,
            workspaceId: pr.workspaceId,
            repo: pr.repo,
            number: pr.number,
          },
          token
        )
      }
    } catch (error) {
      logger.warn(`[security-pr-review] ${where}: ${describe(error)}`)
      // LUM-1150: failed between claiming and posting (e.g. the summary).
      await releaseClaims(pendingClaims, where)
      if (!posted) skipped = 0
    }
    // LUM-1150 follow-up #3: also after a later step failed — the interim
    // body must not stay on the PR either way.
    if (finishedMeanwhile) {
      logger.info(
        `[security-pr-review] stage A finished during this sync — writing the final summary ${where}`
      )
      // Reads the finished row, so it does not come back here.
      const final = await securityPrReviewService.syncReview(scanId)
      return {
        posted: posted || final.posted,
        inline: inline + final.inline,
        // What is still waiting is what the final pass left waiting.
        skipped: final.skipped,
      }
    }
    return { posted, inline, skipped }
  },
}
