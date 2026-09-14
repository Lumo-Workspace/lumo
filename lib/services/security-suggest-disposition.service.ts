/**
 * LUM-740 — LLM-suggested dispositions for EXTERNAL_TOOL findings (spec §6
 * L5 item 2). Every scanner finding the PR would otherwise get an inline
 * comment for goes through the falsifier once; a REJECT becomes a
 * *suggested* FALSE_POSITIVE (`suggestedDisposition` + `suggestedReason`)
 * that a human confirms or overrules — `disposition` itself is never written
 * here (P2: the LLM cannot pass, and it cannot disposition either). An
 * INCONCLUSIVE verdict writes nothing.
 *
 * Three halves so the workflow can run one model call per step (like the
 * hunt's falsifier): `prepare` (candidates + their diff hunks, one GitHub
 * read), `judge` (one finding), `finish` (tokens + the `suggestedAt` stamp
 * the PR write-back waits for before commenting external rows inline).
 * `suggestForScan` composes them for in-process callers and tests.
 *
 * Layering: service — GitHub through `@/lib/integrations/github`, the
 * database through the repository; the LLM client only via dynamic import.
 */
import { logger } from '@/lib/logger'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import {
  prSecurityScanRepository,
  type FindingSeverity,
  type SuggestionCandidateRow,
} from '@/lib/repositories/pr-security-scan.repository'
import { extractDiffHunk } from '@/lib/security-scan/diff-snippet'
import { redactKnownSecrets } from '@/lib/security-scan/scan-secrets'
import {
  isSuggestEnabled,
  SUGGEST_MAX_PER_SCAN,
} from './security-suggest.config'

export { isSuggestEnabled, SUGGEST_MAX_PER_SCAN }

/** One finding the workflow judges in its own step: the row plus its hunk. */
export interface SuggestionCandidate extends SuggestionCandidateRow {
  hunk: string
}

export interface PreparedSuggestions {
  /** False when the pass is off or the scan is gone — nothing to finish. */
  enabled: boolean
  candidates: SuggestionCandidate[]
}

export interface JudgeResult {
  suggested: boolean
  tokens: number
}

export interface SuggestForScanResult {
  /** Findings the falsifier actually answered. */
  judged: number
  /** REJECTs written as suggested FALSE_POSITIVE. */
  suggested: number
  tokens: number
}

const NOTHING: SuggestForScanResult = { judged: 0, suggested: 0, tokens: 0 }
const REASON_MAX_CHARS = 500

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}

function worstFirst(rows: SuggestionCandidateRow[]): SuggestionCandidateRow[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.filePath.localeCompare(b.filePath) ||
      a.line - b.line
  )
}

/**
 * The model is asked to cite the line that refutes the finding — for a
 * secret-shaped false positive that line IS the flagged value. Same
 * treatment as every other LLM-authored field on a finding row.
 */
function cleanReason(reason: string): string {
  return redactKnownSecrets(reason)
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .slice(0, REASON_MAX_CHARS)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const securitySuggestDispositionService = {
  /**
   * Candidates with their hunks, worst severity first, capped. A diff that
   * cannot be fetched (after the step's retries) leaves nothing to judge
   * but still `enabled`, so `finish` marks the scan and the PR write-back
   * does not hold the external rows forever.
   */
  async prepare(scanId: string): Promise<PreparedSuggestions> {
    if (!isSuggestEnabled()) return { enabled: false, candidates: [] }
    const scan = await prSecurityScanRepository.findScanForSuggestion(scanId)
    if (!scan) return { enabled: false, candidates: [] }
    if (scan.findings.length === 0) return { enabled: true, candidates: [] }
    const pr = scan.pullRequest
    let diff: string
    try {
      diff = await fetchPrDiff({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      })
    } catch (error) {
      logger.warn(
        `[security-suggest] diff fetch failed scan=${scanId}: ${describe(error)}`
      )
      return { enabled: true, candidates: [] }
    }
    const candidates: SuggestionCandidate[] = []
    for (const f of worstFirst(scan.findings).slice(0, SUGGEST_MAX_PER_SCAN)) {
      const hunk = extractDiffHunk(diff, f.filePath, f.line)
      if (hunk !== null) candidates.push({ ...f, hunk })
    }
    return { enabled: true, candidates }
  },

  /**
   * One falsifier call. Throws on a client failure so the workflow step can
   * retry; a REJECT is written as a suggestion before returning.
   */
  async judge(candidate: SuggestionCandidate): Promise<JudgeResult> {
    const { falsifyExternalFinding } =
      await import('@/lib/llm/security-disposition-falsifier-client')
    const verdict = await falsifyExternalFinding({
      finding: {
        ruleId: candidate.ruleId,
        severity: candidate.severity,
        filePath: candidate.filePath,
        line: candidate.line,
        title: candidate.title,
        detail: candidate.detail,
        externalRef: candidate.externalRef,
      },
      hunk: candidate.hunk,
    })
    if (verdict.verdict !== 'REJECT') {
      return { suggested: false, tokens: verdict.tokens }
    }
    await prSecurityScanRepository.setSuggestedDisposition(
      candidate.id,
      'FALSE_POSITIVE',
      cleanReason(verdict.reason)
    )
    return { suggested: true, tokens: verdict.tokens }
  },

  /** Tokens on the row and the `suggestedAt` stamp. Best effort, never throws. */
  async finish(scanId: string, tokens: number): Promise<void> {
    if (tokens > 0) {
      try {
        await prSecurityScanRepository.addSuggestionTokens(scanId, tokens)
      } catch (error) {
        logger.warn(
          `[security-suggest] token write failed scan=${scanId}: ${describe(error)}`
        )
      }
    }
    try {
      await prSecurityScanRepository.markSuggested(scanId)
    } catch (error) {
      logger.warn(
        `[security-suggest] suggestedAt write failed scan=${scanId}: ${describe(error)}`
      )
    }
  },

  /** The whole pass in-process: prepare → judge each → finish. Never throws. */
  async suggestForScan(scanId: string): Promise<SuggestForScanResult> {
    const prepared = await this.prepare(scanId)
    if (!prepared.enabled) return NOTHING
    let judged = 0
    let suggested = 0
    let tokens = 0
    for (const candidate of prepared.candidates) {
      try {
        const result = await this.judge(candidate)
        judged += 1
        tokens += result.tokens
        if (result.suggested) suggested += 1
      } catch (error) {
        logger.warn(
          `[security-suggest] finding ${candidate.id} skipped scan=${scanId}: ${describe(error)}`
        )
      }
    }
    await this.finish(scanId, tokens)
    return { judged, suggested, tokens }
  },
}
