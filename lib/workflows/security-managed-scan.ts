/**
 * LUM-735 v5 — Lumo-managed scan (spec §6 L1 v0.3). Started by stage A when
 * a PR head sha has no external findings yet. One sandbox step produces the
 * per-tool outcomes; each successful tool is persisted through the same
 * replace-by-tool step the BYO push uses; any failed tool ends the run as
 * FAILED (P9) — after the successful tools have been written, so partial
 * evidence is never thrown away. Deterministic body: no I/O, no logging.
 */
import {
  MANAGED_SCAN_TOOLS,
  type ManagedScanJob,
} from '@/lib/services/security-managed-scan.config'
import type { IngestResult } from '@/lib/services/security-sarif-ingest.service'
import { persistSarifFindingsStep } from './security-sarif-ingest.steps'
import { scanRepositoryInSandboxStep } from './security-managed-scan.steps'
import { markFailedBestEffort } from './security-scan-helpers'

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export async function securityManagedScanWorkflow(
  job: ManagedScanJob
): Promise<IngestResult> {
  'use workflow'

  const { scanId, pr } = job
  const failures: string[] = []
  let findings = 0
  let partial = false
  try {
    const outcome = await scanRepositoryInSandboxStep(job)
    for (const tool of MANAGED_SCAN_TOOLS) {
      const result = outcome[tool]
      if (result.kind !== 'ok') {
        failures.push(
          result.kind === 'failed'
            ? result.reason
            : `${tool} produced no report`
        )
        continue
      }
      const persisted = await persistSarifFindingsStep({
        scanId,
        pr,
        repository: pr.repo,
        prNumber: pr.number,
        auth: 'managed',
        tool: result.tool,
        tools: result.tools,
        findings: result.findings,
        truncated: result.truncated,
        dropped: result.dropped,
      })
      findings += persisted.written
      partial = partial || persisted.partial
    }
  } catch (error) {
    failures.push(reasonOf(error))
  }
  if (failures.length > 0) {
    const reason = failures.join('; ').slice(0, 500)
    await markFailedBestEffort(scanId, reason)
    return {
      outcome: 'FAILED',
      scanId,
      reason,
    }
  }
  return { outcome: 'INGESTED', scanId, findings, partial }
}
