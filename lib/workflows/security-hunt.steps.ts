/**
 * LUM-739 — the `'use step'`s of the L3 hunt. Each is a one-line delegate to
 * `securityHuntService` so the service stays a plain, unit-testable module
 * and the compiler only rewrites this file. Default retry policy (3
 * retries) — the service throws for transient failures and returns values
 * for facts the run must record (see the service header).
 */
import { securityHuntService } from '@/lib/services/security-hunt.service'
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
} from '@/lib/services/security-hunt.config'

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
  return securityHuntService.persist(input)
}

export async function markHuntFailedStep(
  scanId: string,
  reason: string,
  tokenSpent: number
): Promise<void> {
  'use step'
  return securityHuntService.markFailed(scanId, reason, tokenSpent)
}
