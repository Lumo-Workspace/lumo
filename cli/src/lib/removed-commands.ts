/**
 * LUM-1233 — tombstones for removed commands (docs/cli-command-structure.md
 * RN-3, decision Q4). A removed name is NOT an alias: it never runs. It fails
 * with exit 2 and one line naming its replacement, so an agent reading an
 * older SKILL.md (skill copies lag the CLI) finds the new name without a
 * `--help` round trip.
 *
 * Tombstones are never registered with Commander, so they stay out of
 * `--help` and `grammar.json`. Drop an entry two minor releases after its
 * removal.
 */

export interface Tombstone {
  /** The removed command path, e.g. `task context`. */
  path: string
  /** The replacement command for the given positionals and flags. */
  replacement(args: string[], flags: string[]): string
}

/** `lumo task show <task> <flags…>` keeping the task ref when one was given. */
function showWith(...flags: string[]) {
  return (args: string[]) =>
    ['lumo task show', ...args.slice(0, 1), ...flags].join(' ')
}

export const TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'task context',
    replacement: (args, flags) =>
      showWith(
        '--full',
        ...(flags.includes('--full') ? ['--memory'] : [])
      )(args),
  },
  {
    path: 'task wrapup',
    replacement: args => ['lumo task status', ...args.slice(0, 1)].join(' '),
  },
  { path: 'task comments list', replacement: showWith('--comments') },
  { path: 'task history', replacement: showWith('--history') },
  { path: 'task scans', replacement: showWith('--scans') },
  { path: 'task runs', replacement: showWith('--runs') },
  { path: 'task lineage', replacement: showWith('--lineage') },
  { path: 'task deps list', replacement: showWith('--deps') },
  { path: 'outcome show', replacement: showWith('--outcome') },
  { path: 'outcome', replacement: showWith('--outcome') },
]

/** Options that take a value (their value is not a positional). */
const VALUE_OPTIONS = new Set(['--limit', '-n', '--cursor', '--project'])

export interface RemovedHit {
  path: string
  replacement: string
}

/**
 * The tombstone `argv` (without `node lumo`) names, or null. Leading global
 * options (`--json`, `--no-hints`) are skipped; the longest matching path wins.
 */
export function findRemovedCommand(argv: string[]): RemovedHit | null {
  let start = 0
  while (start < argv.length && argv[start]!.startsWith('-')) start++
  const rest = argv.slice(start)
  const words: string[] = []
  for (const tok of rest) {
    if (tok.startsWith('-')) break
    words.push(tok)
  }
  const matches = TOMBSTONES.filter(t => {
    const parts = t.path.split(' ')
    return parts.every((p, i) => words[i] === p)
  }).sort((a, b) => b.path.length - a.path.length)
  const hit = matches[0]
  if (!hit) return null
  const depth = hit.path.split(' ').length
  const args: string[] = []
  const flags: string[] = []
  const after = rest.slice(depth)
  for (let i = 0; i < after.length; i++) {
    const tok = after[i]!
    if (tok.startsWith('-')) {
      flags.push(tok)
      if (VALUE_OPTIONS.has(tok)) i++
    } else args.push(tok)
  }
  return { path: hit.path, replacement: hit.replacement(args, flags) }
}

/** The stderr lines for a removed command. */
export function removedCommandLines(hit: RemovedHit): string[] {
  return [
    `Error: lumo ${hit.path} was removed. Use: ${hit.replacement}`,
    `Hint: see \`${hit.replacement.split(' ').slice(0, 3).join(' ')} --help\`.`,
  ]
}
