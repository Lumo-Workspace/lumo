/**
 * LUM-1151 (user ruling) — the high-level summary always describes the
 * WHOLE PR (base...head). An incremental review's AI review reads only the
 * files changed since its last complete review, so its own `prSummary` is a
 * slice and must never overwrite a whole-PR summary. For those reviews this
 * service makes one separate, budgeted summary-only call over the whole
 * reviewable PR diff:
 *
 *  - the diff (path filters applied) is secret-masked and guarded
 *    (`guardInjectedText`) BEFORE it is cut — a cut through a credential
 *    would leave a prefix too short for its pattern;
 *  - within `WHOLE_PR_SUMMARY_DIFF_MAX_CHARS`, the diff is sent with the
 *    changed-file list; over it, only the file list and the previous
 *    summary are (the model is told the earlier summary may be stale);
 *  - the call fails: the previous whole-PR summary is kept, marked with the
 *    commit it describes (`describesSha`) so the PR says it was not
 *    refreshed; no previous one → null (nothing written, never the slice).
 *
 * Never throws. Layering: service — the model behind a dynamic import, the
 * database through the repository.
 */
import { logger } from '@/lib/logger'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import {
  cleanPrSummary,
  type PrSummary,
} from '@/ee/security/security-scan/pr-summary'
import { filterReviewableDiff } from '@/ee/security/security-scan/reviewable-path'

/** Whole-PR diff characters one summary call may read (≈10k input tokens). */
export const WHOLE_PR_SUMMARY_DIFF_MAX_CHARS = 40_000
/** Changed files listed in the prompt; the rest are counted. */
export const WHOLE_PR_SUMMARY_MAX_FILES = 200
export const WHOLE_PR_SUMMARY_TIMEOUT_MS = 60_000

export interface DiffFileStat {
  path: string
  additions: number
  deletions: number
}

/** PURE — each file of a unified diff with its added / deleted line counts. */
export function diffFileStats(diff: string): DiffFileStat[] {
  const out: DiffFileStat[] = []
  let current: DiffFileStat | null = null
  let oldPath: string | null = null
  // `---` / `+++` are file headers only outside a hunk: a deleted line
  // reading `-- x` is content.
  let inHunk = false
  for (const raw of diff.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    if (!inHunk && line.startsWith('--- ')) {
      oldPath = line.slice(4).replace(/^a\//, '')
      continue
    }
    if (!inHunk && line.startsWith('+++ ')) {
      const next = line.slice(4).replace(/^b\//, '')
      const path = next === '/dev/null' ? (oldPath ?? next) : next
      current = { path, additions: 0, deletions: 0 }
      out.push(current)
      continue
    }
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!current || !inHunk) continue
    if (line.startsWith('+')) current.additions += 1
    else if (line.startsWith('-')) current.deletions += 1
  }
  return out
}

/** The kept earlier summary, marked with the commit it describes. */
function kept(
  previous: { headSha: string; prSummary: unknown } | null
): PrSummary | null {
  const summary = previous ? cleanPrSummary(previous.prSummary) : null
  if (!previous || !summary) return null
  return { ...summary, describesSha: summary.describesSha ?? previous.headSha }
}

export const prWholeSummaryService = {
  async summarize(input: {
    pullRequestId: string
    scanId: string
    /** The whole PR diff (base...head). */
    diff: string
    isReviewable: (path: string) => boolean
    /** Guarded tone line ('' = none). */
    tone: string
  }): Promise<PrSummary | null> {
    const where = `scan=${input.scanId}`
    let previous: { headSha: string; prSummary: unknown } | null = null
    try {
      previous = await prSecurityScanRepository.findPreviousPrSummary(
        input.pullRequestId,
        input.scanId
      )
    } catch (error) {
      logger.warn(
        `[pr-whole-summary] previous summary unavailable ${where}: ${describe(error)}`
      )
    }
    try {
      const reviewable = filterReviewableDiff(
        input.diff,
        input.isReviewable
      ).diff
      // Mask first, then cut.
      const guarded = guardInjectedText(reviewable)
      const fits = guarded.text.length <= WHOLE_PR_SUMMARY_DIFF_MAX_CHARS
      const files = diffFileStats(reviewable)
      const { summarizeWholePr } =
        await import('@/ee/security/llm/pr-summary-client')
      const answer = await summarizeWholePr({
        diff: fits ? { text: guarded.text, notices: guarded.notices } : null,
        diffTruncated: fits && guarded.truncatedLines > 0,
        files: files.slice(0, WHOLE_PR_SUMMARY_MAX_FILES),
        moreFiles: Math.max(0, files.length - WHOLE_PR_SUMMARY_MAX_FILES),
        previous: kept(previous),
        tone: input.tone,
        timeoutMs: WHOLE_PR_SUMMARY_TIMEOUT_MS,
      })
      logger.info(
        `[pr-whole-summary] summarised ${where} files=${files.length} diffChars=${guarded.text.length} ${fits ? 'diff' : 'file-list'}`
      )
      // Model text headed for a public PR: redacted and neutralised.
      const summary = cleanPrSummary(answer)
      if (summary) return summary
      throw new Error('empty summary')
    } catch (error) {
      logger.warn(
        `[pr-whole-summary] not refreshed ${where}: ${describe(error)} — ${previous ? 'keeping the earlier summary' : 'no summary'}`
      )
      return kept(previous)
    }
  },
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
