/**
 * LUM-739 — read-only queries over the diff subgraph, and the reachability
 * classification the mechanical gate stamps on a candidate (spec §6 L3
 * "Verify" step 1). Pure.
 *
 * LUM-758 Task 10 — `callersOf` / `calleesOf` / `pathToEntry` are gone. They
 * backed the `callers_of` / `callees_of` / `path_to_entry` TOOLS, which Task 9
 * replaced with a restricted shell over the checkout; Task 10 confirmed the
 * mechanical gate does not use them either (`reachability` walks the reverse
 * adjacency itself), so they were dead code with only their own test left.
 */
import type { Subgraph, GraphSymbol } from './types'

export type Reachability = 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN'

function reverseAdjacency(g: Subgraph): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of g.edges) {
    const list = out.get(e.to)
    if (list) list.push(e.from)
    else out.set(e.to, [e.from])
  }
  return out
}

export function symbolById(g: Subgraph, id: string): GraphSymbol | undefined {
  return g.symbols.find(s => s.id === id)
}

/**
 * EXTERNAL — an entry reaches the sink through symbols none of which carry
 * a control (the entry included). INTERNAL — an entry reaches it, but every
 * such path crosses a control. UNKNOWN — no entry reaches it (truncated
 * subgraph, or genuinely internal code); never read as "unreachable".
 */
export function reachability(g: Subgraph, sinkId: string): Reachability {
  if (!symbolById(g, sinkId)) return 'UNKNOWN'
  const byId = new Map(g.symbols.map(s => [s.id, s]))
  const rev = reverseAdjacency(g)
  const uncontrolled = (s: GraphSymbol | undefined) =>
    s !== undefined && s.controls.length === 0

  const search = (onlyUncontrolled: boolean): boolean => {
    const seen = new Set<string>([sinkId])
    const queue = [sinkId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const sym = byId.get(cur)
      if (cur !== sinkId) {
        if (onlyUncontrolled && !uncontrolled(sym)) continue
        if (sym?.kind === 'entry') return true
      }
      for (const caller of rev.get(cur) ?? []) {
        if (seen.has(caller)) continue
        seen.add(caller)
        queue.push(caller)
      }
    }
    return false
  }

  if (search(true)) return 'EXTERNAL'
  if (search(false)) return 'INTERNAL'
  return 'UNKNOWN'
}
