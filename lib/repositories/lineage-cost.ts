/** Uniform per-run cost shape consumed by LineageEdge readers (LUM-275). */
export interface RunCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  loopCount: number
}

interface CostColumns {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  loopCount: number | null
}

interface EdgeCostInput {
  runId: string | null
  run: CostColumns | null
  sessionId: string | null
  session: CostColumns | null
}

function toCost(c: CostColumns | null | undefined): RunCost | null {
  if (!c) return null
  const allNull =
    c.inputTokens === null &&
    c.outputTokens === null &&
    c.cacheReadTokens === null &&
    c.cacheCreationTokens === null &&
    c.loopCount === null
  if (allNull) return null
  return {
    inputTokens: c.inputTokens ?? 0,
    outputTokens: c.outputTokens ?? 0,
    cacheReadTokens: c.cacheReadTokens ?? 0,
    cacheCreationTokens: c.cacheCreationTokens ?? 0,
    loopCount: c.loopCount ?? 0,
  }
}

/**
 * Resolve a LineageEdge's cost: prefer the AgentRun (the run that produced the
 * outcome), fall back to the Session. Returns null when neither side has any
 * captured cost. This is the DoD-4 exit (LUM-281) consumed by lineage readers.
 */
export function getEdgeCost(edge: EdgeCostInput): RunCost | null {
  return toCost(edge.run) ?? toCost(edge.session)
}
