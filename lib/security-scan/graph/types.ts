/**
 * LUM-739 — the in-memory diff subgraph (spec §6 L3 "Map"). Pure data, no
 * I/O. Symbol id grammar:
 *   - functions / entries:  `<file>#<name>` (`<name>` = `fn`, `obj.method`,
 *     `Class.method`, `default`)
 *   - sinks / controls:     `<file>#<callee>@<line>` (one node per call site)
 *   - module scope:         `<file>#<module>` (calls made at the top level)
 * The subgraph carries file line counts so mechanical verification of a
 * candidate's `file:line` needs no second GitHub read — and no source text,
 * so it can travel through workflow step I/O.
 */

export type GraphSymbolKind =
  | 'function'
  | 'entry'
  | 'sink'
  | 'control'
  | 'module'

export interface GraphSymbol {
  id: string
  kind: GraphSymbolKind
  file: string
  /** 1-based line of the declaration / call site. */
  line: number
  name: string
  /** The pattern id that classified an entry / sink / control; null otherwise. */
  rule: string | null
  /** Control-pattern ids observed inside this function's body (functions/entries). */
  controls: string[]
}

export interface GraphEdge {
  from: string
  to: string
}

export interface GraphFile {
  path: string
  lineCount: number
  /** True when the PR diff added lines to this file (vs a one-hop import). */
  touched: boolean
}

export interface Subgraph {
  symbols: GraphSymbol[]
  edges: GraphEdge[]
  files: GraphFile[]
}

/**
 * LUM-758 Task 10 — a bound on how many files the MECHANICAL GATE reads when
 * it builds its verification subgraph on demand. It is NOT a cap on what the
 * hunt agent may see: the agent reads the whole checkout through the
 * restricted shell, and it no longer sets `partial` anywhere. Restoring
 * either meaning would bring back LUM-762's routine PARTIAL verdicts.
 */
export const SUBGRAPH_MAX_FILES = 40
