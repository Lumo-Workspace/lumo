/**
 * LUM-740 — LLM-suggested dispositions for EXTERNAL_TOOL findings (spec §6
 * L5 item 2). Every scanner finding the PR would otherwise get an inline
 * comment for goes through the falsifier once; a REJECT becomes a
 * *suggested* FALSE_POSITIVE (`suggestedDisposition` + `suggestedReason`)
 * that a human confirms or overrules — `disposition` itself is never written
 * here (P2: the LLM cannot pass, and it cannot disposition either). An
 * INCONCLUSIVE verdict writes nothing.
 *
 * Runs once per ingest from a workflow step, BEFORE the PR write-back, so a
 * suggested row never gets an inline comment. Best effort throughout: a
 * failed finding is logged and skipped, the function never throws.
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

/** Findings judged per scan; the rest stay unjudged (and get no suggestion). */
export const SUGGEST_MAX_PER_SCAN = 20

/** `LUMO_SECURITY_SUGGEST=off` is the kill switch. */
export function isSuggestEnabled(): boolean {
  return process.env.LUMO_SECURITY_SUGGEST !== 'off'
}

export interface SuggestForScanResult {
  /** Findings the falsifier actually answered. */
  judged: number
  /** REJECTs written as suggested FALSE_POSITIVE. */
  suggested: number
  tokens: number
}

const NOTHING: SuggestForScanResult = { judged: 0, suggested: 0, tokens: 0 }

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const securitySuggestDispositionService = {
  async suggestForScan(scanId: string): Promise<SuggestForScanResult> {
    if (!isSuggestEnabled()) return NOTHING
    const scan = await prSecurityScanRepository.findScanForSuggestion(scanId)
    if (!scan || scan.findings.length === 0) return NOTHING
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
      return NOTHING
    }

    const { falsifyExternalFinding } =
      await import('@/lib/llm/security-disposition-falsifier-client')

    let judged = 0
    let suggested = 0
    let tokens = 0
    for (const f of worstFirst(scan.findings).slice(0, SUGGEST_MAX_PER_SCAN)) {
      const hunk = extractDiffHunk(diff, f.filePath, f.line)
      if (hunk === null) continue
      try {
        const verdict = await falsifyExternalFinding({
          finding: {
            ruleId: f.ruleId,
            severity: f.severity,
            filePath: f.filePath,
            line: f.line,
            title: f.title,
            detail: f.detail,
            externalRef: f.externalRef,
          },
          hunk,
        })
        judged += 1
        tokens += verdict.tokens
        if (verdict.verdict === 'REJECT') {
          await prSecurityScanRepository.setSuggestedDisposition(
            f.id,
            'FALSE_POSITIVE',
            verdict.reason
          )
          suggested += 1
        }
      } catch (error) {
        logger.warn(
          `[security-suggest] finding ${f.id} skipped scan=${scanId}: ${describe(error)}`
        )
      }
    }
    if (tokens > 0) {
      try {
        await prSecurityScanRepository.addTokenSpent(scanId, tokens)
      } catch (error) {
        logger.warn(
          `[security-suggest] tokenSpent write failed scan=${scanId}: ${describe(error)}`
        )
      }
    }
    return { judged, suggested, tokens }
  },
}
