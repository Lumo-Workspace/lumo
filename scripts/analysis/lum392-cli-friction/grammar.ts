/**
 * LUM-413: single-source lumo CLI grammar, extracted by walking the live
 * commander tree that cli/src/index.ts registers (imported under
 * LUMO_CLI_INTROSPECT=1 so nothing executes). Pure helpers here — the I/O
 * wrapper that imports the CLI and writes grammar.json is emit-grammar.ts.
 *
 * The grammar drives the BFCL-style AST validator (validate.ts): it judges
 * whether an invocation is *structurally* constructible (known subcommand,
 * declared flags, legal enum values) — never whether it should have been
 * called. Enum value sets follow the CLI's own help-text convention of
 * listing choices as `a | b | c` in the option description (the CLI does not
 * use commander .choices(), so the description text IS the source agents see).
 */

export interface GrammarFlag {
  /** Long form, e.g. "--status". */
  long: string
  /** Short alias, e.g. "-s", when declared. */
  short: string | null
  /** Whether the flag takes a value: <required>, [optional] or none. */
  value: 'required' | 'optional' | 'none'
  /** Legal values parsed from the `a | b | c` help-text convention. */
  enum: string[] | null
  description: string
}

export interface GrammarCommand {
  /** Positional arguments declared on the command. */
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>
  /** Flags by long form (plus short aliases resolvable via `short`). */
  flags: Record<string, GrammarFlag>
  /** True when this node only routes to subcommands (no leaf behavior). */
  hasSubcommands: boolean
  description: string
}

export interface CliGrammar {
  /** cli/package.json version the snapshot was generated from. */
  cliVersion: string
  /** Command path (tokens joined by space, root `lumo` omitted) → node. */
  commands: Record<string, GrammarCommand>
}

/** Help flags commander injects on every command. */
export const GLOBAL_FLAGS: Record<string, GrammarFlag> = {
  '--help': {
    long: '--help',
    short: '-h',
    value: 'none',
    enum: null,
    description: 'display help for command',
  },
}

/** Root-only flags (valid on bare `lumo`). */
export const ROOT_FLAGS: Record<string, GrammarFlag> = {
  '--version': {
    long: '--version',
    short: '-V',
    value: 'none',
    enum: null,
    description: 'output the version number',
  },
}

// Minimal structural views of commander internals — intentionally not the
// commander types, so extraction works against both the CLI's pinned major
// and the repo root's copy (only stable public fields are touched).
interface OptionLike {
  flags: string
  short?: string
  long?: string
  required: boolean
  optional: boolean
  description?: string
}

interface ArgumentLike {
  required: boolean
  variadic: boolean
  name(): string
}

export interface CommandLike {
  name(): string
  description(): string
  commands: readonly CommandLike[]
  options: readonly OptionLike[]
  registeredArguments?: readonly ArgumentLike[]
}

/**
 * Parse an enum value set out of an option description following the CLI's
 * `a | b | c` help-text convention. Guarded against prose pipes: every
 * candidate must be a bare identifier token and the set must stay small.
 */
export function parseEnumFromDescription(description: string): string[] | null {
  const m = description.match(
    /([A-Za-z][A-Za-z0-9_-]*)(\s*\|\s*[A-Za-z][A-Za-z0-9_-]*)+/
  )
  if (!m) return null
  const values = m[0].split('|').map(v => v.trim())
  if (values.length < 2 || values.length > 10) return null
  if (new Set(values).size !== values.length) return null
  return values
}

function toGrammarFlag(opt: OptionLike): GrammarFlag {
  const description = opt.description ?? ''
  return {
    long: opt.long ?? opt.flags,
    short: opt.short ?? null,
    value: opt.required ? 'required' : opt.optional ? 'optional' : 'none',
    enum: parseEnumFromDescription(description),
    description,
  }
}

function toGrammarCommand(cmd: CommandLike): GrammarCommand {
  const flags: Record<string, GrammarFlag> = {}
  for (const opt of cmd.options) {
    const flag = toGrammarFlag(opt)
    flags[flag.long] = flag
  }
  return {
    arguments: (cmd.registeredArguments ?? []).map(a => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic,
    })),
    flags,
    hasSubcommands: cmd.commands.length > 0,
    description: cmd.description(),
  }
}

/**
 * Walk the registered commander tree into a flat path→node grammar.
 * Deterministic output: command and flag keys are sorted.
 */
export function extractGrammar(
  root: CommandLike,
  cliVersion: string
): CliGrammar {
  const commands: Record<string, GrammarCommand> = {}
  const visit = (cmd: CommandLike, path: string[]) => {
    for (const sub of cmd.commands) {
      // commander stores the name without arg placeholders; `.command('update
      // <id>')` yields name() === 'update'.
      const subPath = [...path, sub.name()]
      commands[subPath.join(' ')] = toGrammarCommand(sub)
      visit(sub, subPath)
    }
  }
  visit(root, [])

  const sorted: Record<string, GrammarCommand> = {}
  for (const key of Object.keys(commands).sort()) {
    const node = commands[key]!
    const sortedFlags: Record<string, GrammarFlag> = {}
    for (const fk of Object.keys(node.flags).sort()) {
      sortedFlags[fk] = node.flags[fk]!
    }
    sorted[key] = { ...node, flags: sortedFlags }
  }
  return { cliVersion, commands: sorted }
}
