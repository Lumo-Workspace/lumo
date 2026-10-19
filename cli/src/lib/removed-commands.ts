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
import { shellQuote } from './confirmation'

export interface Tombstone {
  /** The removed command path, e.g. `task context`. */
  path: string
  /**
   * LUM-1233 3a: a removed argument *shape* of a live command (the old
   * `milestone testcase show <milestone> <case>`): the tombstone applies only
   * when this returns true for the positionals. Absent = the path itself was
   * removed.
   */
  match?(args: string[], flags: string[]): boolean
  /** What the error says was removed (default: `lumo <path>`). */
  label?: string
  /** The replacement for the given positionals, flags and raw option tokens. */
  replacement(args: string[], flags: string[], options: string[]): string
  /** The command whose `--help` the hint names (default: first 3 words). */
  help?: string
  /** The live command whose option definitions say which flags take a
   *  value (default: `path`); used when `path` itself no longer exists. */
  optionsOf?: string
  /** Flags of the removed command that took a value (beyond `optionsOf`). */
  valueFlags?: readonly string[]
  /**
   * Flags of the removed shape that took NO value, even though a live
   * (global) flag of the same name does — 3g: `init --project` was a boolean,
   * the global `--project <ref>` would swallow the next word.
   */
  booleanFlags?: readonly string[]
}

/** `lumo task show <task> <flags…>` keeping the task ref when one was given. */
function showWith(...flags: string[]) {
  return (args: string[]) =>
    ['lumo task show', ...args.slice(0, 1), ...flags].join(' ')
}

/** The caller's option tokens without a retired `--yes` (3b: no alias). */
const noYes = (options: string[]) => options.filter(o => o !== '--yes')

/** LUM-1233 3b: one `memory` noun, the scope a flag. */
const MEMORY_TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'task memory add',
    optionsOf: 'memory add',
    replacement: (args, _f, options) =>
      cmd('lumo memory add', args[0] ? ['--task', args[0]] : [], options),
    help: 'lumo memory add',
  },
  {
    path: 'task memory list',
    optionsOf: 'memory list',
    replacement: (args, _f, options) =>
      cmd('lumo memory list', args[0] ? ['--task', args[0]] : [], options),
    help: 'lumo memory list',
  },
  {
    path: 'task memory',
    replacement: () => 'lumo memory list',
    help: 'lumo memory',
  },
  {
    path: 'project memory add',
    optionsOf: 'memory add',
    replacement: (args, _f, options) =>
      cmd(
        'lumo memory add --scope project',
        args[0] ? ['--project', args[0]] : [],
        options
      ),
    help: 'lumo memory add',
  },
  {
    path: 'project memory list',
    optionsOf: 'memory list',
    replacement: (args, _f, options) =>
      cmd(
        'lumo memory list --scope project',
        args[0] ? ['--project', args[0]] : [],
        options
      ),
    help: 'lumo memory list',
  },
  {
    path: 'project memory',
    replacement: () => 'lumo memory list --scope project',
    help: 'lumo memory',
  },
  {
    path: 'memory promote',
    replacement: args =>
      cmd(
        'lumo memory update',
        [args[0] ?? '<memory>', '--scope', 'project'],
        []
      ),
    help: 'lumo memory update',
  },
  {
    path: 'memory rm',
    optionsOf: 'memory delete',
    replacement: (args, _f, options) =>
      cmd('lumo memory delete', [args[0] ?? '<memory>'], noYes(options)),
    help: 'lumo memory delete',
  },
  {
    path: 'workspace learnings',
    optionsOf: 'memory list',
    replacement: (_a, _f, options) =>
      cmd('lumo memory list --learnings', [], options),
    help: 'lumo memory list',
  },
]

/** LUM-1233 3c: sharing and task binding are `doc update` fields. */
const DOC_TOMBSTONES: readonly Tombstone[] = [
  ...(
    [
      ['doc share', '--add-member'],
      ['doc unshare', '--remove-member'],
      ['doc bind', '--add-task'],
      ['doc unbind', '--remove-task'],
    ] as const
  ).map(
    ([path, flag]): Tombstone => ({
      path,
      optionsOf: 'doc update',
      replacement: (args, _f, options) =>
        cmd(
          'lumo doc update',
          [
            args[0] ?? '<doc>',
            flag,
            args[1] ?? (flag.endsWith('task') ? '<LUM-N>' : '<member>'),
          ],
          options
        ),
      help: 'lumo doc update',
    })
  ),
  {
    path: 'doc share-list',
    replacement: args =>
      cmd('lumo doc show', [args[0] ?? '<doc>', '--members'], []),
    help: 'lumo doc show',
  },
  {
    path: 'doc import-gdoc',
    optionsOf: 'doc import',
    replacement: (args, _f, options) =>
      cmd('lumo doc import', ['--gdoc', args[0] ?? '<url>'], options),
    help: 'lumo doc import',
  },
]

/**
 * LUM-1233 3d: `pr scan` became the read-only `pr show`; its write flags
 * moved to `pr review` (`--review full` → `--full`, `--review incremental`
 * → the default).
 */
export function prScanReplacement(args: string[], options: string[]): string {
  const n = args[0] ?? '<number>'
  /** `--flag=value` and `--flag value` both become [flag, value]. */
  const split = (o: string): [string, string | undefined] => {
    const eq = o.indexOf('=')
    return o.startsWith('--') && eq > 0
      ? [o.slice(0, eq), o.slice(eq + 1)]
      : [o, undefined]
  }
  const read: string[] = []
  const review: string[] = []
  let write = false
  for (let i = 0; i < options.length; i++) {
    const [flag, inline] = split(options[i]!)
    const value = (): string | undefined =>
      inline !== undefined
        ? inline
        : i + 1 < options.length
          ? options[++i]
          : undefined
    if (flag === '--review') {
      write = true
      if (value() === 'full') review.push('--full')
    } else if (flag === '--pause' || flag === '--resume') {
      write = true
      review.push(flag)
    } else if (flag === '--limit') {
      write = true
      const v = value()
      review.push('--limit', ...(v !== undefined ? [v] : []))
    } else if (flag === '--repo') {
      const v = value()
      const pair = ['--repo', ...(v !== undefined ? [v] : [])]
      read.push(...pair)
      review.push(...pair)
    } else read.push(options[i]!)
  }
  // A write keeps only the flags `pr review` takes (`--json`, `--all` … go).
  return write
    ? cmd('lumo pr review', [n], review)
    : cmd('lumo pr show', [n], read)
}

const PR_TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'pr scan',
    valueFlags: ['--review', '--limit', '--repo'],
    replacement: (args, _f, options) => prScanReplacement(args, options),
    help: 'lumo pr',
  },
]

/**
 * LUM-1233 3e (Q7): one `usage` noun. `cost` and `report` became
 * `usage show` (`report` = `usage show --tasks`); `usage resync` applies by
 * default, so the old opt-in `--apply` is gone (`--dry-run` previews).
 */
const USAGE_TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'cost',
    optionsOf: 'usage show',
    replacement: (_a, _f, options) => cmd('lumo usage show', [], options),
    help: 'lumo usage show',
  },
  {
    path: 'report',
    optionsOf: 'usage show',
    replacement: (_a, _f, options) =>
      cmd('lumo usage show --by member --tasks', [], options),
    help: 'lumo usage show',
  },
  {
    path: 'usage resync',
    match: (_args, flags) => flags.some(f => f === '--apply'),
    label: 'lumo usage resync --apply',
    replacement: (_a, _f, options) =>
      cmd(
        'lumo usage resync',
        [],
        options.filter(o => o !== '--apply')
      ),
    help: 'lumo usage resync',
  },
]

/** `next`'s options under `status --next` (`--count` became `--limit`). */
export function nextOptions(options: string[]): string[] {
  return options.map(o =>
    o === '--count'
      ? '--limit'
      : o.startsWith('--count=')
        ? `--limit=${o.slice(8)}`
        : o
  )
}

/**
 * LUM-1233 3f (Q1, Q2): one `status` summary for "me across the workspace";
 * `priority` becomes `priority create|list` with no interactive prompt.
 */
const STATUS_TOMBSTONES: readonly Tombstone[] = [
  ...(
    [
      ['inbox list', '--inbox'],
      ['inbox', '--inbox'],
      ['draft list', '--drafts'],
      ['draft', '--drafts'],
    ] as const
  ).map(
    ([path, flag]): Tombstone => ({
      path,
      optionsOf: 'status',
      replacement: (_a, _f, options) => cmd(`lumo status ${flag}`, [], options),
      help: 'lumo status',
    })
  ),
  {
    path: 'next',
    optionsOf: 'status',
    valueFlags: ['--count', '-n'],
    replacement: (_a, _f, options) =>
      cmd('lumo status --next', [], nextOptions(options)),
    help: 'lumo status',
  },
  {
    path: 'priority',
    // `priority create|list` are live; any other word was the old text form.
    match: args => args.length > 0 && !['create', 'list'].includes(args[0]!),
    label: 'lumo priority <text>',
    replacement: args => cmd('lumo priority create', [args.join(' ')], []),
    help: 'lumo priority create',
  },
]

/** `init` / `skill update` options with the old scope booleans as `--scope`. */
export function scopeOptions(options: string[]): string[] {
  return options.flatMap(o =>
    o === '--project'
      ? ['--scope', 'project']
      : o === '--user'
        ? ['--scope', 'user']
        : [o]
  )
}

/**
 * LUM-1233 3g (Q6, GF-1, GF-2): `--project <ref>` is one global flag, so the
 * scope booleans of `init` / `skill update` became `--scope user|project`;
 * the hidden `setup` alias and `task list -p` went.
 */
const PROJECT_TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'setup',
    optionsOf: 'init',
    booleanFlags: ['--project', '--user'],
    replacement: (_a, _f, options) =>
      cmd('lumo init', [], scopeOptions(options)),
    help: 'lumo init',
  },
  ...(['init', 'skill update'] as const).map(
    (path): Tombstone => ({
      path,
      match: (_a, flags) =>
        flags.some(f => f === '--project' || f === '--user'),
      label: `lumo ${path} --project / --user`,
      // The old booleans took no value: never let the global --project
      // swallow the next token here.
      booleanFlags: ['--project', '--user'],
      replacement: (args, _f, options) =>
        cmd(`lumo ${path}`, args, scopeOptions(options)),
      help: `lumo ${path}`,
    })
  ),
  {
    path: 'task list',
    match: (_a, flags) => flags.includes('-p'),
    label: 'lumo task list -p',
    valueFlags: ['-p'],
    replacement: (_a, _f, options) =>
      cmd(
        'lumo task list',
        [],
        options.map(o => (o === '-p' ? '--project' : o))
      ),
    help: 'lumo task list',
  },
]

/** The caller's options with `from` as `--confirm`, never twice. */
export function asConfirm(options: string[], from: string): string[] {
  const out = options.map(o => (o === from ? '--confirm' : o))
  return out.filter((o, i) => o !== '--confirm' || out.indexOf(o) === i)
}

/**
 * LUM-1233 3h + 3i (CF-1, CF-2): approval is `--confirm` only — the legacy
 * `--yes` alias went from every command that still had it — and `--force`
 * means only "discard local edits", so `doc rebuild-source --force` went
 * (`--confirm` alone approves replacing the source).
 */
const CONFIRM_TOMBSTONES: readonly Tombstone[] = [
  ...(
    [
      'doc delete',
      'milestone delete',
      'sprint close',
      'sprint delete',
      // task artifact rm / task deps rm / task template rm: renamed in 3j,
      // their tombstones below map --yes too.
      'worktree rm',
    ] as const
  ).map(
    (path): Tombstone => ({
      path,
      match: (_a, flags) => flags.includes('--yes'),
      label: `lumo ${path} --yes`,
      booleanFlags: ['--yes'],
      replacement: (args, _f, options) =>
        cmd(`lumo ${path}`, args, asConfirm(options, '--yes')),
      help: `lumo ${path}`,
    })
  ),
  {
    path: 'doc rebuild-source',
    match: (_a, flags) => flags.includes('--force'),
    label: 'lumo doc rebuild-source --force',
    booleanFlags: ['--force'],
    replacement: (args, _f, options) =>
      cmd('lumo doc rebuild-source', args, asConfirm(options, '--force')),
    help: 'lumo doc rebuild-source',
  },
]

/** Options that are not a security-scan setting (3j: show vs update). */
const SCAN_READ_FLAGS = new Set(['--json', '--repos', '--repo', '--confirm'])

/**
 * LUM-1233 3j (Q9): pure renames — `rm` → `delete`/`remove`, `edit` →
 * `update`, `comments` → `comment`, `deps` → `dep`, `overview` → `show`, and
 * the summary / changelog aspects. `--yes` (3i) maps to `--confirm` here too.
 */
const RENAME_TOMBSTONES: readonly Tombstone[] = [
  ...(
    [
      ['task artifact rm', 'lumo task artifact delete'],
      ['task template edit', 'lumo task template update'],
      ['task template rm', 'lumo task template delete'],
      ['task figma rm', 'lumo task figma remove'],
      ['task figma context', 'lumo task figma show'],
      ['project overview', 'lumo project show'],
      ['task deps add', 'lumo task dep add'],
      ['task deps confirm', 'lumo task dep confirm'],
      ['task deps dismiss', 'lumo task dep dismiss'],
      ['task deps rm', 'lumo task dep remove'],
      ['task deps', 'lumo task dep'],
      ['task comments', 'lumo task comment'],
    ] as const
  ).map(
    ([path, head]): Tombstone => ({
      path,
      optionsOf: head.slice('lumo '.length),
      booleanFlags: ['--yes'],
      replacement: (args, _f, options) =>
        cmd(head, args, asConfirm(options, '--yes')),
      help: head,
    })
  ),
  {
    path: 'task comments edit',
    optionsOf: 'task comment update',
    replacement: args =>
      cmd(
        'lumo task comment update',
        [args[1] ?? '<comment>', args[2] ?? '<body>'],
        args[0] ? ['--task', args[0]] : []
      ),
    help: 'lumo task comment update',
  },
  {
    path: 'task comments rm',
    optionsOf: 'task comment delete',
    booleanFlags: ['--yes'],
    replacement: (args, _f, options) =>
      cmd(
        'lumo task comment delete',
        [args[1] ?? '<comment>'],
        [
          ...(args[0] ? ['--task', args[0]] : []),
          ...asConfirm(options, '--yes'),
        ]
      ),
    help: 'lumo task comment delete',
  },
  {
    path: 'task comment',
    // `task comment add|update|delete` are live; `task comment <task> <body>` was the old form.
    match: args =>
      args.length > 0 && !['add', 'update', 'delete'].includes(args[0]!),
    label: 'lumo task comment <task> <body>',
    optionsOf: 'task comment add',
    replacement: (args, _f, options) =>
      cmd(
        'lumo task comment add',
        [args[1] ?? '<body>'],
        [...(args[0] ? ['--task', args[0]] : []), ...options]
      ),
    help: 'lumo task comment add',
  },
  ...(
    [
      ['milestone', '--project'],
      ['sprint', '--team'],
    ] as const
  ).map(
    ([noun]): Tombstone => ({
      path: `${noun} summary`,
      optionsOf: `${noun} show`,
      booleanFlags: ['--retry'],
      replacement: (args, flags, options) =>
        flags.includes('--retry')
          ? cmd(
              `lumo ${noun} update`,
              [args[0] ?? `<${noun}>`, '--refresh-summary'],
              options.filter(o => o !== '--retry')
            )
          : cmd(
              `lumo ${noun} show`,
              [args[0] ?? `<${noun}>`, '--summary'],
              options
            ),
      help: `lumo ${noun} show`,
    })
  ),
  {
    path: 'milestone changelog',
    optionsOf: 'milestone show',
    replacement: (args, _f, options) =>
      cmd(
        'lumo milestone show',
        [args[0] ?? '<milestone>', '--changelog'],
        options
      ),
    help: 'lumo milestone show',
  },
  {
    path: 'workspace security-scan',
    // `security-scan show|update` are live; flags right after the group were the old form.
    match: args => !['show', 'update'].includes(args[0] ?? ''),
    label: 'lumo workspace security-scan [--<setting> …]',
    optionsOf: 'workspace security-scan update',
    replacement: (_a, flags, options) => {
      const writes = flags.some(f => !SCAN_READ_FLAGS.has(f.split('=')[0]!))
      return cmd(
        `lumo workspace security-scan ${writes ? 'update' : 'show'}`,
        [],
        options
      )
    },
    help: 'lumo workspace security-scan',
  },
]

/**
 * LUM-1233 (2026-10-19): `task search` folded into `task list`. Search
 * spanned the whole workspace, so a call without `--assignee` gains
 * `--assignee any`; the query words become `--search`, `-p` (search's
 * priority short flag) becomes `--priority`, and `--exact` only survives
 * with a query (`task list` rejects it alone).
 */
export function taskSearchReplacement(
  args: string[],
  options: string[]
): string {
  const query = args.join(' ').trim()
  const flagOf = (o: string) => o.split('=')[0]!
  const rest: string[] = []
  for (const o of options) {
    if (o === '-p') rest.push('--priority')
    else if (o.startsWith('-p=')) rest.push(`--priority=${o.slice(3)}`)
    else if (flagOf(o) === '--exact' && !query) continue
    else rest.push(o)
  }
  const hasAssignee = options.some(
    o => flagOf(o) === '--assignee' || flagOf(o) === '-a'
  )
  return cmd(
    'lumo task list',
    [],
    [
      ...(hasAssignee ? [] : ['--assignee', 'any']),
      ...(query ? ['--search', query] : []),
      ...rest,
    ]
  )
}

const SEARCH_TOMBSTONES: readonly Tombstone[] = [
  {
    path: 'task search',
    optionsOf: 'task list',
    valueFlags: ['-p'],
    replacement: (args, _f, options) => taskSearchReplacement(args, options),
    help: 'lumo task list',
  },
]

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
  // LUM-1233 3a: `rm` → `delete`, and one `<parent>/TC<n>` handle.
  {
    path: 'task testcase rm',
    replacement: (args, _flags, options) =>
      cmd('lumo task testcase delete', [args[0] ?? '<task>/TC<n>'], options),
    help: 'lumo task testcase delete',
  },
  {
    path: 'milestone testcase rm',
    replacement: (args, _flags, options) =>
      cmd(
        'lumo milestone testcase delete',
        [
          args.length >= 2
            ? milestoneHandle(args)
            : (args[0] ?? '<milestone>/TC<n>'),
        ],
        options
      ),
    help: 'lumo milestone testcase delete',
  },
  ...(['show', 'update', 'run', 'disposition'] as const).map(
    (verb): Tombstone => ({
      path: `milestone testcase ${verb}`,
      match: args => args.length === 2,
      label: `lumo milestone testcase ${verb} <milestone> <case>`,
      replacement: (args, _flags, options) =>
        cmd(
          `lumo milestone testcase ${verb}`,
          [milestoneHandle(args)],
          options
        ),
      help: `lumo milestone testcase ${verb}`,
    })
  ),
  {
    path: 'milestone testcase download',
    match: args => args.length === 3,
    label: 'lumo milestone testcase download <milestone> <case> <dir>',
    replacement: (args, _flags, options) =>
      cmd(
        'lumo milestone testcase download',
        [milestoneHandle(args), args[2]!],
        options
      ),
    help: 'lumo milestone testcase download',
  },
  ...MEMORY_TOMBSTONES,
  ...DOC_TOMBSTONES,
  ...PR_TOMBSTONES,
  ...USAGE_TOMBSTONES,
  ...STATUS_TOMBSTONES,
  ...PROJECT_TOMBSTONES,
  ...CONFIRM_TOMBSTONES,
  ...RENAME_TOMBSTONES,
  ...SEARCH_TOMBSTONES,
]

/** `<milestone> TC3` / `<milestone> 3` → `<milestone>/TC3`. */
function milestoneHandle(args: string[]): string {
  const n = (args[1] ?? '').replace(/^TC/i, '')
  return `${args[0]}/TC${n}`
}

/** A command line: head, positionals, then the caller's option tokens. */
function cmd(head: string, args: string[], options: string[]): string {
  return [head, ...args.map(shellQuote), ...options.map(shellQuote)].join(' ')
}

/** Options that take a value when no command definition says otherwise. */
const VALUE_OPTIONS = new Set(['--limit', '-n', '--cursor', '--project'])

/** Whether `flag` takes a value on the command at `path` (from Commander). */
export type TakesValue = (path: string, flag: string) => boolean

export interface RemovedHit {
  path: string
  label: string
  replacement: string
  help: string
}

/**
 * The tombstone `argv` (without `node lumo`) names, or null. Leading global
 * options (`--json`, `--no-hints`) are skipped; the longest matching path wins.
 */
export function findRemovedCommand(
  argv: string[],
  takesValue: TakesValue = (_path, flag) => VALUE_OPTIONS.has(flag)
): RemovedHit | null {
  let start = 0
  // Leading global options, with their values (`lumo --project app task …`).
  while (start < argv.length && argv[start]!.startsWith('-')) {
    const flag = argv[start++]!
    if (!flag.includes('=') && takesValue('', flag)) start++
  }
  const rest = argv.slice(start)
  const words: string[] = []
  for (const tok of rest) {
    if (tok.startsWith('-')) break
    words.push(tok)
  }
  const candidates = TOMBSTONES.filter(t => {
    const parts = t.path.split(' ')
    return parts.every((p, i) => words[i] === p)
  }).sort((a, b) => b.path.length - a.path.length)
  for (const hit of candidates) {
    const depth = hit.path.split(' ').length
    const args: string[] = []
    const flags: string[] = []
    const options: string[] = []
    const after = rest.slice(depth)
    for (let i = 0; i < after.length; i++) {
      const tok = after[i]!
      if (tok.startsWith('-')) {
        flags.push(tok)
        options.push(tok)
        if (
          !tok.includes('=') &&
          !hit.booleanFlags?.includes(tok) &&
          (hit.valueFlags?.includes(tok) ||
            takesValue(hit.optionsOf ?? hit.path, tok))
        ) {
          i++
          if (i < after.length) options.push(after[i]!)
        }
      } else args.push(tok)
    }
    if (hit.match && !hit.match(args, flags)) continue
    const replacement = hit.replacement(args, flags, options)
    return {
      path: hit.path,
      label: hit.label ?? `lumo ${hit.path}`,
      replacement,
      help: hit.help ?? replacement.split(' ').slice(0, 3).join(' '),
    }
  }
  return null
}

/** The stderr lines for a removed command. */
export function removedCommandLines(hit: RemovedHit): string[] {
  return [
    `Error: ${hit.label} was removed. Use: ${hit.replacement}`,
    `Hint: see \`${hit.help} --help\`.`,
  ]
}
