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
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
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
  INCOMPLETE_STAGE_STATES,
  type ScanStageKey,
  type ScanStages,
} from '@/lib/security-scan/types'
import { EXTERNAL_ERROR_PREFIX } from '@/lib/security-scan/stages'
import { resolvePublicUrl } from '@/lib/utils/public-url'

/** How many inline comments one sync may post. The rest wait for the next one. */
export const REVIEW_MAX_INLINE = 50

export const SUMMARY_MARKER = '<!-- lumo-security:summary -->'

export const fingerprintMarker = (fp: string): string =>
  `<!-- lumo-security:fp:${fp} -->`

const FINGERPRINT_MARKER_RE = /<!--\s*lumo-security:fp:([^\s>]+?)\s*-->/g

/** Stage order in the summary line; only keys the scan actually carries show. */
const STAGE_ORDER: ScanStageKey[] = [
  'secrets',
  'external',
  'supplyChain',
  'judge',
  'hunt',
]

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
>

/** P8: `evidence` is not a parameter here, so it cannot leak by accident. */
export function buildInlineComment(f: InlineFinding): string {
  const blocks: string[] = [
    `**Lumo · ${provenanceLabel(f)} · ${f.severity}** — ${f.title}`,
  ]
  const detail = f.detail.trim()
  if (detail.length > 0) blocks.push(detail)
  const footer: string[] = []
  if (f.externalRef) footer.push(`[Rule docs](${f.externalRef})`)
  if (isBlockingFinding(f)) footer.push('blocks DONE')
  if (footer.length > 0) blocks.push(footer.join(' · '))
  blocks.push(fingerprintMarker(f.fingerprint))
  return blocks.join('\n\n')
}

export interface SummaryInput {
  headSha: string
  stages: ScanStages
  /** A layer hit its cap: the findings are honest but not the whole story. */
  partial: boolean
  /** Findings per external tool, from the `ext:<tool>:` prefix. */
  externalCounts: Record<string, number>
  open: number
  blocking: number
  error: string | null
  taskUrl: string | null
}

/**
 * "Nothing open" only means "clean" when every layer actually finished. A
 * PENDING external stage or a truncated diff would otherwise read as an
 * all-clear on the PR (spec P9), which is the one thing the summary must
 * never say by accident.
 */
function isIncomplete(stages: ScanStages, partial: boolean): boolean {
  if (partial) return true
  for (const state of Object.values(stages)) {
    if (state && INCOMPLETE_STAGE_STATES.has(state)) return true
  }
  return false
}

/**
 * P8 — the scrubbed reason, or null. `error` is one column with two writers:
 * the ingest workflow (scrubbed, prefixed) and stage A's own catch-all (a raw
 * `error.message`). Only the prefixed one may be published, and only the text
 * after the prefix is printed.
 */
function externalFailureReason(input: SummaryInput): string | null {
  if (input.stages.external !== 'FAILED') return null
  if (!input.error?.startsWith(EXTERNAL_ERROR_PREFIX)) return null
  const reason = input.error.slice(EXTERNAL_ERROR_PREFIX.length)
  return reason.length > 0 ? reason : null
}

function stageLine(
  stages: ScanStages,
  externalCounts: Record<string, number>
): string | null {
  const counts = Object.entries(externalCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )
  const parts: string[] = []
  for (const key of STAGE_ORDER) {
    const state = stages[key]
    if (!state) continue
    const suffix =
      key === 'external' && counts.length > 0
        ? ` (${counts.map(([tool, n]) => `${tool} ${n}`).join(', ')})`
        : ''
    parts.push(`${key}: ${state}${suffix}`)
  }
  return parts.length > 0 ? `- ${parts.join(' · ')}` : null
}

export function buildSummary(input: SummaryInput): string {
  const blocks: string[] = [
    `### 🛡️ Lumo security scan — ${input.headSha.slice(0, 7)}`,
  ]
  const stages = stageLine(input.stages, input.externalCounts)
  if (stages) blocks.push(stages)
  if (input.open > 0) {
    const noun = input.open === 1 ? 'finding' : 'findings'
    const blocking =
      input.blocking > 0 ? ` (${input.blocking} blocking DONE)` : ''
    blocks.push(`**${input.open} open ${noun}**${blocking}`)
  } else if (isIncomplete(input.stages, input.partial)) {
    blocks.push('No open findings yet — the scan is still incomplete.')
  } else {
    blocks.push('No open findings on lines this PR added.')
  }
  const reason = externalFailureReason(input)
  if (reason) blocks.push(`⚠ External scanner failed: ${reason}`)
  if (input.taskUrl) blocks.push(`[Open in Lumo](${input.taskUrl})`)
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

function describe(error: unknown): string {
  if (error instanceof GithubApiError) return `${error.status} ${error.message}`
  return error instanceof Error ? error.message : String(error)
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
      const token = await getGithubInstallationToken(pr.workspaceId)

      const open = scan.findings.filter(f => f.disposition === null)
      const blocking = open.filter(isBlockingFinding).length
      const externalCounts: Record<string, number> = {}
      for (const f of open) {
        const tool = externalTool(f.ruleId)
        if (f.provenance === 'EXTERNAL_TOOL' && tool) {
          externalCounts[tool] = (externalCounts[tool] ?? 0) + 1
        }
      }

      const existing = parseFingerprintMarkers(
        (
          await prCommentClient.listReviewComments({
            repo,
            prNumber: pr.number,
            token,
          })
        ).map(c => c.body)
      )
      // Only findings on a line this PR added can carry an inline comment;
      // the rest are still counted by the summary.
      const candidates = open.filter(f => f.line !== null)
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
        partial: scan.partial,
        externalCounts,
        open: open.length,
        blocking,
        error: scan.error,
        taskUrl: taskUrlOf(pr),
      })
      const issueComments = await prCommentClient.listIssueComments({
        repo,
        prNumber: pr.number,
        token,
      })
      // A human quoting the marker in a comment must never be mistaken for
      // Lumo's own summary — only the bot-authored comment is eligible for
      // the upsert; anything else falls through to creating a fresh one.
      // `user` is null on comments whose account has since been deleted, so
      // the read is optional: such a comment is simply not ours.
      const mine = issueComments.find(
        c => c.body.includes(SUMMARY_MARKER) && c.user?.type === 'Bot'
      )
      if (mine) {
        await prCommentClient.updateIssueComment({
          repo,
          externalId: String(mine.id),
          body: summary,
          token,
        })
      } else {
        await prCommentClient.createIssueComment({
          repo,
          prNumber: pr.number,
          body: summary,
          token,
        })
      }
      posted = true

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
              body: buildInlineComment(f),
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
