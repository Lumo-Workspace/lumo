import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readCliVersion } from '../lib/cli-version'
import {
  HOOK_SCRIPT_BLOCK,
  LUMO_HOOK_BEGIN,
  LUMO_HOOK_END,
} from '../lib/git-hook-template'
import { resolveGitHooksDir } from '../lib/git-hooks-dir'
import { LUMO_HOOK_EVENTS, isLumoHookCommand } from '../lib/hooks-template'
import {
  detectInstalledSkills,
  repoRoot,
  type InstallLocation,
} from '../lib/install-locations'
import { readRegistryChecked } from '../lib/install-registry'
import {
  classifySkillDir,
  isNewerVersion,
  isPathGitTracked,
} from '../lib/install-state'

export type DoctorGroup = 'machine' | 'repo-committed' | 'repo-uncommitted'
export type DoctorKind =
  | 'skill'
  | 'claude-settings'
  | 'git-hook'
  | 'codex-hooks'

export interface DoctorRow {
  path: string
  kind: DoctorKind
  scope: 'user' | 'project'
  agent: string
  group: DoctorGroup
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
}

/** Test seams: everything defaults to the real environment. */
export interface DoctorDeps {
  homeDir?: string
  cwd?: string
  cliVersion?: string | null
  env?: { PATH?: string }
}

const CMD_UPGRADE = 'lumo init --upgrade'
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

/** PreToolUse -> pre_tool_use, the form Codex uses in config.toml keys. */
export function codexEventKey(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Snake-case events that have a `[hooks.state."<hooksJson>:<event>:…"]`
 * section carrying a `trusted_hash` line. Plain text scan — no TOML parser,
 * and the hash itself is not verified.
 */
export function codexTrustedEvents(
  toml: string,
  hooksJsonPath: string
): Set<string> {
  const trusted = new Set<string>()
  const prefix = `${hooksJsonPath}:`
  let current: string | null = null
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[(.+)\]\s*$/.exec(line)
    if (header) {
      const m = /^hooks\.state\."(.*)"$/.exec(header[1]!)
      current =
        m && m[1]!.startsWith(prefix)
          ? (m[1]!.slice(prefix.length).split(':')[0] ?? null)
          : null
      continue
    }
    if (current && /^\s*trusted_hash\s*=/.test(line)) trusted.add(current)
  }
  return trusted
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

function groupFor(scope: 'user' | 'project', tracked: boolean): DoctorGroup {
  if (scope === 'user') return 'machine'
  return tracked ? 'repo-committed' : 'repo-uncommitted'
}

function skillRow(
  loc: InstallLocation,
  cliVersion: string | null
): DoctorRow | null {
  const cls = classifySkillDir(loc.path)
  if (cls.state === 'missing') return null
  const base = {
    path: loc.path,
    kind: 'skill' as const,
    scope: loc.scope,
    agent: loc.agent,
    group: groupFor(loc.scope, cls.gitTracked),
  }
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
      state: `behind ${v}`,
      suggestion: CMD_UPGRADE,
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
  warnings: DoctorWarning[]
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
  if (!any) return null
  const tracked = scope === 'project' && isPathGitTracked(file)
  const row: DoctorRow = {
    path: file,
    kind: 'claude-settings',
    scope,
    agent: 'claude-code',
    group: groupFor(scope, tracked),
    state: missing.length === 0 ? 'up to date' : 'incomplete',
  }
  if (missing.length > 0) {
    row.suggestion = `lumo init --${scope}`
    row.detail = `missing ${missing.length} hook event(s)`
    warnings.push({
      code: 'missing-hook-events',
      message: `${file} is missing Lumo hook events: ${missing.join(', ')}`,
    })
  }
  return row
}

function gitHookRow(root: string): DoctorRow | null {
  const { dir, coreHooksPath } = resolveGitHooksDir(root)
  if (!dir) return null
  const file = path.join(dir, 'prepare-commit-msg')
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
  // The default hooks dir lives under .git and is never tracked; only a
  // configured core.hooksPath dir can be committed.
  const tracked = coreHooksPath ? isPathGitTracked(file) : false
  const group: DoctorGroup = tracked
    ? 'repo-committed'
    : coreHooksPath
      ? 'repo-uncommitted'
      : 'machine'
  const current = block === HOOK_SCRIPT_BLOCK
  return {
    path: file,
    kind: 'git-hook',
    scope: 'project',
    agent: 'git',
    group,
    state: current ? 'up to date' : 'behind',
    ...(current ? {} : { suggestion: CMD_UPGRADE }),
  }
}

function codexRow(home: string, warnings: DoctorWarning[]): DoctorRow | null {
  const file = path.join(home, '.codex', 'hooks.json')
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
  const trusted = codexTrustedEvents(toml, file)
  const untrusted = events.filter(e => !trusted.has(codexEventKey(e)))
  const row: DoctorRow = {
    path: file,
    kind: 'codex-hooks',
    scope: 'user',
    agent: 'codex',
    group: 'machine',
    state:
      untrusted.length === 0 ? 'trusted (hash not verified)' : 'not trusted',
  }
  if (untrusted.length > 0) {
    row.detail = `${CODEX_HINT}: ${untrusted.join(', ')}`
    warnings.push({
      code: 'codex-untrusted',
      message: `Codex hooks not trusted — ${CODEX_HINT} (${untrusted.join(', ')})`,
    })
  }
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

  // Skills: detected locations plus anything the registry recorded.
  const locs = new Map<string, InstallLocation>()
  for (const l of detectInstalledSkills({ homeDir: home, cwd }))
    locs.set(l.path, l)
  for (const rec of registry.installs) {
    if (rec.kind !== 'skill' || locs.has(rec.path)) continue
    if (!fs.existsSync(rec.path)) {
      warnings.push({
        code: 'registry-stale',
        message: `registry lists ${rec.path} but it no longer exists`,
      })
      continue
    }
    locs.set(rec.path, { path: rec.path, scope: rec.scope, agent: rec.agent })
  }
  for (const l of locs.values()) {
    const row = skillRow(l, cliVersion)
    if (row) rows.push(row)
  }

  const root = repoRoot(cwd)
  const settingsFiles: Array<[string, 'user' | 'project']> = [
    [path.join(home, '.claude', 'settings.json'), 'user'],
  ]
  if (root)
    settingsFiles.push([path.join(root, '.claude', 'settings.json'), 'project'])
  for (const [file, scope] of settingsFiles) {
    const row = settingsRow(file, scope, warnings)
    if (row) rows.push(row)
  }
  if (root) {
    const row = gitHookRow(root)
    if (row) rows.push(row)
  }
  const codex = codexRow(home, warnings)
  if (codex) rows.push(codex)

  // The same agent's skill at user and project scope with different versions.
  const skills = rows.filter(r => r.kind === 'skill' && r.version)
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

  return { cliVersion, rows, warnings }
}

const GROUP_TITLES: Array<[DoctorGroup, string]> = [
  ['machine', 'This machine'],
  ['repo-committed', 'This repo — committed'],
  ['repo-uncommitted', 'This repo — uncommitted'],
]

function renderText(report: DoctorReport): string {
  const lines: string[] = [
    `Lumo doctor — CLI ${report.cliVersion ?? 'unknown version'}`,
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
      if (r.suggestion) lines.push(`    -> ${r.suggestion}`)
    }
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings')
    for (const w of report.warnings) lines.push(`  ! ${w.code}: ${w.message}`)
  }
  return lines.join('\n') + '\n'
}

/** `lumo doctor`: read-only report of every Lumo install; always exits 0. */
export async function doctor(
  options: { json?: boolean } = {},
  deps: DoctorDeps = {}
): Promise<number> {
  const report = collectDoctor(deps)
  process.stdout.write(
    options.json ? JSON.stringify(report, null, 2) + '\n' : renderText(report)
  )
  return 0
}
