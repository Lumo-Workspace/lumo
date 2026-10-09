import * as fs from 'fs'
import * as path from 'path'

/**
 * LUM-1054: Codex's default `workspace-write` sandbox has no network, so every
 * `lumo` command in a Codex shell failed with `could not reach Lumo API …
 * (fetch failed)` (hooks were unaffected: they run outside the sandbox).
 *
 * Instead of turning on network for every sandboxed command
 * (`[sandbox_workspace_write] network_access = true`), `lumo init` writes a
 * Codex rules file with one `prefix_rule` that lets commands starting with
 * `lumo` run outside the sandbox without prompting. Everything else stays
 * sandboxed. Codex loads `<layer>/rules/*.rules` at startup — the user layer
 * `~/.codex/rules/` always, a project's `<repo>/.codex/rules/` only once that
 * project is trusted.
 *
 * The file is wholly Lumo's: the first line marks it, init rewrites it only
 * when the content differs, and uninstall deletes it.
 */

export const CODEX_RULES_MARKER =
  '# Managed by `lumo init` (LUM-1054). Remove with `lumo uninstall`.'

export const LUMO_CODEX_RULES =
  `${CODEX_RULES_MARKER}\n` +
  `# Lets \`lumo\` commands reach the Lumo API from Codex's sandbox: a command whose\n` +
  `# argv starts with \`lumo\` runs outside the sandbox without prompting. Every\n` +
  `# other command stays sandboxed (still no network).\n` +
  `prefix_rule(\n` +
  `    pattern = ["lumo"],\n` +
  `    decision = "allow",\n` +
  `    justification = "The Lumo CLI needs network access to reach the Lumo API",\n` +
  `    match = ["lumo session status", "lumo task context LUM-1"],\n` +
  `    not_match = ["lumox status"],\n` +
  `)\n`

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
 * to it, else `network_access = true` in that layer's or the user's
 * config.toml, else off.
 */
export function codexNetworkState(
  hooksPath: string,
  homeDir: string
): CodexNetworkState {
  const rules = classifyCodexRules(codexRulesPathForHooks(hooksPath))
  if (rules === 'current' || rules === 'outdated') return 'rules'
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
    `ℹ \`lumo\` commands now run outside Codex's sandbox (no prompt) so they can reach the Lumo API; every other command stays sandboxed without network.\n` +
    `  Restart Codex to load ${file}.` +
    (scope === 'project'
      ? ' Codex loads a project rules file only once you trust the project.'
      : '')
  )
}

/**
 * Appended once to a failing command run inside Codex's sandbox
 * (`CODEX_SANDBOX` set) when it could not reach the Lumo API.
 */
export const CODEX_SANDBOX_NETWORK_HINT =
  "Hint: this ran inside Codex's sandbox, which has no network by default, so lumo could not reach the Lumo API. " +
  'Fix: run `lumo init` (or `lumo init --agent codex`) to add the Codex rule that runs `lumo` commands outside the sandbox (.codex/rules/lumo.rules), then restart Codex — a project rules file loads only in a trusted project. ' +
  'Run lumo as its own command: piped or redirected (`lumo … | head`) it stays sandboxed. ' +
  'Alternatively allow network for every sandboxed command: add `[sandbox_workspace_write]` with `network_access = true` to ~/.codex/config.toml.'
