/**
 * LUM-740 — the `'use step'` boundaries of the suggested-disposition pass:
 * one GitHub read, then ONE model call per step (like the hunt's falsifier,
 * so a platform retry never re-judges a whole scan), then the stamp the PR
 * write-back waits for. Each is a one-line delegate to the service.
 */
import {
  securitySuggestDispositionService,
  type PreparedSuggestions,
  type SuggestionCandidate,
  type JudgeResult,
} from '@/ee/security/services/security-suggest-disposition.service'

export async function prepareSuggestionsStep(
  scanId: string
): Promise<PreparedSuggestions> {
  'use step'
  return securitySuggestDispositionService.prepare(scanId)
}

export async function judgeSuggestionStep(
  candidate: SuggestionCandidate
): Promise<JudgeResult> {
  'use step'
  return securitySuggestDispositionService.judge(candidate)
}

export async function finishSuggestionsStep(
  scanId: string,
  tokens: number
): Promise<void> {
  'use step'
  return securitySuggestDispositionService.finish(scanId, tokens)
}
