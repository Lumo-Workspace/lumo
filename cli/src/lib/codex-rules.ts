import * as fs from 'fs'
import * as path from 'path'
import { hint } from './feedback'
import { CODEX_CLASSES } from './codex-classes.generated'

/**
 * LUM-1054: Codex's default `workspace-write` sandbox has no network, so every
 * `lumo` command in a Codex shell failed with `could not reach Lumo API …
 * (fetch failed)` (hooks were unaffected: they run outside the sandbox).
 *
 * Instead of turning on network for every sandboxed command
 * (`[sandbox_workspace_write] network_access = true`), `lumo init` writes a
 * Codex rules file that allows every `lumo` command outside the sandbox
 * (LUM-1292) and adds a `prompt` rule for each command that is not
 * server-only: it reads a local file to upload, writes local files or starts
 * local processes (init/uninstall/update, auth, worktrees, memory sync/push,
 * hooks, `session attach`, `task update`, `doc create --file` …). Codex takes
 * the strictest matching decision, so those still ask. Codex loads
 * `<layer>/rules/*.rules` at startup — the user layer `~/.codex/rules/`
 * always, a project's `<repo>/.codex/rules/` only once that project is trusted.
 *
 * Every leaf of the commander tree carries a Codex class (its own `.codex()`
 * or its group's); emit-grammar refuses to run without one, so a new command
 * forces a conscious ALLOW/DENY decision (LUM-1233 batch 4).
 *
 * The file is wholly Lumo's: the first line marks it, init rewrites it only
 * when the content differs, and uninstall deletes it.
 */

export const CODEX_RULES_MARKER =
  '# Managed by `lumo init` (LUM-1054). Remove with `lumo uninstall`.'

/**
 * LUM-1233 batch 4 (CX-1): the three lists below are derived from the
 * `.codex()` class declared on each command (cli/src/lib/command-class.ts),
 * which emit-grammar writes into grammar.json and codex-classes.generated.ts.
 * A class on a group covers every command below it. Nothing here is kept by
 * hand any more, and a removed command (a tombstone) is never registered, so
 * it can never be allowed.
 */
const classified = Object.entries(CODEX_CLASSES)

/**
 * Server-only commands (grammar.json paths): run outside Codex's sandbox
 * without prompting. None of them takes a flag or argument that reads a local
 * file (those are in {@link CODEX_FILE_READING_COMMANDS}). A path covers
 * everything after it, so a group is server-only only when all of it is.
 */
export const CODEX_SERVER_ONLY_COMMANDS: readonly string[] = classified
  .filter(([, c]) => c.serverOnly)
  .map(([path]) => path)
  .sort()

/**
 * Commands that can read an arbitrary local file and send it to the Lumo API
 * (the flag that does it). A prefix rule cannot exclude a flag, so the whole
 * command stays sandboxed: Codex asks first, and no prompt-injected
 * `lumo doc create --file ~/.ssh/id_rsa` runs unseen.
 */
export const CODEX_FILE_READING_COMMANDS: Readonly<Record<string, string>> =
  Object.fromEntries(
    classified.flatMap(([path, c]) =>
      !c.serverOnly && c.localFiles === 'reads' ? [[path, c.detail]] : []
    )
  )

/** The reason recorded for every {@link CODEX_FILE_READING_COMMANDS} entry. */
export const FILE_READING_REASON =
  'reads local files (--file …) — Codex asks first'

/**
 * Commands that stay inside Codex's sandbox (Codex asks before running them
 * outside it), with the reason. A path covers everything below it.
 */
export const CODEX_SANDBOXED_COMMANDS: Readonly<Record<string, string>> =
  Object.fromEntries(
    classified.flatMap(([path, c]) =>
      c.serverOnly
        ? []
        : [
            [
              path,
              c.localFiles === 'reads'
                ? `${FILE_READING_REASON} (${c.detail})`
                : c.detail,
            ],
          ]
    )
  )

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
 * LUM-1292: every non-server-only command path with the reason it needs a
 * prompt (the `detail` of its `.codex()` class). These — and only these —
 * get a `prompt` rule; everything else under `lumo` is allowed by the single
 * catch-all rule. Generated from {@link CODEX_CLASSES}, never kept by hand.
 */
export const CODEX_PROMPTED_COMMANDS: Readonly<Record<string, string>> =
  Object.fromEntries(
    classified.flatMap(([path, c]) => (c.serverOnly ? [] : [[path, c.detail]]))
  )

/**
 * Build the rules file: one catch-all `allow` for `lumo`, then one `prompt`
 * rule per command that is not server-only. Codex takes the strictest
 * decision of all matching rules, so a prompted path wins over the allow.
 * Both rule kinds carry `match` / `not_match` examples — Codex validates them
 * when it loads the file.
 *
 * Deliberately fail-open for a command missing from the prompt list (a new
 * command is allowed until classified); the coverage test and emit-grammar's
 * refusal to run on an unclassified command are the safety net.
 */
export function buildCodexRules(
  prompted: Readonly<Record<string, string>> = CODEX_PROMPTED_COMMANDS
): string {
  const paths = Object.keys(prompted).sort()
  // A path already covered by a shorter prompted path adds nothing.
  const effective = paths.filter(
    p =>
      !paths.some(
        q => q !== p && startsWith(tokens(p), tokens(q)) && q.length < p.length
      )
  )
  const lines: string[] = [
    CODEX_RULES_MARKER,
    "# Every `lumo` command runs outside Codex's no-network sandbox without a",
    '# prompt, except the commands below that touch local files, start local',
    '# processes or change local setup: Codex asks first for those (the strictest',
    '# matching rule wins). A command missing from this list is allowed.',
    'prefix_rule(',
    `${RULE_INDENT}pattern = ["lumo"],`,
    `${RULE_INDENT}decision = "allow",`,
    `${RULE_INDENT}justification = "Lumo CLI command: needs network to reach the Lumo API",`,
    `${RULE_INDENT}match = ["lumo status"],`,
    `${RULE_INDENT}not_match = ["lumox status"],`,
    ')',
  ]
  for (const path of effective) {
    const pattern = ['lumo', ...tokens(path)].map(quote).join(', ')
    lines.push('prefix_rule(')
    lines.push(`${RULE_INDENT}pattern = [${pattern}],`)
    lines.push(`${RULE_INDENT}decision = "prompt",`)
    lines.push(`${RULE_INDENT}justification = ${quote(prompted[path]!)},`)
    lines.push(`${RULE_INDENT}match = [${quote(`lumo ${path}`)}],`)
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
    `ℹ \`lumo\` commands now run outside Codex's sandbox without a prompt; Codex still asks before the ones that read or write local files or start local processes (init, update, auth, worktree, memory sync/push, session attach, task update, doc create/update/patch --file …) and everything else stays sandboxed without network.\n` +
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
    'Fix: run `lumo init` (or `lumo init --agent codex`) to add the Codex rule that runs `lumo` commands outside the sandbox (.codex/rules/lumo.rules), then restart Codex — a project rules file loads only in a trusted project. ' +
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
