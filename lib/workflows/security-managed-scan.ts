/**
 * LUM-735 v5 — Lumo-managed scan (spec §6 L1 v0.3). Started by stage A when
 * a PR head sha has no external findings yet. One sandbox step produces the
 * per-tool outcomes; each successful tool is persisted through the same
 * replace-by-tool step the BYO push uses; any failed tool ends the run as
 * FAILED (P9) — after the successful tools have been written, so partial
 * evidence is never thrown away.
 *
 * LUM-738: osv-scanner rides the same run. Its rows land under
 * `stages.supplyChain` (RAN), a tree with no package sources is SKIPPED
 * (a fact, not a failure), and its failure stamps `supplyChain: FAILED`
 * without touching `external` — the layers fail independently. LUM-846:
 * zizmor and trivy are `external` tools; zizmor skipping (no workflows)
 * neither fails nor stamps the layer. A crash
 * of the sandbox step itself (retries exhausted) fails both.
 * Deterministic body: no I/O, no logging.
 */
import {
  MANAGED_SCAN_TOOLS,
  SUPPLY_CHAIN_TOOL,
  isSupersededOutcome,
  type ManagedScanJob,
} from '@/lib/services/security-managed-scan.config'
import type { IngestResult } from '@/lib/services/security-sarif-ingest.service'
import type { ScanStages } from '@/lib/security-scan/types'
import {
  markSarifStagesStep,
  persistSarifFindingsStep,
} from './security-sarif-ingest.steps'
import {
  scanRepositoryInSandboxStep,
  stopIfScanningOffStep,
} from './security-managed-scan.steps'
import {
  markFailedBestEffort,
  suggestDispositionsBestEffort,
  syncPrReviewBestEffort,
} from './security-scan-helpers'

/**
 * LUM-876 — once a step's retries are spent, `@workflow/core` rewraps the
 * message as `Step "<step id>" failed after N retries: <message>`. The step
 * id is an internal module path and the retry count repeats what our own
 * copy already says, so the prefix never reaches the PR.
 */
const STEP_RETRIES_PREFIX = /^Step ".*?" failed after \d+ retr(?:y|ies): /

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(STEP_RETRIES_PREFIX, '')
    .slice(0, 500)
}

export async function securityManagedScanWorkflow(
  job: ManagedScanJob
): Promise<IngestResult> {
  'use workflow'

  const { scanId, pr } = job
  const failures: string[] = []
  const failedStages: ScanStages = {}
  let findings = 0
  let partial = false
  try {
    const outcome = await scanRepositoryInSandboxStep(job)
    if (isSupersededOutcome(outcome)) {
      // LUM-745: stage A superseded this row before the sandbox ran. The row
      // already reads SUPERSEDED (stamped before the cancel); stamping
      // FAILED or syncing the PR here would overwrite a truer state.
      return { outcome: 'DISCARDED', reason: 'superseded' }
    }
    // LUM-892: the run was started while scanning was on; the workspace may
    // have turned it off since. Asked here, where the report would land —
    // nothing is persisted, judged or posted for a switched-off workspace.
    if (await stopIfScanningOffStep(scanId, pr)) {
      return { outcome: 'DISCARDED', reason: 'workspace_scan_disabled' }
    }
    for (const tool of MANAGED_SCAN_TOOLS) {
      const stage = tool === SUPPLY_CHAIN_TOOL ? 'supplyChain' : 'external'
      const result = outcome[tool]
      if (!result) {
        failures.push(`${tool} produced no report`)
        failedStages[stage] = 'FAILED'
        continue
      }
      if (result.kind === 'skipped') {
        // LUM-846: an external tool with nothing to scan (zizmor on a repo
        // without workflows) is not a failure either; the layer's state
        // comes from the tools that did run.
        if (stage === 'supplyChain') {
          await markSarifStagesStep(scanId, { supplyChain: 'SKIPPED' })
        }
        continue
      }
      if (result.kind !== 'ok') {
        failures.push(
          result.kind === 'failed'
            ? result.reason
            : `${tool} produced no report`
        )
        failedStages[stage] = 'FAILED'
        continue
      }
      const persisted = await persistSarifFindingsStep({
        scanId,
        pr,
        repository: pr.repo,
        prNumber: pr.number,
        auth: 'managed',
        stage,
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
    // The run itself died (sandbox, persist, or the SKIPPED stamp after
    // retries): neither layer can vouch for anything it has not written.
    failures.push(reasonOf(error))
    failedStages.external = 'FAILED'
    failedStages.supplyChain = 'FAILED'
  }
  // LUM-740: the falsifier's suggestions must be on the rows before the PR
  // write-back reads them — on both paths, for whatever did land.
  if (findings > 0) await suggestDispositionsBestEffort(scanId)
  if (failures.length > 0) {
    const reason = failures.join('; ').slice(0, 500)
    await markFailedBestEffort(scanId, reason, failedStages)
    // Whatever did land (plus the failure line) goes on the PR.
    await syncPrReviewBestEffort(scanId)
    return {
      outcome: 'FAILED',
      scanId,
      reason,
    }
  }
  await syncPrReviewBestEffort(scanId)
  return { outcome: 'INGESTED', scanId, findings, partial }
}
