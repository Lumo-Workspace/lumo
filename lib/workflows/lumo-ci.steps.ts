/**
 * LUM-746 — `'use step'` boundaries of the managed CI workflow. One-line
 * delegates so the services stay plain, unit-testable modules and only this
 * file is rewritten by the Workflow compiler. Steps run in the full Node
 * runtime with the default retry policy (3 retries); the services decide
 * what is retryable by throwing vs. returning.
 */
import {
  lumoCiService,
  type PrepareResult,
} from '@/lib/services/lumo-ci.service'
import {
  lumoCiRecordService,
  type RecordInput,
  type RecordOutcome,
} from '@/lib/services/lumo-ci-record.service'
import type {
  CiCheckResult,
  CiCheckSpec,
  CiSandboxRef,
  LumoCiJob,
} from '@/lib/services/lumo-ci.config'

export async function prepareCiSandboxStep(
  job: LumoCiJob
): Promise<PrepareResult> {
  'use step'
  return lumoCiService.prepare(job)
}

export async function runCiCheckStep(input: {
  sandbox: CiSandboxRef
  headSha: string
  spec: CiCheckSpec
}): Promise<CiCheckResult> {
  'use step'
  return lumoCiService.runCheck(input)
}

export async function recordCiOutcomeStep(
  input: RecordInput
): Promise<RecordOutcome> {
  'use step'
  return lumoCiRecordService.record(input)
}

export async function stopCiSandboxStep(sandbox: CiSandboxRef): Promise<void> {
  'use step'
  return lumoCiService.stop(sandbox)
}
