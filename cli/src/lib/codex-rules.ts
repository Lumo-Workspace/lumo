import * as fs from 'fs'
import * as path from 'path'
import { hint } from './feedback'

/**
 * LUM-1054: Codex's default `workspace-write` sandbox has no network, so every
 * `lumo` command in a Codex shell failed with `could not reach Lumo API …
 * (fetch failed)` (hooks were unaffected: they run outside the sandbox).
 *
 * Instead of turning on network for every sandboxed command
 * (`[sandbox_workspace_write] network_access = true`), `lumo init` writes a
 * Codex rules file whose `prefix_rule`s let the **server-only** `lumo`
 * commands run outside the sandbox without prompting: the ones that only talk
 * to the Lumo API (reading only Lumo's own config/credentials, read-only git)
 * and never read an arbitrary local file to upload, write local files or start
 * local processes with side effects. Every other `lumo` command — init/uninstall/update, auth,
 * worktrees, memory sync/push, hooks, `session attach` (can create a
 * worktree), `task update` (a confirmed DONE removes worktrees) — and every
 * non-lumo command stays sandboxed, so Codex asks (or the command fails) as
 * usual. Codex loads `<layer>/rules/*.rules` at startup — the user layer
 * `~/.codex/rules/` always, a project's `<repo>/.codex/rules/` only once that
 * project is trusted.
 *
 * Every leaf of the commander tree must be classified in exactly one of the
 * two lists below (__tests__/cli/codex-sandbox-network.test.ts walks
 * scripts/cli-grammar/grammar.json), so a new command forces a
 * conscious ALLOW/DENY decision.
 *
 * The file is wholly Lumo's: the first line marks it, init rewrites it only
 * when the content differs, and uninstall deletes it.
 */

export const CODEX_RULES_MARKER =
  '# Managed by `lumo init` (LUM-1054). Remove with `lumo uninstall`.'

/**
 * Server-only commands (grammar.json paths): run outside Codex's sandbox
 * without prompting. None of them takes a flag or argument that reads a local
 * file (those are in {@link CODEX_FILE_READING_COMMANDS}). A path covers everything after it (`priority` also
 * covers `priority list`), so never list a path that has a sandboxed command
 * below it.
 */
export const CODEX_SERVER_ONLY_COMMANDS: readonly string[] = [
  'audit list',
  'crossing list',
  'doc delete',
  'doc import',
  'doc list',
  'doc move',
  'doc rebuild-source',
  'doc show',
  'doc sync',
  'member list',
  'memory fold',
  'memory add',
  'memory delete',
  'memory list',
  'memory show',
  'memory update',
  'milestone add',
  'milestone archive',
  'milestone changelog',
  'milestone create',
  'milestone delete',
  'milestone list',
  'milestone move',
  'milestone remove',
  'milestone reorder',
  'milestone show',
  'milestone summary',
  'milestone testcase add',
  'milestone testcase delete',
  'milestone testcase list',
  'milestone testcase show',
  'milestone testcase update',
  'milestone triage',
  'milestone unarchive',
  'milestone update',
  'pr review',
  'pr show',
  'priority',
  'project create',
  'project list',
  'project overview',
  'project update',
  'session status',
  'sprint add',
  'sprint close',
  'sprint create',
  'sprint delete',
  'sprint list',
  'sprint remove',
  'sprint show',
  'sprint start',
  'sprint summary',
  'sprint update',
  // me across the workspace: priority, inbox, drafts, next (read-only)
  'status',
  'tag create',
  'tag list',
  'task artifact list',
  'task artifact rm',
  'task artifact show',
  'task artifact update',
  'task comment',
  'task comments edit',
  'task comments rm',
  'task create',
  'task decide',
  'task delete',
  'task deps add',
  'task deps confirm',
  'task deps dismiss',
  'task deps rm',
  'task figma add',
  'task figma context',
  'task figma list',
  'task figma refresh',
  'task figma rm',
  'task list',
  'task pr show',
  'task search',
  'task show',
  'task slack show',
  // assesses local worktrees read-only for DONE readiness (never removes them)
  'task status',
  'task statuses',
  'task template list',
  'task template rm',
  'task template show',
  'task testcase add',
  'task testcase delete',
  'task testcase list',
  'task testcase show',
  'task testcase update',
  'task web show',
  'usage show',
  'workspace security-scan',
]

/**
 * Server-only commands that can read an arbitrary local file and send it to
 * the Lumo API (the flag that does it). A prefix rule cannot exclude a flag,
 * so the whole command stays sandboxed: Codex asks first, and no prompt-
 * injected `lumo doc create --file ~/.ssh/id_rsa` runs unseen.
 */
export const CODEX_FILE_READING_COMMANDS: Readonly<Record<string, string>> = {
  'crossing explain': '--file <json>',
  'doc append': '--file',
  'doc create': '--file',
  'doc diff': '--file',
  'doc patch': '--file',
  'doc update': '--file',
  'milestone testcase run': '--evidence-file, --step-evidence <step>=<file>',
  'task artifact add': '--file',
  'task template create': '--file',
  'task template edit': '--file',
  'task testcase run': '--evidence-file, --step-evidence <step>=<file>',
  'usage resync':
    'reads local Claude Code transcripts ($CLAUDE_CONFIG_DIR or ~/.claude/projects)',
}

/** The reason recorded for every {@link CODEX_FILE_READING_COMMANDS} entry. */
export const FILE_READING_REASON =
  'reads local files (--file …) — Codex asks first'

/**
 * Commands that stay inside Codex's sandbox (Codex asks before running them
 * outside it), with the reason. A path covers everything below it.
 */
export const CODEX_SANDBOXED_COMMANDS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(CODEX_FILE_READING_COMMANDS).map(([cmd, flag]) => [
      cmd,
      `${FILE_READING_REASON} (${flag})`,
    ])
  ),
  'auth login': 'writes ~/.lumo credentials and opens a browser',
  'auth logout': 'deletes ~/.lumo credentials',
  'crossing disposition':
    'a human-only ruling: keep Codex asking the user first',
  doctor: 'local-only diagnosis, no Lumo API call (runs fine sandboxed)',
  'finding disposition':
    'a human-only ruling: keep Codex asking the user first',
  hook: 'agent hooks write local logs/memory; Codex runs its hooks outside the sandbox itself',
  init: 'writes skill, hook and rules files',
  setup: 'alias of init: writes skill, hook and rules files',
  'skill status':
    'local-only (reads skill dirs and git, no Lumo API call; runs fine sandboxed)',
  'skill update': 'writes skill files',
  'memory push': 'deletes local memory files after pushing',
  'milestone testcase disposition':
    'a human-only ruling: keep Codex asking the user first',
  'milestone testcase download':
    'writes local files (saves evidence into <dir>) — Codex asks first',
  'memory sync': 'writes the local memory directory',
  'session attach':
    'can create a git worktree (--worktree / autoWorktree) and sync local memory',
  'task testcase disposition':
    'a human-only ruling: keep Codex asking the user first',
  'task testcase download':
    'writes local files (saves evidence into <dir>) — Codex asks first',
  'task update': 'a confirmed DONE removes local git worktrees',
  uninstall: 'deletes skill, hook and rules files',
  update: 'runs npm install -g',
  whoami:
    'local-only (reads credentials, no Lumo API call; runs fine sandboxed)',
  worktree: 'creates/removes git worktrees and branches (list: local git only)',
}

const RULE_INDENT = '    '

function quote(s: string): string {
  return JSON.stringify(s)
}

function tokens(commandPath: string): string[] {
  return commandPath.split(' ').filter(Boolean)
}

function startsWith(argv: readonly string[], prefix: readonly string[]) {
  return prefix.length <= argv.length && prefix.every((t, i) => argv[i] === t)
}

/**
 * Build the rules file: one `prefix_rule` per parent command, the allowed
 * children as a list of alternatives (`["lumo", "task", ["show", "list"]]`).
 * `match` examples are the allowed commands; `not_match` the sandboxed
 * siblings — Codex validates both when it loads the file.
 */
export function buildCodexRules(
  allowed: readonly string[] = CODEX_SERVER_ONLY_COMMANDS,
  sandboxed: Readonly<Record<string, string>> = CODEX_SANDBOXED_COMMANDS
): string {
  const paths = allowed.map(tokens)
  // A path already covered by a shorter allowed path adds nothing.
  const effective = paths.filter(
    p => !paths.some(q => q.length < p.length && startsWith(p, q))
  )
  const groups = new Map<string, { parent: string[]; leaves: string[] }>()
  for (const p of effective) {
    const parent = p.slice(0, -1)
    const key = parent.join(' ')
    const g = groups.get(key) ?? { parent, leaves: [] }
    g.leaves.push(p[p.length - 1]!)
    groups.set(key, g)
  }
  const ordered = [...groups.values()].sort((a, b) =>
    a.parent.join(' ').localeCompare(b.parent.join(' '))
  )
  // Each sandboxed command is a not_match example of the rule for its nearest
  // parent (its siblings' rule), else of the top-level rule.
  const notMatch = new Map<string, string[]>()
  const top = ''
  for (const path of Object.keys(sandboxed)) {
    const t = tokens(path)
    let best = top
    for (const g of ordered) {
      const key = g.parent.join(' ')
      if (
        g.parent.length > 0 &&
        startsWith(t, g.parent) &&
        key.length > best.length
      )
        best = key
    }
    const list = notMatch.get(best) ?? []
    list.push(`lumo ${path}`)
    notMatch.set(best, list)
  }
  const topList = notMatch.get(top) ?? []
  topList.push(
    'lumo uninstall --confirm',
    'lumo worktree add LUM-1',
    'lumox status'
  )
  notMatch.set(top, topList)

  const lines: string[] = [
    CODEX_RULES_MARKER,
    '# Lets the server-only `lumo` commands (they only call the Lumo API, read no',
    "# local file to upload and write none) run outside Codex's no-network sandbox",
    '# without prompting. Every other command, including `lumo init`, `lumo update`,',
    '# `lumo uninstall`, `lumo auth`, `lumo worktree`, `lumo memory sync/push`,',
    '# `lumo session attach`, `lumo task update` and the commands that take a',
    '# `--file` (`lumo doc create/update/patch …`), stays sandboxed, so Codex asks.',
  ]
  for (const g of ordered) {
    const leaves = [...g.leaves].sort()
    const last =
      leaves.length === 1
        ? quote(leaves[0]!)
        : `[${leaves.map(quote).join(', ')}]`
    const pattern = ['lumo', ...g.parent].map(quote).concat(last).join(', ')
    const match = leaves.map(l => quote(['lumo', ...g.parent, l].join(' ')))
    const nm = [...new Set(notMatch.get(g.parent.join(' ')) ?? [])].sort()
    lines.push('prefix_rule(')
    lines.push(`${RULE_INDENT}pattern = [${pattern}],`)
    lines.push(`${RULE_INDENT}decision = "allow",`)
    lines.push(
      `${RULE_INDENT}justification = "Server-only Lumo command: needs network to reach the Lumo API, reads no local file to upload, writes none",`
    )
    lines.push(`${RULE_INDENT}match = [${match.join(', ')}],`)
    if (nm.length > 0)
      lines.push(`${RULE_INDENT}not_match = [${nm.map(quote).join(', ')}],`)
    lines.push(')')
  }
  return `${lines.join('\n')}\n`
}

export const LUMO_CODEX_RULES = buildCodexRules()

/**
 * Whether Lumo's Codex rules let `lumo <args…>` run outside the sandbox —
 * the same positional prefix match Codex applies (`args` excludes `lumo`).
 */
export function isCodexServerOnly(args: readonly string[]): boolean {
  return CODEX_SERVER_ONLY_COMMANDS.some(p => startsWith(args, tokens(p)))
}

/** The longest classified command path `args` starts with, if any. */
export function codexCommandPath(args: readonly string[]): string | null {
  let best: string | null = null
  for (const p of [
    ...CODEX_SERVER_ONLY_COMMANDS,
    ...Object.keys(CODEX_SANDBOXED_COMMANDS),
  ]) {
    if (
      startsWith(args, tokens(p)) &&
      (best === null || p.length > best.length)
    )
      best = p
  }
  return best
}

/** `<root>/.codex/rules/lumo.rules` — user layer (root = ~) or project layer. */
export function codexRulesPath(root: string): string {
  return path.join(root, '.codex', 'rules', 'lumo.rules')
}

/** The rules file next to a Codex hooks file (`<dir>/.codex/hooks.json`). */
export function codexRulesPathForHooks(hooksPath: string): string {
  return path.join(path.dirname(hooksPath), 'rules', 'lumo.rules')
}

export type CodexRulesState = 'missing' | 'current' | 'outdated' | 'foreign'

/**
 * - `missing`: no file;
 * - `current`: exactly what this CLI writes;
 * - `outdated`: carries the Lumo marker but differs (an older Lumo, or edited);
 * - `foreign`: a `lumo.rules` without the marker — the user's own, never touched.
 */
export function classifyCodexRules(file: string): CodexRulesState {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return 'missing'
  }
  if (text === LUMO_CODEX_RULES) return 'current'
  return text.startsWith(CODEX_RULES_MARKER) ? 'outdated' : 'foreign'
}

export type CodexRulesInstallResult =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'skipped-foreign'

/**
 * Write the Lumo rules file. A current file is left byte-identical; a foreign
 * file (no Lumo marker) is overwritten only with `force`.
 */
export function installCodexRules(
  file: string,
  force = false
): CodexRulesInstallResult {
  const state = classifyCodexRules(file)
  if (state === 'current') return 'unchanged'
  if (state === 'foreign' && !force) return 'skipped-foreign'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, LUMO_CODEX_RULES)
  return state === 'missing' ? 'created' : 'updated'
}

/**
 * Whether a Codex `config.toml` turns on network for the workspace-write
 * sandbox (`[sandbox_workspace_write]` → `network_access = true`). Plain text
 * scan — no TOML parser; a dotted `sandbox_workspace_write.network_access =
 * true` at top level counts too.
 */
export function configTomlAllowsNetwork(toml: string): boolean {
  let section: string | null = null
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (line === '') continue
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(line)
    if (header) {
      section = header[1]!
      continue
    }
    if (
      section === 'sandbox_workspace_write' &&
      /^network_access\s*=\s*true$/.test(line)
    )
      return true
    if (
      section === null &&
      /^sandbox_workspace_write\.network_access\s*=\s*true$/.test(line)
    )
      return true
  }
  return false
}

/** How `lumo` commands in this Codex layer reach the network, if at all. */
export type CodexNetworkState = 'rules' | 'config' | 'off'

/**
 * The network state for a Codex hooks file's layer: the Lumo rules file next
 * to it or in the user layer (`~/.codex/rules/`, which Codex always loads —
 * also for a project), else `network_access = true` in that layer's or the
 * user's config.toml, else off.
 */
export function codexNetworkState(
  hooksPath: string,
  homeDir: string
): CodexNetworkState {
  for (const file of new Set([
    codexRulesPathForHooks(hooksPath),
    codexRulesPath(homeDir),
  ])) {
    const rules = classifyCodexRules(file)
    if (rules === 'current' || rules === 'outdated') return 'rules'
  }
  const tomls = new Set([
    path.join(path.dirname(hooksPath), 'config.toml'),
    path.join(homeDir, '.codex', 'config.toml'),
  ])
  for (const t of tomls) {
    try {
      if (configTomlAllowsNetwork(fs.readFileSync(t, 'utf8'))) return 'config'
    } catch {
      // no config.toml in this layer
    }
  }
  return 'off'
}

/** Printed by init after writing the rules file. */
export function codexRulesNote(
  file: string,
  scope: 'user' | 'project'
): string {
  return (
    `ℹ Server-only \`lumo\` commands (they only call the Lumo API) now run outside Codex's sandbox without a prompt; Codex still asks before any other lumo command (init, update, auth, worktree, memory sync/push, session attach, task update, and the ones that read a local file such as doc create/update/patch --file) and everything else stays sandboxed without network.\n` +
    `  Restart Codex to load ${file}.` +
    (scope === 'project'
      ? ' Codex loads a project rules file only once you trust the project.'
      : '')
  )
}

/**
 * Appended once to a failing server-only command run inside Codex's sandbox
 * (`CODEX_SANDBOX` set) when it could not reach the Lumo API: the rule is
 * missing or not loaded.
 */
export const CODEX_SANDBOX_NETWORK_HINT = hint(
  "this ran inside Codex's sandbox, which has no network by default, so lumo could not reach the Lumo API. " +
    'Fix: run `lumo init` (or `lumo init --agent codex`) to add the Codex rule that runs server-only `lumo` commands outside the sandbox (.codex/rules/lumo.rules), then restart Codex — a project rules file loads only in a trusted project. ' +
    'Run lumo as its own command with flags after the subcommand: piped or redirected (`lumo … | head`), or `lumo --no-hints task …`, it stays sandboxed. ' +
    'Alternatively allow network for every sandboxed command: add `[sandbox_workspace_write]` with `network_access = true` to ~/.codex/config.toml.'
)

/**
 * Appended instead when the failing command is one Lumo's rule leaves
 * sandboxed on purpose (it writes local files or runs local processes).
 */
export function codexSandboxedCommandHint(commandPath: string): string {
  return hint(
    `this ran inside Codex's sandbox, which has no network by default. \`lumo ${commandPath}\` reads or changes local files or runs local processes, so Lumo's Codex rule leaves it sandboxed on purpose (only server-only lumo commands run outside it without asking). ` +
      "Re-run it with Codex's approval to run outside the sandbox, or ask the user to run it in their own terminal."
  )
}
