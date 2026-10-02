import { IN_FLIGHT_MODEL } from '@/types/model-cost'

/** Per-model run/turn cost shapes shared by the Agent Run timeline (LUM-298). */
export interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  /**
   * The share of this row that is mid-turn burn not yet settled by a STOP
   * anchor (LUM-345). The flat fields above already INCLUDE it — `inFlight`
   * tells the UI how much of the row to render as provisional. Absent on
   * fully settled rows.
   */
  inFlight?: ModelUsage & { total: number }
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
  flat: FlatSessionUsage,
  liveByModel?: Record<string, ModelUsage> | null
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

  // Per-model attribution: `liveUsageByModel` is the mid-turn snapshot of the
  // same cumulative transcript map that STOP settles into usageByModel, so
  // `live[m] − settled[m]` (clamped per kind) is model m's share of the
  // in-flight burn. A stale snapshot (≤ settled, i.e. post-STOP) clamps to
  // zero everywhere and changes nothing — no clearing write is needed.
  const rows: ModelCost[] = []
  const settledRows = new Map((byModel ?? []).map(r => [r.model, r]))
  const attributed = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  const models = new Set([
    ...settledRows.keys(),
    ...Object.keys(liveByModel ?? {}),
  ])
  for (const model of models) {
    const s = settledRows.get(model)
    const l = liveByModel?.[model]
    const fl = {
      input: Math.max(0, num(l?.input) - (s?.input ?? 0)),
      output: Math.max(0, num(l?.output) - (s?.output ?? 0)),
      cacheRead: Math.max(0, num(l?.cacheRead) - (s?.cacheRead ?? 0)),
      cacheCreation: Math.max(
        0,
        num(l?.cacheCreation) - (s?.cacheCreation ?? 0)
      ),
    }
    const flTotal = fl.input + fl.output + fl.cacheRead + fl.cacheCreation
    if (flTotal === 0) {
      if (s) rows.push(s)
      continue
    }
    attributed.input += fl.input
    attributed.output += fl.output
    attributed.cacheRead += fl.cacheRead
    attributed.cacheCreation += fl.cacheCreation
    rows.push({
      model,
      input: (s?.input ?? 0) + fl.input,
      output: (s?.output ?? 0) + fl.output,
      cacheRead: (s?.cacheRead ?? 0) + fl.cacheRead,
      cacheCreation: (s?.cacheCreation ?? 0) + fl.cacheCreation,
      total: (s?.total ?? 0) + flTotal,
      inFlight: { ...fl, total: flTotal },
    })
  }

  // Whatever the live map doesn't account for (no/old-CLI payloads carry no
  // byModel; the snapshot can trail the flat columns) stays on the sentinel
  // row — the pre-attribution behavior is exactly the all-residual case.
  const rest = {
    input: Math.max(0, input - attributed.input),
    output: Math.max(0, output - attributed.output),
    cacheRead: Math.max(0, cacheRead - attributed.cacheRead),
    cacheCreation: Math.max(0, cacheCreation - attributed.cacheCreation),
  }
  const restTotal =
    rest.input + rest.output + rest.cacheRead + rest.cacheCreation
  if (restTotal > 0)
    rows.push({ model: IN_FLIGHT_MODEL, ...rest, total: restTotal })
  if (rows.length === 0) return byModel
  return rows.sort((a, b) => b.total - a.total)
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
      if (c.inFlight) {
        const fl = cur.inFlight ?? {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
          total: 0,
        }
        fl.input += c.inFlight.input
        fl.output += c.inFlight.output
        fl.cacheRead += c.inFlight.cacheRead
        fl.cacheCreation += c.inFlight.cacheCreation
        fl.total += c.inFlight.total
        cur.inFlight = fl
      }
      acc.set(c.model, cur)
    }
  }
  return [...acc.values()].sort((a, b) => b.total - a.total)
}

/**
 * Per-model sum of two usage maps (`a` may be null). Pure; never mutates its
 * inputs. The one shared summing helper for `usageByModel` JSON maps.
 */
export function addUsageMaps(
  a: Record<string, ModelUsage> | null,
  b: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = { ...(a ?? {}) }
  for (const [model, u] of Object.entries(b)) {
    const cur = out[model] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    out[model] = {
      input: cur.input + num(u?.input),
      output: cur.output + num(u?.output),
      cacheRead: cur.cacheRead + num(u?.cacheRead),
      cacheCreation: cur.cacheCreation + num(u?.cacheCreation),
    }
  }
  return out
}

/** Per-kind totals across every model of a usage map (non-numbers → 0). */
export function usageMapKindTotals(m: Record<string, ModelUsage>): ModelUsage {
  const t = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  for (const u of Object.values(m)) {
    t.input += num(u?.input)
    t.output += num(u?.output)
    t.cacheRead += num(u?.cacheRead)
    t.cacheCreation += num(u?.cacheCreation)
  }
  return t
}

/** Total tokens across every model and kind of a usage map. */
export function usageMapTotal(m: Record<string, ModelUsage>): number {
  const t = usageMapKindTotals(m)
  return t.input + t.output + t.cacheRead + t.cacheCreation
}
