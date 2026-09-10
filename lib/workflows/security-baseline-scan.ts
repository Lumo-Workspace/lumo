/**
 * LUM-738 — the default-branch baseline scan (spec §6 L2 v0.3). Started on a
 * push to the default branch, or lazily by the first PR scan of a repo with
 * no baseline. One sandbox step (every managed tool, no diff filter,
 * fingerprints only) then one persist step. A tool that failed inside the
 * sandbox is a value: what did run is still written (its `tools` list says
 * which), because a partial baseline only ever errs toward "new" — the
 * noisy, honest direction (P9). A step whose retries are exhausted leaves
 * the claim in place; a later PR re-requests once it is stale.
 * Deterministic body: no I/O, no logging, no Date.
 */
import type { BaselineScanJob } from '@/lib/services/security-managed-scan.config'
import {
  persistSecurityBaselineStep,
  scanBaselineInSandboxStep,
} from './security-baseline-scan.steps'

export type BaselineScanResult =
  | {
      outcome: 'WRITTEN'
      fingerprints: number
      partial: boolean
      tools: string[]
      failed: string[]
      skipped: string[]
    }
  | { outcome: 'FAILED'; reason: string }

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

export async function securityBaselineScanWorkflow(
  job: BaselineScanJob
): Promise<BaselineScanResult> {
  'use workflow'
  try {
    const outcome = await scanBaselineInSandboxStep(job)
    await persistSecurityBaselineStep(job, outcome)
    return {
      outcome: 'WRITTEN',
      fingerprints: outcome.fingerprints.length,
      partial: outcome.partial,
      tools: outcome.tools,
      failed: outcome.failed,
      skipped: outcome.skipped,
    }
  } catch (error) {
    return { outcome: 'FAILED', reason: reasonOf(error) }
  }
}
