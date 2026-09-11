/**
 * LUM-746 — the Lumo-managed CI run: one Vercel Sandbox, several steps.
 *
 *   prepare  → boot the VM at the PR head, npm ci + prisma generate + build:shared
 *   typecheck → `tsc --noEmit` in that VM
 *   test     → `jest --ci --shard=i/N`, one step per shard, same VM
 *   stop     → release the VM (best-effort; it times out on its own anyway)
 *   record   → one GateSignal per check that RAN; LumoCiRun closed
 *
 * Every check's result is a value: `ran` (a verdict, exit code intact) or
 * `failed` (the harness — never a verdict). A step whose retries are
 * exhausted is folded into `failed` for the checks it covers, so the run
 * always reaches `record` and the ledger row never stays PENDING by
 * accident. Deterministic body: no I/O, no logging, no environment.
 */
import {
  aggregateShardResults,
  type CiCheckResult,
  type CiCheckSpec,
  type LumoCiJob,
} from '@/lib/services/lumo-ci.config'
import {
  prepareCiSandboxStep,
  recordCiOutcomeStep,
  runCiCheckStep,
  stopCiSandboxStep,
} from './lumo-ci.steps'

export interface LumoCiWorkflowResult {
  outcome: 'DONE' | 'FAILED'
  ciRunId: string
  signals: number
  reason?: string
}

function reasonOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

function harnessFailed(reason: string): CiCheckResult {
  return { kind: 'failed', reason }
}

export async function lumoCiWorkflow(
  job: LumoCiJob
): Promise<LumoCiWorkflowResult> {
  'use workflow'

  let results: Record<'typecheck' | 'test', CiCheckResult>
  let prepared
  try {
    prepared = await prepareCiSandboxStep(job)
  } catch (error) {
    prepared = {
      kind: 'failed' as const,
      reason: `prepare: ${reasonOf(error)}`,
    }
  }

  if (prepared.kind === 'failed') {
    results = {
      typecheck: harnessFailed(prepared.reason),
      test: harnessFailed(prepared.reason),
    }
  } else {
    const { sandbox } = prepared
    const check = async (spec: CiCheckSpec): Promise<CiCheckResult> => {
      try {
        return await runCiCheckStep({ sandbox, headSha: job.headSha, spec })
      } catch (error) {
        return harnessFailed(reasonOf(error))
      }
    }
    const typecheck = await check({ check: 'typecheck' })
    const shards: CiCheckResult[] = []
    if (job.jestShards <= 1) {
      shards.push(await check({ check: 'test' }))
    } else {
      for (let i = 1; i <= job.jestShards; i += 1) {
        shards.push(
          await check({
            check: 'test',
            shard: { index: i, total: job.jestShards },
          })
        )
      }
    }
    results = { typecheck, test: aggregateShardResults(shards) }
    try {
      await stopCiSandboxStep(sandbox)
    } catch {
      // Retries exhausted inside the step; the VM times out on its own.
    }
  }

  try {
    const recorded = await recordCiOutcomeStep({ job, results })
    return {
      outcome: recorded.status,
      ciRunId: job.ciRunId,
      signals: recorded.signals,
    }
  } catch (error) {
    return {
      outcome: 'FAILED',
      ciRunId: job.ciRunId,
      signals: 0,
      reason: `record: ${reasonOf(error)}`,
    }
  }
}
