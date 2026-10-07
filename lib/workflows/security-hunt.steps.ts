/**
 * LUM-739 — the `'use step'`s of the L3 hunt. Each is a one-line delegate to
 * `securityHuntService` so the service stays a plain, unit-testable module
 * and the compiler only rewrites this file. Default retry policy (3
 * retries) — the service throws for transient failures and returns values
 * for facts the run must record (see the service header).
 */
import { securityHuntService } from '@/lib/services/security-hunt.service'
import { isCurrentRunCancelled } from './run-cancellation'
import type {
  VerifySubgraphInput,
  VerifySubgraphOutput,
  HuntBatchInput,
  HuntBatchOutput,
  MechanicalVerifyInput,
  MechanicalVerifyResult,
  FalsifierInput,
  FalsifierOutput,
  PersistHuntInput,
  PlanHuntInput,
  PlanHuntOutput,
  HuntJob,
} from '@/lib/services/security-hunt.config'
import type {
  HuntRequeueInput,
  HuntRequeueOutcome,
} from '@/lib/services/security-hunt-ops.service'

/**
 * LUM-758 Task 10 — runs AFTER the hunt, not before it: the mechanical gate's
 * graph is built from the files the candidates reference. A live sandbox
 * handle carries methods and cannot cross a step boundary, so the service
 * attaches its own.
 */
export async function buildVerifySubgraphStep(
  input: VerifySubgraphInput
): Promise<VerifySubgraphOutput> {
  'use step'
  return securityHuntService.buildVerifySubgraph(input)
}

export async function planHuntStep(
  input: PlanHuntInput
): Promise<PlanHuntOutput> {
  'use step'
  return securityHuntService.planHunt(input)
}

/**
 * LUM-869 — wait for the managed scan to hand its VM over, in a step of its
 * own so the wait is not spent out of the first batch's window.
 */
export async function awaitManagedScanStep(input: {
  scanId: string
}): Promise<boolean> {
  'use step'
  return securityHuntService.awaitManagedScan(input)
}

/** LUM-758 — one bounded batch per PLANNED TASK (was: per category). */
export async function huntTaskStep(
  input: HuntBatchInput
): Promise<HuntBatchOutput> {
  'use step'
  return securityHuntService.huntBatch(input)
}

export async function mechanicalVerifyStep(
  input: MechanicalVerifyInput
): Promise<MechanicalVerifyResult> {
  'use step'
  return securityHuntService.mechanicalVerify(input)
}

export async function falsifierStep(
  input: FalsifierInput
): Promise<FalsifierOutput> {
  'use step'
  return securityHuntService.falsify(input)
}

export async function persistHuntFindingsStep(
  input: PersistHuntInput
): Promise<{ written: number }> {
  'use step'
  // LUM-1030 ruling ③: a hunt the stale sweep cancelled may still have this
  // step in flight; its findings are discarded, not written.
  if (await isCurrentRunCancelled()) return { written: 0 }
  return securityHuntService.persist(input)
}

export async function markHuntFailedStep(
  scanId: string,
  reason: string,
  tokenSpent: number,
  attempt?: number
): Promise<void> {
  'use step'
  return securityHuntService.markFailed(scanId, reason, tokenSpent, attempt)
}

/**
 * LUM-832 — hand an attempt that ended on our fault to the next attempt.
 * Dynamic import: the ops service starts THIS workflow, and a static import
 * would close the loop workflow → steps → ops → start → workflow.
 */
export async function requeueHuntStep(
  input: HuntRequeueInput
): Promise<HuntRequeueOutcome> {
  'use step'
  const { securityHuntOpsService } =
    await import('@/lib/services/security-hunt-ops.service')
  return securityHuntOpsService.requeueFaultedHunt(input)
}

/** LUM-832 — start the next batch of an oversized diff (see `continueBatchedHunt`). */
export async function continueHuntStep(input: {
  job: HuntJob
  next: HuntJob
}): Promise<boolean> {
  'use step'
  const { securityHuntOpsService } =
    await import('@/lib/services/security-hunt-ops.service')
  return securityHuntOpsService.continueBatchedHunt(input)
}

/** LUM-901 — the run's own switch read (see `stopIfHuntTurnedOff`). */
export async function stopIfHuntTurnedOffStep(input: {
  job: HuntJob
}): Promise<boolean> {
  'use step'
  const { securityHuntOpsService } =
    await import('@/lib/services/security-hunt-ops.service')
  return securityHuntOpsService.stopIfHuntTurnedOff(input.job)
}
