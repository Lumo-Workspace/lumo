/**
 * LUM-735 — pure per-layer stage derivation, shared by
 * `pr-security-scan.service.ts` (LLM-gateway-adjacent, dynamic-import
 * boundary) and `pr-security-reminder.service.ts` (LLM-free, imported
 * statically from task-context / task-verification / hook routes). Moved out
 * of the former so the latter never has to reach across that boundary just
 * to derive a legacy view.
 *
 * Rows written before the `stages` column existed carry null; for them the
 * only per-layer fact on record is `judgeStatus`, so the legacy view is
 * derived from it (UNAVAILABLE → FAILED, SKIPPED → SKIPPED) and no
 * `external` key is claimed — those scans never consulted GitHub.
 */
import type { ScanStages } from './types'

/**
 * P8 — the ONLY `error` shape that may be published as an external-scanner
 * reason. The ingest workflow scrubs its reason (`reasonOf` / `scrubToken`)
 * and `markExternalFailed` stamps this prefix on the scrubbed text, so the
 * prefix is the proof of provenance.
 *
 * Stage A also stamps `stages.external = 'FAILED'` (a lookup or a failed
 * managed-scan start) and, on its own catch-all path, writes a RAW
 * `error.message` into the same column. That text is unscrubbed, carries no
 * prefix, and must therefore never reach a PR comment: every renderer of the
 * external-failure line checks `startsWith(EXTERNAL_ERROR_PREFIX)` first and
 * prints only what follows it.
 */
export const EXTERNAL_ERROR_PREFIX = 'external: '

export interface StagesOfScanInput {
  stages: ScanStages | null
  judgeStatus: 'RAN' | 'UNAVAILABLE' | 'SKIPPED' | null
}

export function stagesOf(scan: StagesOfScanInput): ScanStages {
  if (scan.stages) return scan.stages
  const legacy: ScanStages = { secrets: 'RAN' }
  if (scan.judgeStatus === 'RAN') legacy.judge = 'RAN'
  else if (scan.judgeStatus === 'UNAVAILABLE') legacy.judge = 'FAILED'
  else if (scan.judgeStatus === 'SKIPPED') legacy.judge = 'SKIPPED'
  return legacy
}
