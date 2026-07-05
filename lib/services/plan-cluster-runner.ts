import { planRunService } from '@/lib/services/plan-run.service'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import { summariseIdeaEvidence } from '@/lib/services/idea-evidence-summary'
import { GENERATION_MODEL } from '@/lib/ai/models'
import type { ClusterIdeaInput } from '@/lib/llm/plan-cluster-client'
import type { Prisma } from '@prisma/client'

/**
 * Fail-soft per-idea evidence lookup: any thrown error (or malformed summary)
 * omits that idea's evidence rather than failing the whole clustering stage —
 * evidence is an enrichment, not a load-bearing input.
 */
async function safeEvidenceLines(ideaId: string): Promise<string[] | null> {
  try {
    const summary = await summariseIdeaEvidence(ideaId)
    const lines = summary.slack.concat(summary.web, summary.figma)
    return lines.length ? lines : null
  } catch {
    return null
  }
}

/**
 * Stage-1 (聚类) trigger for the design-thinking 转换器 (LUM-674). Fired
 * fail-soft after `POST /api/plan-runs` creates a run in CLUSTERING: it reads
 * the run's frozen `inputIdeaIds`, runs the Stage-1 cluster client, and records
 * the CLUSTER stage output (which advances the run to CLUSTERS_READY = gate A).
 *
 * This closes the end-to-end break that left every run stuck in CLUSTERING:
 * `startRun` created the run and returned, but nothing ever invoked the cluster
 * client, so the CLUSTER stage record was never produced and gate A sat on
 * "Working on the plan…" forever. The trigger is the run-start analogue of the
 * gate-A → Stage-2 (`triggerAlignStage`) hop.
 *
 * On any error the run's segment is marked FAILED (never left in CLUSTERING) so
 * it can be retried; the route's `waitUntil` never blocks on this and never
 * surfaces its failure to the caller, whose run-start has already succeeded.
 *
 * The `ai`/`@ai-sdk/gateway` client is dynamic-imported (jest TransformStream
 * trap — same pattern as the align / code-rule / policy-compiler runners).
 */
export async function triggerClusterStage(planRunId: string): Promise<void> {
  const run = await planRunRepository.findById(planRunId)
  if (!run || run.stage !== 'CLUSTERING') {
    // Not our segment to run (stale trigger / a retry raced us). No-op.
    return
  }

  try {
    const ideaRows = await ideaRepository.findByIds(run.inputIdeaIds)
    const evidenceByIdeaId = await Promise.all(
      ideaRows.map(i => safeEvidenceLines(i.id))
    )
    const ideas: ClusterIdeaInput[] = ideaRows.map((i, index) => ({
      id: i.id,
      statement: i.statement,
      sourceContext: i.sourceContext,
      evidence: evidenceByIdeaId[index] ?? null,
    }))

    const { callPlanClusterLLM } = await import('@/lib/llm/plan-cluster-client')
    const result = await callPlanClusterLLM(ideas)

    await planRunService.recordStageOutput({
      planRunId: run.id,
      kind: 'CLUSTER',
      output: {
        model: GENERATION_MODEL,
        // Token usage is not surfaced by the cluster client; recorded as 0
        // until it exposes usage (consistent with the other stage runners).
        promptTokens: 0,
        outputTokens: 0,
        llmInput: JSON.stringify(ideas),
        llmRawOutput: result as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (err) {
    const { logger } = await import('@/lib/logger')
    logger.error(`[plan-cluster-runner] Stage-1 failed for run ${run.id}:`, err)
    await planRunService.failStage(run.id).catch(() => {})
  }
}
