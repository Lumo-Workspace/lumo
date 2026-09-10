/**
 * LUM-739 — read-only queries over the diff subgraph: the tools the Hunt
 * model is given (`callers_of`, `callees_of`, `path_to_entry`) and the
 * reachability classification the mechanical gate stamps on a candidate
 * (spec §6 L3 "Verify" step 1). Pure.
 */
import type { Subgraph, GraphSymbol } from './types'

export type Reachability = 'EXTERNAL' | 'INTERNAL' | 'UNKNOWN'

function forwardAdjacency(g: Subgraph): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of g.edges) {
    const list = out.get(e.from)
    if (list) list.push(e.to)
    else out.set(e.from, [e.to])
  }
  return out
}

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

export function callersOf(g: Subgraph, id: string): string[] {
  return reverseAdjacency(g).get(id) ?? []
}

export function calleesOf(g: Subgraph, id: string): string[] {
  return forwardAdjacency(g).get(id) ?? []
}

/**
 * Shortest path from some entry symbol down to `id` (inclusive, entry
 * first), or null when no entry reaches it.
 */
export function pathToEntry(g: Subgraph, id: string): string[] | null {
  if (!symbolById(g, id)) return null
  const byId = new Map(g.symbols.map(s => [s.id, s]))
  const rev = reverseAdjacency(g)
  const parent = new Map<string, string | null>([[id, null]])
  const queue = [id]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (byId.get(cur)?.kind === 'entry') {
      const path: string[] = []
      for (let n: string | null = cur; n !== null; n = parent.get(n) ?? null)
        path.push(n)
      return path
    }
    for (const caller of rev.get(cur) ?? []) {
      if (parent.has(caller)) continue
      parent.set(caller, cur)
      queue.push(caller)
    }
  }
  return null
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
