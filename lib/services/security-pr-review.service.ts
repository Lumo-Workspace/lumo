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
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { prSecurityScanRepository } from '@/lib/repositories/pr-security-scan.repository'
import type {
  FindingProvenance,
  FindingSeverity,
  ReviewFindingRow,
  ScanForReview,
} from '@/lib/repositories/pr-security-scan.repository'
import { isBlockingFinding } from '@/lib/services/pr-security-scan-gate'
import {
  DEFAULT_SECURITY_POLICY,
  parseSecurityPolicy,
  type SecurityPolicy,
} from '@/lib/security-scan/policy'
import type { ScanStageKey, ScanStages } from '@/lib/security-scan/types'
import { EXTERNAL_ERROR_PREFIX } from '@/lib/security-scan/stages'
import { isDowngradedPath } from '@/lib/security-scan/secret-patterns'
import { isSuggestEnabled } from '@/lib/services/security-suggest.config'
import {
  SCAN_STAGE_KEYS,
  SCAN_STAGE_DESCRIPTIONS,
  SCAN_STAGE_LABELS,
  SCAN_UNFINISHED_NOTE,
  formatHuntOverCap,
  formatHuntProgress,
  formatJudgeOverCap,
  isOwnedUnfinished,
  scanCoverageState,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type HuntProgressInput,
  scanStageLabel,
  scanStageStateLabel,
} from '@/shared/src/security-scan'
import { resolvePublicUrl } from '@/lib/utils/public-url'
import { huntBatchProgress } from '@/lib/security-scan/hunt/batches'
import { scanSizeCaps } from '@/lib/security-scan/size-caps'
import { parsePrSummary } from '@/lib/security-scan/pr-summary'
import { sanitizeField } from '@/shared/src/sanitize'

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
>

/** P8: `evidence` is not a parameter here, so it cannot leak by accident. */
export function buildInlineComment(
  f: InlineFinding,
  policy: SecurityPolicy = DEFAULT_SECURITY_POLICY
): string {
  const blocks: string[] = [
    `**Lumo · ${provenanceLabel(f)} · ${f.severity}** — ${f.title}`,
  ]
  const detail = f.detail.trim()
  if (detail.length > 0) blocks.push(detail)
  const footer: string[] = []
  if (f.externalRef) footer.push(`[Rule docs](${f.externalRef})`)
  if (isBlockingFinding(f, policy)) footer.push('blocks DONE')
  if (footer.length > 0) blocks.push(footer.join(' · '))
  blocks.push(fingerprintMarker(f.fingerprint))
  return blocks.join('\n\n')
}

export interface SummaryInput {
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
  /** LUM-832 — the causes on the row; absent/empty reads as unattributed. */
  partialCauses?: string[]
  /** Open (non-dependency) findings per external tool, from the `ext:<tool>:` prefix. */
  externalCounts: Record<string, number>
  /** Undispositioned and not persisting. */
  open: number
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
  error: string | null
  taskUrl: string | null
  /** LUM-849 — the scan's raw `prSummary` Json; parsed (and neutralised) here. */
  prSummary?: unknown
  /** LUM-849 — paths of the findings the reader should look at first. */
  attentionFiles?: string[]
  /** LUM-849 — the reviewed head commit on GitHub, for the footer. */
  commitUrl?: string | null
}

/** LUM-740 — the LOW line: the rows the PR does not get an inline comment for. */
function lowLine(input: SummaryInput): string | null {
  const low = input.low
  if (!low || low.count === 0) return null
  const noun = low.count === 1 ? 'finding' : 'findings'
  const where = low.allDowngradedPaths ? ' in test/fixture paths' : ''
  return `- ${low.count} low-severity ${noun}${where} — shown in Lumo only`
}

/** LUM-740 — the suggested-false-positive line. */
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
    const blocking =
      input.blocking > 0 ? ` (${input.blocking} blocking DONE)` : ''
    return `**${input.open} open ${noun}**${blocking}`
  }
  if (coverage === 'IN_PROGRESS')
    return '**No open findings yet — the scan is still running.**'
  // LUM-832: a fault or shortfall of ours — owned, never "a layer hit its
  // budget cap", which blamed the PR's size for a budget we chose.
  if (owned) return `**No open findings so far — ${SCAN_UNFINISHED_NOTE}.**`
  // A size cap is the only gap: say what WAS checked; the notice below says
  // which layer did not run, and why.
  if (coverage === 'UNFINISHED')
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
    hasSizeNotice: Boolean(input.huntOverCap || input.judgeOverCap),
  })
  const blocks: string[] = [
    '### 🛡️ Lumo security scan',
    verdictLine(input, coverage, owned),
    ...intentBlocks(input.prSummary),
  ]
  const attention = attentionLine(input.attentionFiles)
  if (attention) blocks.push(attention)

  const notices: string[] = []
  // With findings open, the owned note still has to be said once.
  if (input.open > 0 && owned)
    notices.push(`- ${capitalize(SCAN_UNFINISHED_NOTE)}.`)
  // LUM-832: a layer over its size cap did not run — stated the way
  // CodeRabbit states its own limit.
  if (input.judgeOverCap)
    notices.push(`- ${formatJudgeOverCap(input.judgeOverCap)}`)
  if (input.huntOverCap)
    notices.push(`- ${formatHuntOverCap(input.huntOverCap)}`)
  const low = lowLine(input)
  if (low) notices.push(low)
  const suggested = suggestedLine(input)
  if (suggested) notices.push(suggested)
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

  const sha = input.headSha.slice(0, 7)
  const footer = [
    `Reviewed commit: ${input.commitUrl ? `[${sha}](${input.commitUrl})` : sha}`,
  ]
  if (input.taskUrl) footer.push(`[Open in Lumo](${input.taskUrl})`)
  blocks.push(footer.join(' · '))
  blocks.push(SUMMARY_MARKER)
  return blocks.join('\n\n')
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
 * bot comments; a fresh create. A stored id whose comment is gone (404)
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
    c => c.body.includes(SUMMARY_MARKER) && c.user?.type === 'Bot'
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
   * Post (or refresh) the security review on the scan's PR. Best effort: any
   * GitHub or database failure is logged and reported in the result, never
   * thrown — the callers are `waitUntil` and workflow steps that must not be
   * failed by a comment.
   */
  async sync(scanId: string): Promise<SyncResult> {
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

    let posted = false
    let inline = 0
    let skipped = 0
    try {
      const token = await getRepoToken(pr.workspaceId, pr.repo)

      // LUM-738: a persisting row (already on the default branch) is not
      // this PR's — it is neither open, nor blocking, nor commented inline.
      const open = scan.findings.filter(
        f => f.disposition === null && !f.persisting
      )
      // LUM-740: the workspace policy says what blocks DONE (LLM never).
      const policy = parseSecurityPolicy(pr.workspace?.securityPolicy)
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

      const existing = parseFingerprintMarkers(
        (
          await prCommentClient.listReviewComments({
            repo,
            prNumber: pr.number,
            token,
          })
        ).map(c => c.body)
      )
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
      // Only findings on a line this PR added can carry an inline comment;
      // the rest are still counted by the summary.
      const candidates = open.filter(
        f =>
          f.line !== null &&
          f.severity !== 'LOW' &&
          f.suggestedDisposition == null &&
          !(holdExternal && f.provenance === 'EXTERNAL_TOOL')
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
        }),
        partialCauses: scan.partialCauses ?? [],
        externalCounts,
        open: open.length,
        blocking,
        ...(dependencies ? { dependencies } : {}),
        low,
        suggested,
        error: scan.error,
        taskUrl: taskUrlOf(pr),
        prSummary: scan.prSummary,
        // LUM-849: the rows a reader acts on — LOW and suggested false
        // positives stay off the diff, so they stay off this line too.
        attentionFiles: open
          .filter(f => f.severity !== 'LOW' && f.suggestedDisposition == null)
          .map(f => f.filePath),
        commitUrl: commitUrlOf(pr.repo, scan.headSha),
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
          await prCommentClient.createReview({
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
