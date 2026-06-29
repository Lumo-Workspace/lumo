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
 * The class → provenance split seeds the fidelity independence axis: a detection
 * gate is something Lumo derives itself from the tool-intent stream it already
 * ingests (independent of the agent). An execution gate's signal can come from
 * EITHER source: the agent's own tool runs (self-reported — it chose to run the
 * check and could skip it) OR, as of LUM-616, an independent CI run read back
 * from GitHub (check-runs / commit-statuses), which the agent cannot skip or
 * fake. So execution-gate provenance is no longer a pure function of class — it
 * is carried per produced signal (see NormalizedGateEvent.provenance in the
 * gate-audit read-model); `provenanceForClass` is only the not-run/not-configured
 * default. Detection-gate provenance is still class-fixed.
 */

export type GateKey =
  // Execution-class — pass/fail comes from a build/test/typecheck run (agent's
  // own tool run, or an independent CI run read back from GitHub — LUM-616).
  | 'typecheck'
  | 'build'
  | 'test'
  // Detection-class — Lumo derives the signal server-side from tool intent.
  | 'diff-scope'

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
  // 'parse' (node --check) was dropped (LUM-616 follow-up): it's a strict subset
  // of typecheck/build (which both parse before they can run), so a separate
  // parse gate carried no independent information and was never sourced — it sat
  // perpetually not_run. Removed rather than fabricated-green.
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
  // 'git-hygiene' was dropped (LUM-616 follow-up): its core (committed secrets)
  // is already the HARDCODED_SECRET boundary crossing — detected server-side,
  // surfaced in the crossings panel, AND blocks DONE (stronger than an audit-only
  // gate). A git-hygiene gate would just be a weaker, redundant re-projection.
  // diff-scope stays: no crossing category covers out-of-declared-scope edits.
  { key: 'diff-scope', class: 'detection', commandPatterns: [] },
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
 * Strip double- and single-quoted substrings from a command line, leaving only
 * the unquoted invocation tokens. This is what stops a gate keyword that merely
 * appears inside an *argument* — e.g. a `lumo task create "…parse/typecheck/
 * build/test…"` description, or `echo "…run the test…"` — from being mistaken
 * for an invocation of that gate (the LUM-614 prod false-positive, where a
 * task-create description was classified as a passed typecheck and overwrote
 * the real `tsc` signal). A real gate run names its tool unquoted, so it
 * survives the strip.
 */
function unquotedInvocation(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')
}

/**
 * Classify an executed shell command as an execution gate, or null when it
 * matches none. Matching runs against the unquoted invocation only, so a gate
 * keyword buried in quoted argument text never produces a false signal.
 * Detection gates are never returned here — they're not derived from commands.
 * First match wins in declaration order.
 */
export function classifyCommand(command: string): GateKey | null {
  const invocation = unquotedInvocation(command)
  for (const def of GATE_DEFINITIONS) {
    if (def.commandPatterns.some(p => p.test(invocation))) return def.key
  }
  return null
}

/**
 * Patterns that classify a CI check-run / commit-status NAME (not a shell
 * command) as an execution gate. LUM-616: the independent harness reads CI
 * signals straight from GitHub (check-runs + commit-statuses) across ANY
 * provider, and the only semantics GitHub exposes is each check's name plus its
 * pass/fail — so mapping a named check to a gate is unavoidably name-based.
 * Platform-agnostic on purpose (GitHub Actions, Vercel, CircleCI, Travis, …).
 * First match wins; order = most specific (typecheck/test) before the build
 * catch-all so a "build and test" job lands on the narrower gate.
 */
const CHECK_NAME_PATTERNS: readonly (readonly [GateKey, readonly RegExp[]])[] =
  [
    ['typecheck', [/\btypecheck\b/i, /\btsc\b/i, /type[\s-]?check/i]],
    ['test', [/\btests?\b/i, /\bjest\b/i, /\bvitest\b/i, /\bspec\b/i]],
    ['build', [/\bbuild\b/i, /\bvercel\b/i, /\bdeploy/i]],
  ]

/**
 * Classify a CI check / commit-status name as an execution gate, or null when
 * it matches none — an unrecognized check is dropped, never coerced into a
 * fabricated gate. A name carrying "comment" (e.g. "Vercel Preview Comments")
 * is a bot annotation, not a CI check, and is rejected before pattern matching.
 */
export function classifyGateName(name: string): GateKey | null {
  const n = name.trim()
  if (!n || /comment/i.test(n)) return null
  for (const [key, patterns] of CHECK_NAME_PATTERNS) {
    if (patterns.some(p => p.test(n))) return key
  }
  return null
}
