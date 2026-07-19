import type { PlanRunStage } from '@prisma/client'
import {
  clusterIndexFromId,
  type ClusterGateOutput,
} from '@/lib/plan-run/cluster-gate'

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
  /**
   * The ideas the reviewer kept in this cluster for THIS plan (LUM-688) — a
   * subset of the cluster's gate-A-confirmed idea set, in gate-A order. An
   * unchecked idea is simply absent: it stays in the pool, unmarked, and Stage
   * 3 never sees it. This is the field `PlanGenerateInput.AlignedCluster.ideas`
   * ("as confirmed at gate B") has always been waiting for.
   */
  ideaIds: string[]
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

// ── per-idea 取舍 (LUM-688) ──────────────────────────────────────────────────

/**
 * The ideas gate A froze into the cluster an ALIGN verdict judges — the
 * authority for "which ideas may this cluster's gate-B selection contain".
 * Gate B is a keep/drop control, never a way to move an idea between clusters
 * (that is gate A's job).
 *
 * Cluster identity is positional (`cluster-<i>`), resolved with the shared
 * `clusterIndexFromId` so mint and parse can never drift (LUM-685). Fail-soft
 * to `[]` on an unresolvable id or a missing clustering, matching how the board
 * degrades a card it cannot label: the verdict still confirms, but with no
 * idea it can claim — and a cluster with no ideas can't be starred into
 * Stage 3, so nothing unaccounted-for reaches the plan.
 */
export function clusterIdeaUniverse(
  clusterId: string,
  clustering: ClusterGateOutput | undefined
): string[] {
  const index = clusterIndexFromId(clusterId)
  if (index === null) return []
  return clustering?.clusters[index]?.ideaIds ?? []
}

/**
 * Resolve one cluster's kept idea ids from the reviewer's submission.
 *
 * - `submitted` omitted → every idea is kept. A client that predates the
 *   per-idea checkboxes therefore confirms the whole cluster, exactly as it
 *   did before; it can never silently drop ideas from the plan.
 * - `submitted` given → it must be a duplicate-free subset of the cluster's
 *   gate-A idea set. An id from another cluster (or from nowhere) is a 422:
 *   the gate cannot be used to smuggle an idea into a cluster it was never
 *   clustered into.
 *
 * Returns the kept ids in gate-A order, so the frozen record reads the same
 * way regardless of the order the board happened to send.
 */
export function resolveKeptIdeaIds(args: {
  clusterId: string
  universe: string[]
  /** Explicitly `| undefined` so callers may forward an optional field under
   *  `exactOptionalPropertyTypes`. */
  submitted?: string[] | undefined
}): string[] {
  const { clusterId, universe, submitted } = args
  if (submitted === undefined) return [...universe]

  const kept = new Set<string>()
  for (const id of submitted) {
    if (kept.has(id)) {
      throw unprocessable(
        `Cluster "${clusterId}" lists idea "${id}" more than once`
      )
    }
    if (!universe.includes(id)) {
      throw unprocessable(
        `Idea "${id}" is not in cluster "${clusterId}"'s confirmed idea set`
      )
    }
    kept.add(id)
  }
  return universe.filter(id => kept.has(id))
}

function unprocessable(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 422 })
}
