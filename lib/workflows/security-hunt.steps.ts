/**
 * LUM-739 — the `'use step'`s of the L3 hunt. Each is a one-line delegate to
 * `securityHuntService` so the service stays a plain, unit-testable module
 * and the compiler only rewrites this file. Default retry policy (3
 * retries) — the service throws for transient failures and returns values
 * for facts the run must record (see the service header).
 */
import { securityHuntService } from '@/lib/services/security-hunt.service'
import type {
  HuntJob,
  SubgraphResult,
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

export async function buildSubgraphStep(job: HuntJob): Promise<SubgraphResult> {
  'use step'
  return securityHuntService.buildSubgraph(job)
}

export async function planHuntStep(
  input: PlanHuntInput
): Promise<PlanHuntOutput> {
  'use step'
  return securityHuntService.planHunt(input)
}

export async function huntCategoryStep(
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
