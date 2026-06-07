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
