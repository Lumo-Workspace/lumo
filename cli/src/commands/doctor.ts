import * as fs from 'fs'
import { stringifyJson, withVersion } from '../lib/json-output'
import * as os from 'os'
import * as path from 'path'
import { WARN_PREFIX } from '../lib/errors'
import { findCliPackageRoot, readCliVersion } from '../lib/cli-version'
import {
  describeAutoUpdate,
  getAutoUpdateStatus,
  isAutoUpdateEligible,
  type SpawnSyncFn,
  type AutoUpdateStatus,
} from '../lib/auto-update'
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
} from '../lib/git-hook-template'
import { resolveGitHooksDir } from '../lib/git-hooks-dir'
import {
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
  isLumoHookCommand,
  retiredLumoHookEvents,
} from '../lib/hooks-template'
import {
  codexEventKey,
  codexHooksPath,
  codexTrustedEventsForFile,
} from '../lib/codex-hooks'

// LUM-1112: the trust scan moved to lib/codex-hooks (session attach/status use it too).
export { codexEventKey, codexTrustedEvents } from '../lib/codex-hooks'
import {
  classifyCodexRules,
  codexNetworkState,
  codexRulesPath,
} from '../lib/codex-rules'
import {
  detectInstalledSkills,
  isLumoSkillSource,
  repoRoot,
  type InstallLocation,
} from '../lib/install-locations'
import { GIT_HOOK_AGENT, readRegistryChecked } from '../lib/install-registry'
import {
  classifySkillDir,
  isNewerVersion,
  isPathGitTracked,
} from '../lib/install-state'

export type DoctorGroup =
  | 'machine'
  | 'repo-committed'
  | 'repo-uncommitted'
  | 'other-repos'
export type DoctorKind =
  | 'skill'
  | 'claude-settings'
  | 'git-hook'
  | 'codex-hooks'
  | 'codex-rules'

export interface DoctorRow {
  path: string
  kind: DoctorKind
  scope: 'user' | 'project'
  agent: string
  group: DoctorGroup
  /** Whether git tracks the path (fails closed: unknown counts as tracked). */
  tracked?: boolean
  version?: string
  state: string
  suggestion?: string
  detail?: string
}

export interface DoctorWarning {
  code: string
  message: string
}

export interface DoctorReport {
  cliVersion: string | null
  rows: DoctorRow[]
  warnings: DoctorWarning[]
  autoUpdate: AutoUpdateStatus
}

/** Test seams: everything defaults to the real environment. */
export interface DoctorDeps {
  homeDir?: string
  cwd?: string
  cliVersion?: string | null
  env?: Record<string, string | undefined>
  /** Whether the running CLI is a global npm install (auto-update only runs for those). */
  isGlobalInstall?: () => boolean
  /** Package root and spawnSync for the default eligibility probe (same seams as the worker). */
  pkgRoot?: string | null
  spawnSync?: SpawnSyncFn
}

/**
 * LUM-1118: the refresh for an install is re-running `lumo init` for its
 * scope, narrowed to its agent so no other agent gets set up on the way.
 */
export function refreshCommand(
  scope: 'user' | 'project',
  agent?: string
): string {
  return `lumo init --scope ${scope}${agent ? ` --agent ${agent}` : ''}`
}

/** State for an install older than what the running CLI would write. */
function behindCli(cliVersion: string | null): string {
  return cliVersion ? `behind CLI ${cliVersion}` : 'behind'
}
const CMD_FORCE = 'lumo init --force'
const CMD_UPDATE = 'lumo update'
const CODEX_HINT = 'open /hooks in Codex and Trust'

/** Whether an executable named `lumo` exists in any directory of `pathVar`. */
export function lumoOnPath(pathVar: string | undefined): boolean {
  if (!pathVar) return false
  const names =
    process.platform === 'win32' ? ['lumo.cmd', 'lumo.exe', 'lumo'] : ['lumo']
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue
    for (const n of names) {
      const p = path.join(dir, n)
      try {
        if (!fs.statSync(p).isFile()) continue
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch {
        // not here — keep looking
      }
    }
  }
  return false
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Commands under `hooks[event][*].hooks[*].command`, or [] on a bad shape. */
function eventCommands(hooks: unknown, event: string): string[] {
  if (!hooks || typeof hooks !== 'object') return []
  const groups = (hooks as Record<string, unknown>)[event]
  if (!Array.isArray(groups)) return []
  const out: string[] = []
  for (const g of groups) {
    const list = (g as { hooks?: unknown } | null)?.hooks
    if (!Array.isArray(list)) continue
    for (const h of list) {
      const c = (h as { command?: unknown } | null)?.command
      if (typeof c === 'string') out.push(c)
    }
  }
  return out
}

const SOURCE_STATE = 'Lumo skill source (not an install)'

/** Tracked status of a hook/settings file; paths under a `.git` dir never are. */
function fileTracked(file: string): boolean {
  if (file.split(path.sep).includes('.git')) return false
  return isPathGitTracked(file)
}

function inRepo(root: string | null, p: string): boolean {
  if (!root) return false
  const rel = path.relative(root, p)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Paths outside the current repo (and not user-scope) are "other repos". */
function groupFor(
  scope: 'user' | 'project',
  root: string | null,
  p: string,
  tracked: () => boolean
): DoctorGroup {
  if (scope === 'user') return 'machine'
  if (!inRepo(root, p)) return 'other-repos'
  return tracked() ? 'repo-committed' : 'repo-uncommitted'
}

function skillRow(
  loc: InstallLocation,
  cliVersion: string | null,
  root: string | null
): DoctorRow | null {
  const cls = classifySkillDir(loc.path)
  if (cls.state === 'missing') return null
  const base = {
    path: loc.path,
    kind: 'skill' as const,
    scope: loc.scope,
    agent: loc.agent,
    group: groupFor(loc.scope, root, loc.path, () => cls.gitTracked),
    tracked: cls.gitTracked,
  }
  if (isLumoSkillSource(loc.path)) return { ...base, state: SOURCE_STATE }
  if (cls.state === 'modified')
    return {
      ...base,
      state: 'modified',
      suggestion: CMD_FORCE,
      detail: 'edited locally; the suggested command discards those edits',
    }
  const v = cls.version as string
  if (cliVersion && isNewerVersion(v, cliVersion))
    return {
      ...base,
      version: v,
      state: behindCli(cliVersion),
      suggestion: refreshCommand(loc.scope, loc.agent),
    }
  if (cliVersion && isNewerVersion(cliVersion, v))
    return {
      ...base,
      version: v,
      state: 'newer than CLI',
      suggestion: CMD_UPDATE,
    }
  return { ...base, version: v, state: 'up to date' }
}

function settingsRow(
  file: string,
  scope: 'user' | 'project',
  warnings: DoctorWarning[],
  root: string | null
): DoctorRow | null {
  const data = readJson(file)
  if (!data) return null
  const missing: string[] = []
  let any = false
  for (const [event, slug] of LUMO_HOOK_EVENTS) {
    const has = eventCommands(data.hooks, event).some(c =>
      isLumoHookCommand(c, slug)
    )
    if (has) any = true
    else missing.push(event)
  }
  const retired = retiredLumoHookEvents(data.hooks)
  if (!any && retired.length === 0) return null
  const row: DoctorRow = {
    path: file,
    kind: 'claude-settings',
    scope,
    agent: 'claude-code',
    group: groupFor(scope, root, file, () => isPathGitTracked(file)),
    tracked: isPathGitTracked(file),
    state:
      missing.length === 0 && retired.length === 0
        ? 'up to date'
        : 'incomplete',
  }
  const details: string[] = []
  if (missing.length > 0) {
    details.push(`missing ${missing.length} hook event(s)`)
    warnings.push({
      code: 'missing-hook-events',
      message: `${file} is missing Lumo hook events: ${missing.join(', ')}`,
    })
  }
  // LUM-1235: a Lumo WorktreeCreate entry replaces Claude Code's own worktree
  // creation and makes it fail; `lumo init` removes it.
  if (retired.length > 0) {
    details.push(`retired hook event(s) to remove: ${retired.join(', ')}`)
    warnings.push({
      code: 'retired-hook-events',
      message: `${file} still has retired Lumo hook events that break Claude Code worktrees: ${retired.join(', ')}`,
    })
  }
  if (details.length > 0) {
    row.suggestion = `lumo init --scope ${scope}`
    row.detail = details.join('; ')
  }
  return row
}

function gitHookRow(
  file: string,
  scope: 'user' | 'project',
  root: string | null,
  current: { path: string; coreHooksPath: string | null } | null,
  cliVersion: string | null
): DoctorRow | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const begin = text.indexOf(LUMO_HOOK_BEGIN)
  if (begin === -1) return null
  const end = text.indexOf(LUMO_HOOK_END, begin)
  const block =
    end === -1 ? null : text.slice(begin, end + LUMO_HOOK_END.length)
  const isCurrent = current !== null && current.path === file
  const hooksPath = isCurrent ? current.coreHooksPath : null
  // The default hooks dir lives under .git and is never tracked; only a
  // configured core.hooksPath dir can be committed.
  const group: DoctorGroup = isCurrent
    ? hooksPath
      ? groupFor('project', root, file, () => isPathGitTracked(file))
      : 'machine'
    : groupFor(scope, root, file, () => isPathGitTracked(file))
  const upToDate = block === HOOK_SCRIPT_BLOCK
  const row: DoctorRow = {
    path: file,
    kind: 'git-hook',
    scope,
    agent: GIT_HOOK_AGENT,
    group,
    tracked: isCurrent && !hooksPath ? false : fileTracked(file),
    state: upToDate ? 'up to date' : behindCli(cliVersion),
  }
  if (!upToDate) {
    if (hooksPath)
      row.detail = `core.hooksPath hook is managed by you: replace the Lumo block by hand with the one \`lumo init --scope project\` prints`
    else row.suggestion = refreshCommand('project')
  }
  return row
}

/**
 * A Codex hooks.json with `lumo hook` entries: user (`~/.codex/hooks.json`) or
 * project (`<repo>/.codex/hooks.json`, written by `init --agent codex
 * --project`). Codex keeps trust for both in `~/.codex/config.toml`, keyed by
 * the hooks file's absolute path.
 */
function codexRow(
  file: string,
  scope: 'user' | 'project',
  home: string,
  root: string | null,
  warnings: DoctorWarning[]
): DoctorRow | null {
  const data = readJson(file)
  if (!data) return null
  const hooks = data.hooks && typeof data.hooks === 'object' ? data.hooks : data
  const events = Object.keys(hooks as Record<string, unknown>).filter(e =>
    eventCommands(hooks, e).some(c => c.startsWith('lumo hook '))
  )
  if (events.length === 0) return null
  let toml = ''
  try {
    toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
  } catch {
    // no config.toml: nothing is trusted yet
  }
  // Keyed by the given path or its realpath (/tmp vs /private/tmp).
  const trusted = codexTrustedEventsForFile(toml, file)
  const untrusted = events.filter(e => !trusted.has(codexEventKey(e)))
  const missing = CODEX_HOOK_EVENTS.filter(
    ([event, slug]) =>
      !eventCommands(hooks, event).some(c => isLumoHookCommand(c, slug))
  ).map(([event]) => event)
  const tracked = isPathGitTracked(file)
  const row: DoctorRow = {
    path: file,
    kind: 'codex-hooks',
    scope,
    agent: 'codex',
    group: groupFor(scope, root, file, () => tracked),
    tracked,
    state:
      untrusted.length === 0
        ? 'trusted (hash not verified)'
        : scope === 'project'
          ? 'trust unverified'
          : 'not trusted',
  }
  const details: string[] = []
  if (untrusted.length > 0) {
    const projectHint = `${CODEX_HINT} if Lumo hooks don't fire`
    details.push(
      scope === 'project'
        ? `${projectHint}: ${untrusted.join(', ')}`
        : `${CODEX_HINT}: ${untrusted.join(', ')}`
    )
    warnings.push({
      code: 'codex-untrusted',
      message:
        scope === 'project'
          ? `Codex hooks trust unverified (${file}) — ${projectHint} (${untrusted.join(', ')})`
          : `Codex hooks not trusted (${file}) — ${CODEX_HINT} (${untrusted.join(', ')})`,
    })
  }
  if (missing.length > 0) {
    details.push(`missing ${missing.length} hook event(s)`)
    row.suggestion = refreshCommand(scope, 'codex')
    warnings.push({
      code: 'missing-hook-events',
      message: `${file} is missing Lumo Codex hook events: ${missing.join(', ')}`,
    })
  }
  // LUM-1054: whether `lumo` commands in a Codex shell can reach the API.
  const network = codexNetworkState(file, home)
  if (network === 'config') {
    details.push(
      'network: on for every sandboxed command (network_access = true in config.toml)'
    )
  } else if (network === 'off') {
    details.push(
      "network: lumo commands have no network in Codex's sandbox (no .codex/rules/lumo.rules)"
    )
    row.suggestion ??= `lumo init --agent codex --${scope}`
    warnings.push({
      code: 'codex-no-network',
      message: `\`lumo\` commands cannot reach the Lumo API from Codex's sandbox for ${file} — run \`lumo init --agent codex --${scope}\` to add the Codex rule for server-only lumo commands`,
    })
  }
  if (details.length > 0) row.detail = details.join('; ')
  return row
}

/**
 * The Lumo rules file (LUM-1054). Only a file carrying the Lumo marker is an
 * install; a `lumo.rules` the user wrote is theirs and not listed.
 */
function codexRulesRow(
  file: string,
  scope: 'user' | 'project',
  root: string | null
): DoctorRow | null {
  const state = classifyCodexRules(file)
  if (state === 'missing' || state === 'foreign') return null
  const tracked = isPathGitTracked(file)
  const row: DoctorRow = {
    path: file,
    kind: 'codex-rules',
    scope,
    agent: 'codex',
    group: groupFor(scope, root, file, () => tracked),
    tracked,
    state: state === 'current' ? 'up to date' : 'outdated',
    detail:
      scope === 'project'
        ? "server-only `lumo` commands run outside Codex's sandbox; Codex asks before the others (loaded once the project is trusted in Codex)"
        : "server-only `lumo` commands run outside Codex's sandbox; Codex asks before the others",
  }
  if (state === 'outdated') row.suggestion = refreshCommand(scope, 'codex')
  return row
}

/** Gather every Lumo install this machine/repo knows about. Never writes. */
export function collectDoctor(deps: DoctorDeps = {}): DoctorReport {
  const home = deps.homeDir ?? os.homedir()
  const cwd = deps.cwd ?? process.cwd()
  const cliVersion =
    deps.cliVersion !== undefined ? deps.cliVersion : readCliVersion()
  const env = deps.env ?? process.env
  const warnings: DoctorWarning[] = []
  const rows: DoctorRow[] = []

  const { registry, corrupt } = readRegistryChecked()
  if (corrupt)
    warnings.push({
      code: 'registry-corrupt',
      message:
        'installs.json is unreadable; doctor ignored it and did not rewrite it',
    })

  const root = repoRoot(cwd)
  const stale = (p: string): void => {
    warnings.push({
      code: 'registry-stale',
      message: `registry lists ${p} but it no longer exists`,
    })
  }

  // Skills: detected locations plus anything the registry recorded.
  const locs = new Map<string, InstallLocation>()
  for (const l of detectInstalledSkills({ homeDir: home, cwd }))
    locs.set(l.path, l)
  for (const rec of registry.installs) {
    if (rec.kind !== 'skill' || locs.has(rec.path)) continue
    if (!fs.existsSync(rec.path)) {
      stale(rec.path)
      continue
    }
    locs.set(rec.path, { path: rec.path, scope: rec.scope, agent: rec.agent })
  }
  for (const l of locs.values()) {
    const row = skillRow(l, cliVersion, root)
    if (row) rows.push(row)
  }

  // Claude settings: the two standard files plus recorded ones.
  const settingsFiles = new Map<string, 'user' | 'project'>()
  settingsFiles.set(path.join(home, '.claude', 'settings.json'), 'user')
  if (root)
    settingsFiles.set(path.join(root, '.claude', 'settings.json'), 'project')
  for (const rec of registry.installs) {
    if (rec.kind !== 'claude-settings') continue
    if (!fs.existsSync(rec.path)) {
      stale(rec.path)
      continue
    }
    if (settingsFiles.has(rec.path)) continue
    settingsFiles.set(rec.path, rec.scope)
  }
  for (const [file, scope] of settingsFiles) {
    const row = settingsRow(file, scope, warnings, root)
    if (row) rows.push(row)
  }

  // prepare-commit-msg: this repo's hooks dir plus recorded hooks.
  let current: { path: string; coreHooksPath: string | null } | null = null
  const hookFiles = new Map<string, { scope: 'user' | 'project' }>()
  if (root) {
    const { dir, coreHooksPath } = resolveGitHooksDir(root)
    if (dir) {
      current = { path: path.join(dir, 'prepare-commit-msg'), coreHooksPath }
      hookFiles.set(current.path, { scope: 'project' })
    }
  }
  for (const rec of registry.installs) {
    if (rec.kind !== 'git-hook') continue
    if (!fs.existsSync(rec.path)) {
      stale(rec.path)
      continue
    }
    if (hookFiles.has(rec.path)) continue
    hookFiles.set(rec.path, { scope: rec.scope })
  }
  for (const [file, t] of hookFiles) {
    const row = gitHookRow(file, t.scope, root, current, cliVersion)
    if (row) rows.push(row)
  }
  // Codex hooks.json: user + this repo's file plus recorded ones.
  const codexFiles = new Map<string, 'user' | 'project'>()
  codexFiles.set(codexHooksPath(home), 'user')
  if (root) codexFiles.set(codexHooksPath(root), 'project')
  for (const rec of registry.installs) {
    if (rec.kind !== 'codex-hooks') continue
    if (!fs.existsSync(rec.path)) {
      stale(rec.path)
      continue
    }
    if (codexFiles.has(rec.path)) continue
    codexFiles.set(rec.path, rec.scope)
  }
  for (const [file, scope] of codexFiles) {
    const row = codexRow(file, scope, home, root, warnings)
    if (row) rows.push(row)
  }
  // Codex rules: user + this repo's file plus recorded ones.
  const rulesFiles = new Map<string, 'user' | 'project'>()
  rulesFiles.set(codexRulesPath(home), 'user')
  if (root) rulesFiles.set(codexRulesPath(root), 'project')
  for (const rec of registry.installs) {
    if (rec.kind !== 'codex-rules') continue
    if (!fs.existsSync(rec.path)) {
      stale(rec.path)
      continue
    }
    if (rulesFiles.has(rec.path)) continue
    rulesFiles.set(rec.path, rec.scope)
  }
  for (const [file, scope] of rulesFiles) {
    const row = codexRulesRow(file, scope, root)
    if (row) rows.push(row)
  }

  // The same agent's skill at user and project scope with different versions.
  const skills = rows.filter(
    r => r.kind === 'skill' && r.version && r.group !== 'other-repos'
  )
  for (const u of skills.filter(r => r.scope === 'user')) {
    for (const p of skills.filter(
      r => r.scope === 'project' && r.agent === u.agent
    )) {
      if (u.version !== p.version)
        warnings.push({
          code: 'scope-version-mismatch',
          message: `${u.agent}: user copy is ${u.version} but project copy is ${p.version} (${u.path} vs ${p.path})`,
        })
    }
  }

  if (!lumoOnPath(env.PATH))
    warnings.push({
      code: 'lumo-not-on-path',
      message:
        '`lumo` is not resolvable on PATH, so installed hooks cannot run; install it globally (npm install -g @lumoai/cli)',
    })

  // A project install of another repo is refreshed from inside that repo.
  for (const r of rows)
    if (r.group === 'other-repos' && r.suggestion?.startsWith('lumo init '))
      r.detail = r.detail
        ? `${r.detail}; run the command in that repo`
        : 'run the command in that repo'

  return { cliVersion, rows, warnings, autoUpdate: getAutoUpdateStatus(env) }
}

const GROUP_TITLES: Array<[DoctorGroup, string]> = [
  ['machine', 'This machine'],
  ['repo-committed', 'This repo — committed'],
  ['repo-uncommitted', 'This repo — uncommitted'],
  ['other-repos', 'Other repos'],
]

function renderText(report: DoctorReport): string {
  const lines: string[] = [
    `Lumo doctor — CLI ${report.cliVersion ?? 'unknown version'}`,
    describeAutoUpdate(report.autoUpdate),
  ]
  if (report.rows.length === 0) lines.push('', 'No Lumo installs found.')
  for (const [group, title] of GROUP_TITLES) {
    const rows = report.rows.filter(r => r.group === group)
    if (rows.length === 0) continue
    lines.push('', title)
    for (const r of rows) {
      lines.push(`  ${r.path}`)
      const parts = [r.kind, r.version ? `v${r.version}` : null, r.state]
      lines.push(`    ${parts.filter(Boolean).join(' · ')}`)
      if (r.detail) lines.push(`    ${r.detail}`)
      // LUM-1232 S-1: a command sits on its own line with no arrow.
      if (r.suggestion) lines.push(`    ${r.suggestion}`)
    }
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings')
    for (const w of report.warnings)
      lines.push(`  ${WARN_PREFIX} ${w.code}: ${w.message}`)
  }
  return lines.join('\n') + '\n'
}

/** `lumo doctor`: read-only report of every Lumo install; always exits 0. */
export async function doctor(
  options: { json?: boolean } = {},
  deps: DoctorDeps = {}
): Promise<number> {
  const report = collectDoctor(deps)
  // Probed here, not in collectDoctor: uninstall reuses the collector and must
  // not pay for an `npm root -g` spawn.
  if (report.autoUpdate.enabled) {
    // One-shot diagnostic: a synchronous `npm root -g` (5 s cap) is fine here.
    const isGlobal =
      deps.isGlobalInstall ??
      (() =>
        isAutoUpdateEligible(
          deps.pkgRoot !== undefined ? deps.pkgRoot : findCliPackageRoot(),
          deps.spawnSync
        ))
    report.autoUpdate = { ...report.autoUpdate, eligible: isGlobal() }
  }
  process.stdout.write(
    options.json ? stringifyJson(withVersion(report)) : renderText(report)
  )
  return 0
}
