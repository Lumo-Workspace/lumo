// ── Gate A (闸门A) cluster-edit shape + integrity check (LUM-669) ─────────────
// The reviewer edits Stage-1's clustering (rename clusters, move ideas between
// clusters / the orphan zone) — never merge/split, never add/drop ideas. The
// confirmed structure is therefore the same shape as the LLM's raw output and
// must partition the *same* idea-id universe exactly. This module is pure (no
// Prisma, no `ai`/gateway import) so the state-machine service and the gate
// route can both depend on it without pulling the LLM SDK into their bundles.

/** One cluster on the board: a human-editable `name`, the Stage-1 `thrust`
 *  (carried through unchanged — the reviewer only renames + moves), and the
 *  ids of the ideas currently in it. */
export interface ClusterGateCluster {
  name: string
  thrust: string
  ideaIds: string[]
}

/** The full board structure — clusters plus the single orphan zone. Mirrors
 *  `PlanClusterOutput` from the Stage-1 client, decoupled on purpose. */
export interface ClusterGateOutput {
  clusters: ClusterGateCluster[]
  orphans: string[]
}

/** Every idea id referenced across all clusters + the orphan zone, in order. */
export function collectClusterGateIds(output: ClusterGateOutput): string[] {
  return [...output.clusters.flatMap(c => c.ideaIds), ...output.orphans]
}

// ── Snapshot-local cluster ids ───────────────────────────────────────────────
// A confirmed cluster has no id of its own — it is identified by its POSITION
// in `ClusterGateOutput.clusters`. Stage-2 mints `cluster-<i>` from that index
// when building the align input, and the ALIGN verdicts echo it back, so the id
// is the only link from a gate-B verdict back to the cluster it judged
// (LUM-685). Minting and parsing live here so the two sides can never drift.

const CLUSTER_ID_PREFIX = 'cluster-'

/** The snapshot-local id for the cluster at `index` of a confirmed clustering. */
export function clusterIdForIndex(index: number): string {
  return `${CLUSTER_ID_PREFIX}${index}`
}

/**
 * The confirmed-clustering index a `cluster-<i>` id points at, or null if the
 * id isn't one we minted (an LLM that garbled the echo, or an id from a future
 * scheme). Callers treat null as "cluster identity unresolvable" and degrade —
 * a verdict must never be dropped just because its label can't be resolved.
 */
export function clusterIndexFromId(clusterId: string): number | null {
  if (!clusterId.startsWith(CLUSTER_ID_PREFIX)) return null
  const raw = clusterId.slice(CLUSTER_ID_PREFIX.length)
  // Reject '', '1.5', '+1', '01', ' 1' — only canonical non-negative integers.
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null
  return Number(raw)
}

/**
 * Assert a human edit still partitions `universe` (the id set of the original
 * Stage-1 clustering) exactly: every original id present exactly once, no
 * invented id, no duplicate. A rename/move can only permute ids across buckets
 * — anything else is a corrupt edit and must not reach Stage-2. Also rejects a
 * blank cluster name. Throws an Error carrying `{ status: 422 }` on violation.
 */
export function assertEditPartitionsUniverse(
  universe: Set<string>,
  edited: ClusterGateOutput
): void {
  for (const cluster of edited.clusters) {
    if (cluster.name.trim().length === 0) {
      throw unprocessable('A cluster name cannot be blank')
    }
  }

  const seen = new Set<string>()
  for (const id of collectClusterGateIds(edited)) {
    if (!universe.has(id)) {
      throw unprocessable(
        `Edited clustering references idea id "${id}" that was not in the original clustering`
      )
    }
    if (seen.has(id)) {
      throw unprocessable(
        `Edited clustering assigns idea id "${id}" more than once`
      )
    }
    seen.add(id)
  }

  if (seen.size !== universe.size) {
    const missing = [...universe].filter(id => !seen.has(id))
    throw unprocessable(
      `Edited clustering dropped ${missing.length} idea id(s): ${missing.join(', ')}`
    )
  }
}

function unprocessable(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 422 })
}
