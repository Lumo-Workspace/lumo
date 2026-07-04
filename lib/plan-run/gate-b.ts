import type { PlanRunStage } from '@prisma/client'

/**
 * Gate B (闸门B · 对齐确认) pure domain module for the design-thinking 转换器.
 *
 * Kept dependency-free on purpose: the Stage-2 align client
 * (`lib/llm/plan-align-client.ts`) statically imports `ai` / `@ai-sdk/gateway`
 * (the TransformStream jest trap), so anything jest loads in a node env — the
 * validation schema, the gate service, the route, and their tests — takes its
 * verdict enum and selection logic from HERE, never from the LLM client. Types
 * from the client may still be pulled with `import type` (erased at runtime).
 */

/** The three alignment verdicts a human confirms at gate B. */
export const ALIGN_VERDICTS = ['ALIGNED', 'UNRELATED', 'CONFLICT'] as const
export type AlignVerdict = (typeof ALIGN_VERDICTS)[number]

/** At most this many clusters may be starred (the "plan this now" signal). */
export const MAX_STARRED = 2

/** The gate open at ALIGNMENT_READY and the stage it advances to on confirm. */
export const ALIGN_GATE_STAGE: PlanRunStage = 'ALIGNMENT_READY'
export const ALIGN_GATE_NEXT_STAGE: PlanRunStage = 'GENERATING'

/**
 * One cluster's human-confirmed alignment judgment — the shape stored in the
 * ALIGN stage record's `humanConfirmedOutput.clusters`. `customizationTrap` is
 * carried through from the LLM's ALIGN output (server-authoritative), not the
 * client, so the frozen record can't be talked out of a trap flag.
 */
export interface ConfirmedAlignCluster {
  clusterId: string
  verdict: AlignVerdict
  starred: boolean
  rationale: string
  customizationTrap: boolean
}

/** The gate-B-confirmed judgment persisted as `humanConfirmedOutput`. */
export interface AlignGateConfirmedOutput {
  clusters: ConfirmedAlignCluster[]
}

/**
 * The (≤2) clusters that flow downstream to Stage 3 (成计划): only those a human
 * both starred AND judged ALIGNED. Mirrors the Stage-3 client's
 * `selectClustersForPlanning`, expressed on the gate-B judgment shape so the
 * gate can report exactly what it hands off without loading the LLM client.
 * "Top 1–2" = the first two qualifying clusters in confirmed order.
 */
export function selectStarredAligned<
  T extends { starred: boolean; verdict: AlignVerdict },
>(clusters: T[]): T[] {
  return clusters
    .filter(c => c.starred && c.verdict === 'ALIGNED')
    .slice(0, MAX_STARRED)
}
