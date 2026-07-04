import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { REASONING_MODEL } from '@/lib/ai/models'
import type { ClusterGateOutput } from '@/lib/plan-run/cluster-gate'
import type { Prisma } from '@prisma/client'

/**
 * Stage-2 (对齐) trigger for the design-thinking 转换器 (LUM-669). Fired
 * fail-soft after gate A advances a run to ALIGNING: it builds the align input
 * from the human-confirmed clusters + the run's frozen priority snapshot, runs
 * the Stage-2 client, and records the ALIGN stage output (which advances the
 * run to ALIGNMENT_READY = gate B). On any error the run's segment is marked
 * FAILED so it can be retried; the caller (route `waitUntil`) never blocks on
 * this and never surfaces its failure to the reviewer, whose gate-A confirm has
 * already succeeded.
 *
 * The `ai`/`@ai-sdk/gateway` client is dynamic-imported (jest TransformStream
 * trap — same pattern as the code-rule / policy-compiler runners).
 */
export async function triggerAlignStage(planRunId: string): Promise<void> {
  const run = await planRunRepository.findById(planRunId)
  if (!run || run.stage !== 'ALIGNING') {
    // Not our gate to run (stale trigger / re-run raced us). No-op.
    return
  }

  try {
    const record = await planRunRepository.findStageRecord(run.id, 'CLUSTER')
    const confirmed = record?.humanConfirmedOutput as unknown as
      | ClusterGateOutput
      | null
      | undefined
    if (!confirmed) {
      throw new Error(
        `Plan run ${run.id} advanced to ALIGNING with no confirmed clustering`
      )
    }

    const ideaIds = confirmed.clusters.flatMap(c => c.ideaIds)
    const ideaRows = await ideaRepository.findByIds(ideaIds)
    const statementById = new Map(ideaRows.map(i => [i.id, i.statement]))

    // Stable, snapshot-local cluster ids echoed back by the align verdicts.
    const clusters = confirmed.clusters.map((c, i) => ({
      clusterId: `cluster-${i}`,
      label: c.name,
      items: c.ideaIds
        .map(id => statementById.get(id))
        .filter((s): s is string => typeof s === 'string'),
    }))

    const input = { clusters, priority: run.prioritySnapshot }

    const { alignClusters } = await import('@/lib/llm/plan-align-client')
    const result = await alignClusters(input)

    await planRunService.recordStageOutput({
      planRunId: run.id,
      kind: 'ALIGN',
      output: {
        model: REASONING_MODEL,
        // Token usage is not surfaced by the align client; recorded as 0 until
        // the client exposes usage (consistent with the other stage clients).
        promptTokens: 0,
        outputTokens: 0,
        llmInput: JSON.stringify(input),
        llmRawOutput: result as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    const { logger } = await import('@/lib/logger')
    logger.error(`[plan-align-runner] Stage-2 failed for run ${run.id}:`, err)
    await planRunService.failStage(run.id).catch(() => {})
  }
}
