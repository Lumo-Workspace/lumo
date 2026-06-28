/**
 * Static gate map (LUM-614) — the single source of truth that classifies the
 * engineer-facing mechanical gates into a stable key set, splits them by how
 * their signal is produced, and (for execution gates) carries the command
 * patterns that recognize an executed check in the hook-event stream.
 *
 * Shared by the read-model that derives a delivery's gate audit (server) and
 * the delivery-card panel that renders it (app). It deliberately carries NO
 * status — status is derived per delivery from HookEvent rows, never stored.
 *
 * The class → provenance split is the load-bearing distinction (the fidelity
 * independence axis): a detection gate is something Lumo derives itself from
 * the tool-intent stream it already ingests (independent of the agent), while
 * an execution gate only ever rides on the agent's OWN tool runs today — the
 * agent chose to run it and could skip it, so its green is self-reported, not
 * an independent fact. Provenance is a pure function of class so a new gate
 * can never silently land in the wrong trust bucket.
 */

export type GateKey =
  // Execution-class — pass/fail comes from running a command the agent ran.
  | 'parse'
  | 'typecheck'
  | 'build'
  | 'test'
  // Detection-class — Lumo derives the signal server-side from tool intent.
  | 'diff-scope'
  | 'git-hygiene'

export type GateClass = 'detection' | 'execution'

export type GateProvenance = 'independent_harness' | 'agent_self_reported'

export interface GateDefinition {
  key: GateKey
  class: GateClass
  provenance: GateProvenance
  /**
   * Regexes that classify an executed shell command as this gate. Execution
   * gates only — detection gates carry an empty list (their signal never comes
   * from a recognized command, it's a server-side derivation).
   */
  commandPatterns: RegExp[]
}

/** Provenance is a pure function of class — the only place the mapping lives. */
export function provenanceForClass(cls: GateClass): GateProvenance {
  return cls === 'detection' ? 'independent_harness' : 'agent_self_reported'
}

type RawDefinition = Pick<GateDefinition, 'key' | 'class' | 'commandPatterns'>

const RAW_DEFINITIONS: readonly RawDefinition[] = [
  { key: 'parse', class: 'execution', commandPatterns: [/node\s+--check/] },
  {
    key: 'typecheck',
    class: 'execution',
    commandPatterns: [/\btsc\b(?!.*\bbuild\b)/, /typecheck/],
  },
  {
    key: 'build',
    class: 'execution',
    commandPatterns: [/\bnext\s+build\b/, /\bnpm\s+run\s+build\b/],
  },
  {
    key: 'test',
    class: 'execution',
    commandPatterns: [/\bjest\b/, /\bvitest\b/, /\bnpm\s+(run\s+)?test\b/],
  },
  { key: 'diff-scope', class: 'detection', commandPatterns: [] },
  { key: 'git-hygiene', class: 'detection', commandPatterns: [] },
]

const DEFINITIONS: Record<GateKey, GateDefinition> = RAW_DEFINITIONS.reduce(
  (acc, raw) => {
    acc[raw.key] = { ...raw, provenance: provenanceForClass(raw.class) }
    return acc
  },
  {} as Record<GateKey, GateDefinition>
)

export const ALL_GATE_KEYS: readonly GateKey[] = RAW_DEFINITIONS.map(d => d.key)

export const GATE_DEFINITIONS: readonly GateDefinition[] = ALL_GATE_KEYS.map(
  k => DEFINITIONS[k]
)

/** Look up a gate's definition by key. */
export function gateDefinition(key: GateKey): GateDefinition {
  return DEFINITIONS[key]
}

/**
 * Classify an executed shell command as an execution gate, or null when it
 * matches none. Detection gates are never returned here — they're not derived
 * from commands. First match wins in declaration order.
 */
export function classifyCommand(command: string): GateKey | null {
  for (const def of GATE_DEFINITIONS) {
    if (def.commandPatterns.some(p => p.test(command))) return def.key
  }
  return null
}
