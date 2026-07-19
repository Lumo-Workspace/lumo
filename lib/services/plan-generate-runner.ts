import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { GENERATION_MODEL } from '@/lib/ai/models'
import {
  clusterIndexFromId,
  type ClusterGateOutput,
} from '@/lib/plan-run/cluster-gate'
import {
  selectStarredAligned,
  type AlignGateConfirmedOutput,
} from '@/lib/plan-run/gate-b'
import type { AlignedCluster } from '@/lib/llm/plan-generate-client'
import type { Prisma } from '@prisma/client'

/**
 * Stage-3 (成计划) trigger for the design-thinking 转换器 (LUM-689). Fired
 * fail-soft after gate B advances a run to GENERATING: it builds the plan input
 * from the gate-B-confirmed alignment + the run's frozen priority snapshot,
 * runs the Stage-3 client, and records the GENERATE stage output (which
 * advances the run to DRAFT_READY = gate C).
 *
 * This closes the last unwired hop of the converter. Gate A fires
 * `triggerAlignStage`, but gate B advanced the run to GENERATING and returned
 * with nothing behind it — `callPlanGenerateLLM` had no caller anywhere in the
 * repo, so every confirmed run sat on "Working on the plan…" forever.
 *
 * On any error the run's segment is marked FAILED so it can be retried; the
 * caller (route `waitUntil`) never blocks on this and never surfaces its
 * failure to the reviewer, whose gate-B confirm has already succeeded.
 *
 * The `ai`/`@ai-sdk/gateway` client is dynamic-imported (jest TransformStream
 * trap — same pattern as the Stage-1/Stage-2 runners).
 */
export async function triggerGenerateStage(planRunId: string): Promise<void> {
  const run = await planRunRepository.findById(planRunId)
  if (!run || run.stage !== 'GENERATING') {
    // Not our gate to run (stale trigger / re-run raced us). No-op.
    return
  }

  try {
    const alignRecord = await planRunRepository.findStageRecord(run.id, 'ALIGN')
    const confirmed = alignRecord?.humanConfirmedOutput as unknown as
      | AlignGateConfirmedOutput
      | null
      | undefined
    if (!confirmed) {
      throw new Error(
        `Plan run ${run.id} advanced to GENERATING with no confirmed alignment`
      )
    }

    // Only the (≤2) clusters a human both starred AND judged ALIGNED reach the
    // plan. Everything else was deliberately shelved at gate B.
    const selected = selectStarredAligned(confirmed.clusters)

    // Cluster identity is positional: the theme lives on gate A's clustering,
    // joined back through the shared id parser so mint and parse can't drift
    // (LUM-685). Degrade the label to a placeholder rather than failing the
    // stage — the ideas are the load-bearing input, the theme is a heading.
    const clusterRecord = await planRunRepository.findStageRecord(
      run.id,
      'CLUSTER'
    )
    const clustering = clusterRecord?.humanConfirmedOutput as unknown as
      | ClusterGateOutput
      | null
      | undefined

    // The ideas the reviewer KEPT at gate B (LUM-688) — not gate A's full
    // cluster. An unchecked idea stays in the pool and Stage 3 never sees it.
    const keptIds = selected.flatMap(c => c.ideaIds)
    const ideaRows = await ideaRepository.findByIds(keptIds)
    const statementById = new Map(ideaRows.map(i => [i.id, i.statement]))

    const clusters: AlignedCluster[] = selected.map(c => {
      const index = clusterIndexFromId(c.clusterId)
      const theme =
        (index === null ? undefined : clustering?.clusters[index]?.name) ??
        c.clusterId
      return {
        clusterId: c.clusterId,
        label: c.verdict,
        starred: c.starred,
        theme,
        ideas: c.ideaIds
          .map(id => statementById.get(id))
          .filter((s): s is string => typeof s === 'string'),
      }
    })

    const input = { priority: run.prioritySnapshot, clusters }

    const { callPlanGenerateLLM } =
      await import('@/lib/llm/plan-generate-client')
    const result = await callPlanGenerateLLM(input)

    await planRunService.recordStageOutput({
      planRunId: run.id,
      kind: 'GENERATE',
      output: {
        model: GENERATION_MODEL,
        // Token usage is not surfaced by the generate client; recorded as 0
        // until it exposes usage (consistent with the other stage runners).
        promptTokens: 0,
        outputTokens: 0,
        llmInput: JSON.stringify(input),
        llmRawOutput: result as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    const { logger } = await import('@/lib/logger')
    logger.error(
      `[plan-generate-runner] Stage-3 failed for run ${run.id}:`,
      err
    )
    await planRunService.failStage(run.id).catch(() => {})
  }
}
