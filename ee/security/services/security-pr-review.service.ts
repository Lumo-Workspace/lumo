/**
 * LUM-735 Task 2 — post a scan back to its pull request, CodeRabbit-style.
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
import { isDowngradedPath } from '@/lib/security-scan/secret-patterns'
import { isSuggestEnabled } from '@/ee/security/services/security-suggest.config'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import {
  isVerifierRejected,
  verifierAppliesTo,
  verifierHolding,
} from '@/ee/security/security-scan/verifier'
import {
  SCAN_STAGE_KEYS,
  SCAN_STAGE_DESCRIPTIONS,
  SCAN_STAGE_LABELS,
  SCAN_UNFINISHED_NOTE,
  SCANNING_OFF_NOTE,
  formatHuntOverCap,
  formatHuntProgress,
  formatJudgeOverCap,
  formatPrTooLarge,
  formatTurnedOffNote,
  isCodeReviewFinding,
  isOwnedUnfinished,
  scanCoverageState,
  turnedOffLayers,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type HuntProgressInput,
  type PrTooLargeInput,
  scanStageLabel,
  scanStageStateLabel,
} from '@/shared/src/security-scan'
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
  prFindingThreadService,
  type ThreadCounts,
  type ThreadSyncContext,
} from '@/ee/security/services/pr-finding-thread.service'

/** How many inline comments one sync may post. The rest wait for the next one. */
export const REVIEW_MAX_INLINE = 50

export const SUMMARY_MARKER = '<!-- lumo-security:summary -->'

export const fingerprintMarker = (fp: string): string =>
  `<!-- lumo-security:fp:${fp} -->`

const FINGERPRINT_MARKER_RE = /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/g

/** Stage order in the summary line; only keys the scan actually carries show. */
const STAGE_ORDER: readonly ScanStageKey[] = SCAN_STAGE_KEYS

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
  /** Open findings on added lines this sync did not post: already on the PR, over the cap, or lost to a 422. */
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

/** Would the write-back give this row an inline comment today (ignoring holds)? */
function inlineEligible(
  f: Pick<ReviewFindingRow, 'line' | 'severity' | 'suggestedDisposition'>
): boolean {
  return (
    f.line !== null && f.severity !== 'LOW' && f.suggestedDisposition == null
  )
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
          body: inlineEligible(f)
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

/** P8: `evidence` is not a parameter here, so it cannot leak by accident. */
export function buildInlineComment(
  f: InlineFinding,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
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
  const footer: string[] = []
  const href = ruleDocsHref(f.externalRef)
  if (href) footer.push(`[Rule docs](${href})`)
  if (isBlockingFinding(f, policy)) footer.push('blocks DONE')
  if (footer.length > 0) blocks.push(footer.join(' · '))
  blocks.push(fingerprintMarker(f.fingerprint))
  return blocks.join('\n\n')
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
  /** LUM-1079 — the whole PR was too large to scan: nothing ran. */
  prTooLarge?: PrTooLargeInput | null
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
export function commandsBlock(handle: string): string {
  const rows = [
    ['review', 'incremental review of the changes since the last complete one'],
    ['full review', 'review the whole PR again'],
    ['pause', 'stop automatic AI reviews on new pushes'],
    ['resume', 'resume them and reset the round budget'],
    [
      'resolve',
      "resolve Lumo's open threads (findings that block DONE stay open)",
    ],
  ].map(([c, what]) => `- \`${handle} ${c}\` — ${what}`)
  return `<details>\n<summary>Lumo commands</summary>\n\nComment on this PR (write access required):\n\n${rows.join('\n')}\n\n</details>`
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
    const status = [scanStageStateLabel(state), extra]
      .filter(Boolean)
      .join(' · ')
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
      input.huntOverCap || input.judgeOverCap || input.prTooLarge
    ),
  })
  const blocks: string[] = [
    '### 🛡️ Lumo security scan',
    verdictLine(input, coverage, owned),
    ...intentBlocks(input.prSummary),
  ]
  const attention = attentionLine(input.attentionFiles)
  if (attention) blocks.push(attention)
  const threads = threadsLine(input.threads)
  if (threads) blocks.push(threads)

  const notices: string[] = []
  if (Object.values(input.stages).includes('PAUSED')) {
    const command =
      input.prNumber && input.repo
        ? `lumo pr scan ${input.prNumber} --repo ${sanitizeField(input.repo)} --review incremental`
        : 'lumo pr scan <number> --repo <owner/repo> --review incremental'
    const h = input.commandHandle
    notices.push(
      h
        ? `- Automatic AI checks are paused or their round budget is exhausted. This commit has not been fully reviewed. Comment \`${h} review\` for an incremental review or \`${h} full review\`, and \`${h} resume\` to reset the automatic round budget (CLI: \`${command}\`).`
        : `- Automatic AI checks are paused or their round budget is exhausted. This commit has not been fully reviewed. Request an incremental review with \`${command}\`, or use \`--review full\`. Use \`--resume\` to reset the automatic round budget.`
    )
  }
  // With findings open, the owned note still has to be said once.
  if (input.open > 0 && owned)
    notices.push(`- ${capitalize(SCAN_UNFINISHED_NOTE)}.`)
  // LUM-1079: the whole PR was too large — why, and what to do.
  if (input.prTooLarge) notices.push(`- ${formatPrTooLarge(input.prTooLarge)}`)
  // LUM-832: a layer over its size cap did not run — stated the way
  // CodeRabbit states its own limit.
  if (input.judgeOverCap)
    notices.push(`- ${formatJudgeOverCap(input.judgeOverCap)}`)
  if (input.huntOverCap)
    notices.push(`- ${formatHuntOverCap(input.huntOverCap)}`)
  // LUM-892: the customer's own choice, said as such — never "didn't finish".
  const turnedOff = turnedOffLayers(input.stages)
  if (turnedOff.length > 0) notices.push(`- ${formatTurnedOffNote(turnedOff)}`)
  const low = lowLine(input)
  if (low) notices.push(low)
  const suggested = suggestedLine(input)
  if (suggested) notices.push(suggested)
  const rejected = verifierRejectedLine(input)
  if (rejected) notices.push(rejected)
  if (notices.length > 0) blocks.push(notices.join('\n'))
  const failure = scrubbedFailureReason(input)
  if (failure) blocks.push(`⚠ ${failure.label}: ${failure.reason}`)

  // The per-layer lines stay, folded: detail for whoever wants it, not the
  // first thing a reader has to decode — and each says what it looks for.
  const layers = layerLines(input)
  if (layers.length > 0) {
    blocks.push(
      `<details>\n<summary>What was checked</summary>\n\n${layers.join('\n')}\n\n</details>`
    )
  }

  // LUM-1129: the PR comment commands, folded like the layer detail.
  if (input.commandHandle) blocks.push(commandsBlock(input.commandHandle))

  const sha = input.headSha.slice(0, 7)
  const footer = [
    `Reviewed commit: ${input.commitUrl ? `[${sha}](${input.commitUrl})` : sha}`,
  ]
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
 * LUM-740 — one summary per PR, keyed by a comment id that lives on the scan
 * row (§6 L5 item 6). Order of preference: the id on this scan; the id an
 * earlier scan of the same PR stored; the legacy marker search over the PR's
 * bot comments (skipped when another workspace holds the PR, LUM-924); a
 * fresh create. A stored id whose comment is gone (404)
 * falls through to a create. Returns the id the caller should persist on the
 * row (null when the row already had it).
 */
async function upsertSummary(input: {
  repo: { owner: string; name: string }
  prNumber: number
  token: string
  body: string
  scanCommentId: string | null
  pullRequestId: string
}): Promise<string | null> {
  const { repo, prNumber, token, body } = input
  const create = async (): Promise<string> => {
    const created = await prCommentClient.createIssueComment({
      repo,
      prNumber,
      body,
      token,
    })
    return String(created.id)
  }

  let known = input.scanCommentId
  let fromEarlierScan = false
  if (!known) {
    try {
      known = await prSecurityScanRepository.findSummaryCommentIdByPullRequest(
        input.pullRequestId
      )
    } catch {
      known = null
    }
    fromEarlierScan = known !== null
  }
  if (known) {
    try {
      await prCommentClient.updateIssueComment({
        repo,
        externalId: known,
        body,
        token,
      })
      return fromEarlierScan ? known : null
    } catch (error) {
      if (!(error instanceof GithubApiError && error.status === 404))
        throw error
      // The comment was deleted on GitHub: start a new one.
      return create()
    }
  }

  // LUM-924: when another workspace holds this PR too, its summary carries
  // the same marker under the same App bot — a marker match cannot tell whose
  // it is, so each workspace keeps to the comment id it recorded itself.
  if (
    await prSecurityScanRepository.isPullRequestHeldElsewhere(
      input.pullRequestId
    )
  ) {
    return create()
  }

  // Legacy path (rows written before the id column existed): find Lumo's
  // own summary by marker. A human quoting the marker must never be
  // mistaken for it — only a bot-authored comment is eligible. `user` is
  // null on comments whose account has since been deleted; such a comment
  // is simply not ours.
  const issueComments = await prCommentClient.listIssueComments({
    repo,
    prNumber,
    token,
  })
  const mine = issueComments.find(
    c => c.body.includes(SUMMARY_MARKER) && isLumoBotComment(c)
  )
  if (mine) {
    await prCommentClient.updateIssueComment({
      repo,
      externalId: String(mine.id),
      body,
      token,
    })
    return String(mine.id)
  }
  return create()
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
        token,
        headSha: scan.headSha,
        scan: {
          status: scan.status,
          stages: scan.stages,
          judgeReviewScope: scan.judgeReviewScope ?? null,
        },
        findings: scan.findings,
        open: unrejected,
        comments: reviewComments,
      }
      const threads = await prFindingThreadService
        .reconcile(threadCtx)
        .catch(() => NO_THREADS)
      // LUM-1127: a thread a human resolved on GitHub closes a non-blocking
      // finding. A gate-blocking one stays open (and blocking) until it is
      // dispositioned in Lumo — resolving a conversation is not a decision.
      const open = unrejected.filter(
        f =>
          !threads.resolvedByUser.has(f.fingerprint) ||
          isBlockingFinding(f, policy)
      )
      const blocking = open.filter(f => isBlockingFinding(f, policy)).length
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

      const existing = parseFingerprintMarkers(reviewComments.map(c => c.body))
      // LUM-1127: never re-post a thread a human resolved (even once its
      // comment has fallen out of the listing window); a moved finding gets a
      // fresh comment although its old one still carries the marker.
      for (const fp of threads.resolvedByUser) existing.add(fp)
      for (const fp of threads.repost.keys()) existing.delete(fp)
      // LUM-988: a verdict that landed after the hold window finds its
      // comment already on the PR — edit it to say so, rather than leave a
      // comment the summary calls "shown in Lumo only".
      await reconcileVerifierComments({
        rejected: undecided.filter(isVerifierRejected),
        open,
        comments: reviewComments,
        policy,
        repo,
        token,
      })
      // LUM-740: LOW rows and LLM-suggested false positives stay off the
      // diff — the summary carries one line for each group instead.
      const lowRows = open.filter(f => f.severity === 'LOW')
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
      const candidates = open.filter(
        f =>
          f.line !== null &&
          f.severity !== 'LOW' &&
          f.suggestedDisposition == null &&
          !(holdExternal && f.provenance === 'EXTERNAL_TOOL') &&
          // Only rows the verifier may reject wait for it.
          !(holdJudge && f.provenance === 'LLM_JUDGE' && verifierAppliesTo(f))
      )
      const selected = candidates
        .filter(f => !existing.has(f.fingerprint))
        .sort(
          (a, b) =>
            SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
            PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance]
        )
        .slice(0, REVIEW_MAX_INLINE)
      // Already on the PR, or over the cap and waiting for the next sync.
      skipped = candidates.length - selected.length

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
        prSummary: scan.prSummary,
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
      const idToStore = await upsertSummary({
        repo,
        prNumber: pr.number,
        token,
        body: summary,
        scanCommentId: scan.summaryCommentId,
        pullRequestId: pr.id,
      })
      posted = true
      // LUM-740: remember the comment so the next writer (this scan's own
      // hunt run, or the next push's scan) updates it instead of listing —
      // best effort, a missed write only costs one listing next time.
      if (idToStore) {
        try {
          await prSecurityScanRepository.setSummaryCommentId(scan.id, idToStore)
        } catch (error) {
          logger.warn(
            `[security-pr-review] summary id write failed ${where}: ${describe(error)}`
          )
        }
      }

      if (selected.length > 0) {
        try {
          const review = await prCommentClient.createReview({
            repo,
            prNumber: pr.number,
            token,
            commitId: scan.headSha,
            body: `🛡️ Lumo security scan — ${scan.headSha.slice(0, 7)}`,
            comments: selected.map(f => ({
              path: f.filePath,
              line: f.line as number,
              side: 'RIGHT' as const,
              body: buildInlineComment(f, policy),
            })),
          })
          inline = selected.length
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
          if (error instanceof GithubApiError && error.status === 422) {
            logger.warn(
              `[security-pr-review] review rejected ${where}: ${describe(error)}`
            )
          } else {
            throw error
          }
        }
      }
    } catch (error) {
      logger.warn(`[security-pr-review] ${where}: ${describe(error)}`)
      return { posted, inline, skipped: posted ? skipped : 0 }
    }
    return { posted, inline, skipped }
  },
}
