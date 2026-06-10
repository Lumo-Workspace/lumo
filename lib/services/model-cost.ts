import { IN_FLIGHT_MODEL } from '@/types/model-cost'

/** Per-model run/turn cost shapes shared by the Agent Run timeline (LUM-298). */
export interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

/**
 * Convert a stored usageByModel JSON map -> ModelCost[] sorted by total desc.
 * Returns null when there's nothing captured (historical rows / no usage), so
 * callers render nothing rather than a row of zeros.
 */
export function toModelCosts(
  byModel: Record<string, ModelUsage> | null | undefined
): ModelCost[] | null {
  if (!byModel) return null
  const out: ModelCost[] = []
  for (const [model, u] of Object.entries(byModel)) {
    const input = num(u?.input)
    const output = num(u?.output)
    const cacheRead = num(u?.cacheRead)
    const cacheCreation = num(u?.cacheCreation)
    out.push({
      model,
      input,
      output,
      cacheRead,
      cacheCreation,
      total: input + output + cacheRead + cacheCreation,
    })
  }
  if (out.length === 0) return null
  return out.sort((a, b) => b.total - a.total)
}

/** Flat cumulative token columns from a Session row (nullable pre-capture). */
export interface FlatSessionUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

/**
 * Append the in-flight (not yet STOP-settled) burn to a run's per-model cost.
 *
 * Mid-turn usage events overwrite only the flat cumulative columns;
 * usageByModel is the STOP-anchored settlement baseline (LUM-345). So
 * `flat − Σ usageByModel`, per token kind and clamped at 0, is exactly the
 * burn of the turn currently in flight — attributed to the sentinel
 * {@link IN_FLIGHT_MODEL} row because mid-turn payloads carry no per-model
 * split. Both sides are written from the same cumulative transcript totals at
 * STOP, so the delta is 0 (and no row is added) for every settled session.
 *
 * Returns null when neither settled nor in-flight usage exists, matching the
 * `toModelCosts` contract so callers render nothing.
 */
export function withInFlightCost(
  byModel: ModelCost[] | null,
  flat: FlatSessionUsage
): ModelCost[] | null {
  const settled = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  for (const c of byModel ?? []) {
    settled.input += c.input
    settled.output += c.output
    settled.cacheRead += c.cacheRead
    settled.cacheCreation += c.cacheCreation
  }
  const input = Math.max(0, num(flat.inputTokens) - settled.input)
  const output = Math.max(0, num(flat.outputTokens) - settled.output)
  const cacheRead = Math.max(0, num(flat.cacheReadTokens) - settled.cacheRead)
  const cacheCreation = Math.max(
    0,
    num(flat.cacheCreationTokens) - settled.cacheCreation
  )
  const total = input + output + cacheRead + cacheCreation
  if (total === 0) return byModel
  const inFlight: ModelCost = {
    model: IN_FLIGHT_MODEL,
    input,
    output,
    cacheRead,
    cacheCreation,
    total,
  }
  return [...(byModel ?? []), inFlight].sort((a, b) => b.total - a.total)
}

/** Merge several ModelCost[] (e.g. per-run -> tab total), summing same-model. */
export function mergeModelCosts(lists: (ModelCost[] | null)[]): ModelCost[] {
  const acc = new Map<string, ModelCost>()
  for (const list of lists) {
    if (!list) continue
    for (const c of list) {
      const cur = acc.get(c.model) ?? {
        model: c.model,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 0,
      }
      cur.input += c.input
      cur.output += c.output
      cur.cacheRead += c.cacheRead
      cur.cacheCreation += c.cacheCreation
      cur.total += c.total
      acc.set(c.model, cur)
    }
  }
  return [...acc.values()].sort((a, b) => b.total - a.total)
}
