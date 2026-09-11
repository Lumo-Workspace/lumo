/**
 * LUM-746 — the write-back half of the managed CI run: turn each check that
 * RAN into one independent `GateSignal` row (source `lumo_sandbox`) and
 * close the `LumoCiRun` ledger row. A check the harness lost (prepare
 * failed, sha guard, timeout, lost VM) writes nothing — the gate audit then
 * falls back to the agent's self-report, which is honest; a fabricated
 * failure would not be. No sandbox / GitHub imports: this is the `record`
 * step's body and runs after the VM work is over.
 */
import { logger } from '@/lib/logger'
import {
  gateSignalRepository,
  type NewGateSignal,
} from '@/lib/repositories/gate-signal.repository'
import { lumoCiRunRepository } from '@/lib/repositories/lumo-ci-run.repository'
import {
  LUMO_CI_CHECKS,
  LUMO_CI_CHECK_NAME_PREFIX,
  LUMO_CI_SOURCE,
  type CiCheckResult,
  type LumoCiCheck,
  type LumoCiJob,
} from './lumo-ci.config'

export interface RecordInput {
  job: LumoCiJob
  results: Record<LumoCiCheck, CiCheckResult>
}

export interface RecordOutcome {
  status: 'DONE' | 'FAILED'
  /** GateSignal rows written. */
  signals: number
}

export const lumoCiRecordService = {
  async record(input: RecordInput): Promise<RecordOutcome> {
    const { job, results } = input
    const rows: NewGateSignal[] = []
    const failures: string[] = []
    for (const check of LUMO_CI_CHECKS) {
      const result = results[check]
      if (result.kind !== 'ran') {
        failures.push(`${check}: ${result.reason}`)
        continue
      }
      rows.push({
        workspaceId: job.workspaceId,
        taskId: job.taskId,
        gateKey: check,
        outcome: result.exitCode === 0 ? 'success' : 'failure',
        provenance: 'independent_harness',
        source: LUMO_CI_SOURCE,
        checkName: `${LUMO_CI_CHECK_NAME_PREFIX} ${check}`,
        detailsUrl: null,
        headSha: job.headSha,
        prNumber: job.prNumber,
      })
    }
    const signals =
      rows.length > 0 ? await gateSignalRepository.createMany(rows) : 0
    const status = failures.length === 0 ? 'DONE' : 'FAILED'
    await lumoCiRunRepository.finish(
      job.ciRunId,
      status === 'DONE'
        ? { status }
        : { status, error: failures.join('; ').slice(0, 500) }
    )
    logger.info(
      `[lumo-ci] ${job.repo}#${job.prNumber}@${job.headSha.slice(0, 7)} run=${job.ciRunId} ${status} signals=${signals}` +
        (failures.length > 0 ? ` (${failures.join('; ').slice(0, 200)})` : '')
    )
    return { status, signals }
  },
}
