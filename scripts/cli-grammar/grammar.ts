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
 *
 * LUM-420 adjudication: a pipe list preceded by `e.g.` is an OPEN example
 * list (--source/--kind are opaque free text) and yields no enum; the
 * `case-insensitive` help marker mirrors the CLI runtime's normalize-before-
 * validate behavior into the grammar so the validator can fold case the same
 * way the CLI does.
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
  /**
   * True when the help text carries the `case-insensitive` marker: the CLI
   * runtime normalizes the value before validating (toUpperCase/toLowerCase
   * plus `-`/`_` unification), so enum matching must fold the same way.
   */
  enumCaseInsensitive: boolean
  description: string
}

/**
 * LUM-1233 batch 4 (CX-1): a command's Codex sandbox class, declared with
 * `.codex()` where the command is defined (cli/src/lib/command-class.ts).
 * Structural copy so the grammar tooling does not import the CLI's types.
 */
export type GrammarCodexClass =
  | { serverOnly: true; localFiles: 'none' }
  | {
      serverOnly: false
      localFiles: 'none' | 'reads' | 'writes'
      detail: string
    }

export interface GrammarCommand {
  /** Positional arguments declared on the command. */
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>
  /** Flags by long form (plus short aliases resolvable via `short`). */
  flags: Record<string, GrammarFlag>
  /** True when this node has subcommands hanging off it. */
  hasSubcommands: boolean
  /**
   * True when the node carries its own commander action handler, i.e. it is
   * callable on its own. Orthogonal to `hasSubcommands`: commander allows a
   * parent to hold both (`lumo plan` starts a run, `lumo plan status` reports
   * on it), so "has subcommands" alone never means "needs a subcommand"
   * (LUM-706 — reading it that way made every parent-with-action's primary
   * usage unrepresentable in the docs).
   */
  isInvokable: boolean
  description: string
  /**
   * LUM-1233 batch 4: the Codex class declared on this node; a class on a
   * group covers every command below it. Absent when an ancestor declares it.
   */
  codex?: GrammarCodexClass
}

export interface CliGrammar {
  /** cli/package.json version the snapshot was generated from. */
  cliVersion: string
  /**
   * LUM-1233 3g (GF-1): flags defined once on the program and accepted by
   * every command (`--project <ref>`, `--no-hints`). Absent on older snapshots.
   */
  globalFlags?: Record<string, GrammarFlag>
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
    enumCaseInsensitive: false,
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
    enumCaseInsensitive: false,
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
  /** `hideHelp()`: a removed flag kept only to print a migration error. */
  hidden?: boolean
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
  /**
   * Commander's private action slot: a function once `.action()` was called,
   * `null` otherwise. There is no public accessor, and the distinction is not
   * derivable from anything public — a parent with an action and one without
   * look identical through `commands`/`options`/`registeredArguments`.
   */
  _actionHandler?: unknown
  /** LUM-1233 batch 4: set by `LumoCommand.codex()`. */
  codexClass?: GrammarCodexClass | undefined
}

/**
 * Parse an enum value set out of an option description following the CLI's
 * `a | b | c` help-text convention. Guarded against prose pipes: every
 * candidate must be a bare identifier token and the set must stay small
 * (at most 16 — the audit log's --target-type list, LUM-907).
 *
 * A pipe list preceded by `e.g.` is an open example list, not a closed enum
 * (LUM-420: `--source … e.g. Superpowers | "Spec Kit" | BMad …` is opaque
 * free text — 135 real `--source Superpowers` calls were misflagged because
 * the quoted token broke the match and `BMad | OpenSpec | GSD` re-matched as
 * a closed set).
 */
export function parseEnumFromDescription(description: string): string[] | null {
  const m = description.match(
    /([A-Za-z][A-Za-z0-9_-]*)(\s*\|\s*[A-Za-z][A-Za-z0-9_-]*)+/
  )
  if (!m) return null
  if (/\be\.g\./.test(description.slice(0, m.index))) return null
  const values = m[0].split('|').map(v => v.trim())
  if (values.length < 2 || values.length > 16) return null
  if (new Set(values).size !== values.length) return null
  return values
}

/**
 * Whether the help text declares the flag's value matching case-insensitive.
 * Only meaningful alongside a parsed enum.
 */
export function parseCaseInsensitiveMarker(description: string): boolean {
  return /case-insensitive/i.test(description)
}

function toGrammarFlag(opt: OptionLike): GrammarFlag {
  const description = opt.description ?? ''
  const parsedEnum = parseEnumFromDescription(description)
  return {
    long: opt.long ?? opt.flags,
    short: opt.short ?? null,
    value: opt.required ? 'required' : opt.optional ? 'optional' : 'none',
    enum: parsedEnum,
    enumCaseInsensitive:
      parsedEnum !== null && parseCaseInsensitiveMarker(description),
    description,
  }
}

function toGrammarCommand(cmd: CommandLike): GrammarCommand {
  const flags: Record<string, GrammarFlag> = {}
  for (const opt of cmd.options) {
    if (opt.hidden) continue
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
    isInvokable: typeof cmd._actionHandler === 'function',
    description: cmd.description(),
    ...(cmd.codexClass ? { codex: cmd.codexClass } : {}),
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
  // LUM-1233 batch 4: every leaf needs a Codex class (its own or a group's),
  // and a class is declared once on a path — never again below it.
  const unclassified: string[] = []
  const doubled: string[] = []
  const visit = (cmd: CommandLike, path: string[], covered: boolean) => {
    for (const sub of cmd.commands) {
      // commander stores the name without arg placeholders; `.command('update
      // <id>')` yields name() === 'update'.
      const subPath = [...path, sub.name()]
      const key = subPath.join(' ')
      commands[key] = toGrammarCommand(sub)
      if (sub.codexClass && covered) doubled.push(key)
      const nowCovered = covered || sub.codexClass !== undefined
      if (sub.commands.length === 0 && !nowCovered) unclassified.push(key)
      visit(sub, subPath, nowCovered)
    }
  }
  visit(root, [], false)
  if (unclassified.length > 0 || doubled.length > 0) {
    throw new Error(
      [
        ...(unclassified.length > 0
          ? [
              `Commands without a Codex class — add .codex(SERVER_ONLY | readsLocalFile(flag) | writesLocal(what) | sandboxed(why)) where each is defined (cli/src/lib/command-class.ts): ${unclassified.join(', ')}`,
            ]
          : []),
        ...(doubled.length > 0
          ? [
              `Codex class declared again below a group that already has one: ${doubled.join(', ')}`,
            ]
          : []),
      ].join('\n')
    )
  }

  const sorted: Record<string, GrammarCommand> = {}
  for (const key of Object.keys(commands).sort()) {
    const node = commands[key]!
    const sortedFlags: Record<string, GrammarFlag> = {}
    for (const fk of Object.keys(node.flags).sort()) {
      sortedFlags[fk] = node.flags[fk]!
    }
    sorted[key] = { ...node, flags: sortedFlags }
  }
  // The program's own options are the global flags (minus --version, which is
  // ROOT_FLAGS, and hidden ones).
  const globalFlags: Record<string, GrammarFlag> = {}
  for (const opt of [...root.options].sort((a, b) =>
    (a.long ?? a.flags).localeCompare(b.long ?? b.flags)
  )) {
    if (opt.hidden || opt.long === '--version') continue
    const flag = toGrammarFlag(opt)
    globalFlags[flag.long] = flag
  }
  return { cliVersion, globalFlags, commands: sorted }
}

/** Where emit-grammar writes the Codex classes the CLI reads at run time. */
export const CODEX_CLASSES_FILE = 'cli/src/lib/codex-classes.generated.ts'

/**
 * LUM-1233 batch 4: the TypeScript module the CLI's Codex rules are built
 * from — every node with a declared class, sorted by path. The CLI package
 * does not ship grammar.json, so the classes travel as source. Unformatted;
 * emit-grammar runs it through prettier.
 */
export function codexClassesSource(grammar: CliGrammar): string {
  const entries = Object.entries(grammar.commands)
    .filter(([, n]) => n.codex !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, n]) => `${JSON.stringify(p)}: ${JSON.stringify(n.codex)},`)
  return [
    '// Generated by scripts/cli-grammar/emit-grammar.ts from the `.codex()`',
    '// classes declared in cli/src/index.ts (LUM-1233 batch 4). Do not edit;',
    '// change the declaration and re-run emit-grammar.',
    "import type { CodexClass } from './command-class'",
    '',
    'export const CODEX_CLASSES: Readonly<Record<string, CodexClass>> = {',
    ...entries,
    '}',
    '',
  ].join('\n')
}
