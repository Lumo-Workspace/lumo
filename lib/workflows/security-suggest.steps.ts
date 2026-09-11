/**
 * LUM-740 — the `'use step'` boundary for the suggested-disposition pass, so
 * the managed-scan and SARIF-ingest workflows can run the falsifier over
 * their freshly persisted EXTERNAL_TOOL findings without doing I/O in their
 * (deterministic) bodies. The service never throws; the wrapper in
 * `security-scan-helpers.ts` guards the step boundary itself.
 */
import { securitySuggestDispositionService } from '@/lib/services/security-suggest-disposition.service'

export async function suggestDispositionsStep(scanId: string): Promise<void> {
  'use step'
  await securitySuggestDispositionService.suggestForScan(scanId)
}
