import * as fs from 'fs'
import { stringifyJson } from '../lib/json-output'
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
  LUMO_HOOK_END,
  PREPARE_COMMIT_MSG_HOOK,
  type GitHookSpec,
} from '../lib/git-hook-template'
import { SCAN_HOOKS, scanHookFor } from '../lib/scan-hook-template'
import { resolveGitHooksDir } from '../lib/git-hooks-dir'
import {
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
  isLumoHookCommand,
  staleLumoHookEvents,
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
import { isPathGitTracked, repoRoot } from '../lib/repo-root'
import { projectClaudeSettingsTarget } from '../lib/install-plan'
import {
  classifySkillStub,
  skillStubAgent,
  skillStubPaths,
} from '../lib/skill-stub'
import { readCredentials, type Credentials } from '../lib/config'
import { resolveAuthedApiUrl, verifyToken } from '../lib/api'

/**
 * LUM-1292: `lumo doctor` reports the Lumo install of the current git repo
 * only — Claude Code / Codex hooks, the Codex rule, the git hooks — plus
 * login and whether the Lumo API answers. `--json` schema version 2.
 */
export const DOCTOR_JSON_VERSION = 2

export type DoctorKind =
  | 'claude-settings'
  | 'git-hook'
  | 'codex-hooks'
  | 'codex-rules'
  | 'skill-stub'
  | 'scan-hook'

/** The agent label of the git hooks (they belong to no coding agent). */
export const GIT_HOOK_AGENT = 'git'

export interface DoctorRow {
  path: string
  kind: DoctorKind
  agent: string
  /** Whether git tracks the path (fails closed: unknown counts as tracked). */
  tracked: boolean
  state: string
  suggestion?: string
  detail?: string
}

export interface DoctorWarning {
  code: string
  message: string
}

/**
 * - `ok`: the API accepted the key;
 * - `invalid-key`: reached, key rejected;
 * - `unreachable`: no answer (offline, or inside Codex's sandbox);
 * - `error`: any other failure;
 * - `not-checked`: not logged in, so nothing to check.
 */
export type ApiState =
  | 'ok'
  | 'invalid-key'
  | 'unreachable'
  | 'error'
  | 'not-checked'

export interface DoctorAuth {
  loggedIn: boolean
  email?: string
  workspace?: string
  apiUrl?: string
  api: ApiState
  detail?: string
}

export interface DoctorReport {
  cliVersion: string | null
  /** The git repo root, or null outside a repo. */
  repo: string | null
  rows: DoctorRow[]
  warnings: DoctorWarning[]
  autoUpdate: AutoUpdateStatus
}

/** Test seams: everything defaults to the real environment. */
export interface DoctorDeps {
  /** Home dir holding `~/.codex/config.toml` (Codex trust) and user rules. */
  homeDir?: string
  cwd?: string
  cliVersion?: string | null
  env?: Record<string, string | undefined>
  /** Whether the running CLI is a global npm install (auto-update only runs for those). */
  isGlobalInstall?: () => boolean
  /** Package root and spawnSync for the default eligibility probe (same seams as the worker). */
  pkgRoot?: string | null
  spawnSync?: SpawnSyncFn
  /** Saved credentials (default: `~/.lumo/credentials.json`). */
  credentials?: () => Credentials | null
  /** Check the key against the API; throws on failure (default: `/api/auth/verify`). */
  checkApi?: (apiUrl: string, token: string) => Promise<void>
  /** Timeout of the default API check (default {@link API_TIMEOUT_MS}). */
  apiTimeoutMs?: number
}

/**
 * LUM-1118: the refresh for an install is re-running `lumo init`, narrowed
 * to its agent so no other agent gets set up on the way.
 */
export function refreshCommand(agent?: string): string {
  return `lumo init${agent ? ` --agent ${agent}` : ''}`
}

/** State for a file older than what the running CLI would write. */
function behindCli(cliVersion: string | null): string {
  return cliVersion ? `behind CLI ${cliVersion}` : 'behind'
}
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

/** Tracked status of a hook/settings file; paths under a `.git` dir never are. */
function fileTracked(file: string): boolean {
  if (file.split(path.sep).includes('.git')) return false
  return isPathGitTracked(file)
}

function settingsRow(
  root: string,
  warnings: DoctorWarning[]
): DoctorRow | null {
  const file = path.join(root, '.claude', 'settings.json')
  // The agent token baked into the entries (`--agent`), for the refresh.
  const agent = projectClaudeSettingsTarget(root)?.agent ?? 'claude-code'
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
  const retired = staleLumoHookEvents(data.hooks)
  if (!any && retired.length === 0) return null
  const row: DoctorRow = {
    path: file,
    kind: 'claude-settings',
    agent,
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
  // Lumo entries for events no longer registered (e.g. an old WorktreeCreate,
  // which breaks Claude Code worktrees); `lumo init` removes them.
  if (retired.length > 0) {
    details.push(`stale hook event(s) to remove: ${retired.join(', ')}`)
    warnings.push({
      code: 'retired-hook-events',
      message: `${file} still has Lumo hook events that are no longer registered: ${retired.join(', ')}`,
    })
  }
  if (details.length > 0) {
    row.suggestion = refreshCommand(agent)
    row.detail = details.join('; ')
  }
  return row
}

/**
 * A git hook file holding a Lumo block: prepare-commit-msg, or (LUM-1258) a
 * pre-commit / pre-push scan hook (`kind: 'scan-hook'`).
 */
function gitHookRow(
  file: string,
  coreHooksPath: string | null,
  cliVersion: string | null,
  spec: GitHookSpec = PREPARE_COMMIT_MSG_HOOK,
  kind: 'git-hook' | 'scan-hook' = 'git-hook'
): DoctorRow | null {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const begin = text.indexOf(spec.begin)
  if (begin === -1) return null
  const end = text.indexOf(LUMO_HOOK_END, begin)
  const block =
    end === -1 ? null : text.slice(begin, end + LUMO_HOOK_END.length)
  const upToDate = block === spec.block
  const refresh =
    kind === 'scan-hook' ? `${refreshCommand()} --scan-hooks` : refreshCommand()
  const row: DoctorRow = {
    path: file,
    kind,
    agent: GIT_HOOK_AGENT,
    // The default hooks dir lives under .git and is never tracked; only a
    // configured core.hooksPath dir can be committed.
    tracked: coreHooksPath ? fileTracked(file) : false,
    state: upToDate ? 'up to date' : behindCli(cliVersion),
  }
  if (!upToDate) {
    if (coreHooksPath)
      row.detail = `core.hooksPath hook is managed by you: replace the Lumo block by hand with the one \`${refresh}\` prints`
    else row.suggestion = refresh
  }
  if (kind === 'scan-hook')
    row.detail = [
      row.detail,
      'blocks only on a finding that would block DONE; skip once with --no-verify',
    ]
      .filter(Boolean)
      .join('; ')
  return row
}

/**
 * The repo's `.codex/hooks.json` with `lumo hook` entries. Codex keeps trust
 * in `~/.codex/config.toml`, keyed by the hooks file's absolute path; a
 * project file is loaded only once the project is trusted, so its trust is
 * reported as unverified rather than missing.
 */
function codexRow(
  file: string,
  home: string,
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
  const row: DoctorRow = {
    path: file,
    kind: 'codex-hooks',
    agent: 'codex',
    tracked: isPathGitTracked(file),
    state:
      untrusted.length === 0
        ? 'trusted (hash not verified)'
        : 'trust unverified',
  }
  const details: string[] = []
  if (untrusted.length > 0) {
    const hint = `${CODEX_HINT} if Lumo hooks don't fire`
    details.push(`${hint}: ${untrusted.join(', ')}`)
    warnings.push({
      code: 'codex-untrusted',
      message: `Codex hooks trust unverified (${file}) — ${hint} (${untrusted.join(', ')})`,
    })
  }
  if (missing.length > 0) {
    details.push(`missing ${missing.length} hook event(s)`)
    row.suggestion = refreshCommand('codex')
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
    row.suggestion ??= refreshCommand('codex')
    warnings.push({
      code: 'codex-no-network',
      message: `\`lumo\` commands cannot reach the Lumo API from Codex's sandbox for ${file} — run \`${refreshCommand('codex')}\` to add Lumo's Codex rules`,
    })
  }
  if (details.length > 0) row.detail = details.join('; ')
  return row
}

/**
 * The Lumo rules file (LUM-1054). Only a file carrying the Lumo marker is an
 * install; a `lumo.rules` the user wrote is theirs and not listed.
 */
function codexRulesRow(file: string): DoctorRow | null {
  const state = classifyCodexRules(file)
  if (state === 'missing' || state === 'foreign') return null
  const row: DoctorRow = {
    path: file,
    kind: 'codex-rules',
    agent: 'codex',
    tracked: isPathGitTracked(file),
    state: state === 'current' ? 'up to date' : 'outdated',
    detail:
      "`lumo` commands run outside Codex's sandbox; Codex asks before local-writing ones (loaded once the project is trusted in Codex)",
  }
  if (state === 'outdated') row.suggestion = refreshCommand('codex')
  return row
}

/**
 * The frozen skill stubs (`/lumo`, `$lumo`). A stub is listed when the file
 * exists, or when that agent's hooks are installed (then a missing one is a
 * finding); `ok` | `missing` | `differs`.
 */
function skillStubRows(
  root: string,
  haveClaude: boolean,
  haveCodex: boolean
): DoctorRow[] {
  const rows: DoctorRow[] = []
  for (const file of skillStubPaths(root)) {
    const agent = skillStubAgent(
      root,
      file,
      projectClaudeSettingsTarget(root)?.agent
    )
    const state = classifySkillStub(file)
    if (state === 'missing' && !(agent === 'codex' ? haveCodex : haveClaude))
      continue
    const row: DoctorRow = {
      path: file,
      kind: 'skill-stub',
      agent,
      tracked: state !== 'missing' && isPathGitTracked(file),
      state: state === 'current' ? 'ok' : state,
    }
    if (state !== 'current') row.suggestion = refreshCommand(agent)
    rows.push(row)
  }
  return rows
}

/** The repo's Lumo files `lumo init` writes, as rows. Never writes. */
function repoRows(
  root: string,
  home: string,
  cliVersion: string | null,
  warnings: DoctorWarning[]
): DoctorRow[] {
  const rows: Array<DoctorRow | null> = [settingsRow(root, warnings)]
  const { dir, coreHooksPath } = resolveGitHooksDir(root)
  if (dir) {
    rows.push(
      gitHookRow(
        path.join(dir, PREPARE_COMMIT_MSG_HOOK.hook),
        coreHooksPath,
        cliVersion
      )
    )
    // LUM-1258 scan hooks (opt-in): a hook file without the Lumo block is not listed.
    for (const spec of SCAN_HOOKS) {
      const file = path.join(dir, spec.hook)
      if (scanHookFor(file))
        rows.push(
          gitHookRow(file, coreHooksPath, cliVersion, spec, 'scan-hook')
        )
    }
  }
  rows.push(codexRow(codexHooksPath(root), home, warnings))
  rows.push(codexRulesRow(codexRulesPath(root)))
  const found = rows.filter((r): r is DoctorRow => r !== null)
  found.push(
    ...skillStubRows(
      root,
      found.some(r => r.kind === 'claude-settings'),
      found.some(r => r.kind === 'codex-hooks' || r.kind === 'codex-rules')
    )
  )
  return found
}

/** Gather the current repo's Lumo install. Never writes, no network. */
export function collectDoctor(deps: DoctorDeps = {}): DoctorReport {
  const home = deps.homeDir ?? os.homedir()
  const cliVersion =
    deps.cliVersion !== undefined ? deps.cliVersion : readCliVersion()
  const env = deps.env ?? process.env
  const warnings: DoctorWarning[] = []
  const root = repoRoot(deps.cwd ?? process.cwd())
  const rows = root ? repoRows(root, home, cliVersion, warnings) : []
  if (!root)
    warnings.push({
      code: 'not-a-repo',
      message:
        'not inside a git repository — Lumo hooks are set up per repo; run `lumo init` inside one',
    })
  if (!lumoOnPath(env.PATH))
    warnings.push({
      code: 'lumo-not-on-path',
      message:
        '`lumo` is not resolvable on PATH, so installed hooks cannot run; install it globally (npm install -g @lumoai/cli)',
    })
  return {
    cliVersion,
    repo: root,
    rows,
    warnings,
    autoUpdate: getAutoUpdateStatus(env),
  }
}

/** How long doctor waits for the Lumo API before calling it unreachable. */
export const API_TIMEOUT_MS = 5_000

/**
 * The default API check: `/api/auth/verify`, aborted (socket closed) after
 * `timeoutMs`, so doctor never waits on — or stays alive for — a stalled
 * server. An abort surfaces as "Could not reach Lumo API …".
 */
export async function defaultCheckApi(
  apiUrl: string,
  token: string,
  timeoutMs: number = API_TIMEOUT_MS
): Promise<void> {
  await verifyToken(apiUrl, token, { signal: AbortSignal.timeout(timeoutMs) })
}

/** Login (saved credentials) and whether the Lumo API accepts the key. */
export async function probeAuth(deps: DoctorDeps = {}): Promise<DoctorAuth> {
  const creds = (deps.credentials ?? readCredentials)()
  if (!creds) return { loggedIn: false, api: 'not-checked' }
  const base = {
    loggedIn: true,
    email: creds.email,
    workspace: creds.workspaceSlug,
  }
  let apiUrl: string
  try {
    apiUrl = resolveAuthedApiUrl(creds.apiUrl, { warn: () => {} })
  } catch (err) {
    return {
      ...base,
      apiUrl: creds.apiUrl,
      api: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  try {
    const check =
      deps.checkApi ??
      ((url: string, token: string) =>
        defaultCheckApi(url, token, deps.apiTimeoutMs ?? API_TIMEOUT_MS))
    await check(apiUrl, creds.token)
    return { ...base, apiUrl, api: 'ok' }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const api: ApiState = /invalid or revoked/i.test(detail)
      ? 'invalid-key'
      : /could not reach/i.test(detail)
        ? 'unreachable'
        : 'error'
    return { ...base, apiUrl, api, detail }
  }
}

function describeAuth(auth: DoctorAuth): string[] {
  if (!auth.loggedIn) return ['Login', '  not logged in', '  lumo auth login']
  const lines = [
    'Login',
    `  ${auth.email ?? '?'} · workspace ${auth.workspace ?? '?'}`,
    `  API ${auth.apiUrl ?? '?'}: ${auth.api}`,
  ]
  if (auth.detail) lines.push(`  ${auth.detail}`)
  if (auth.api === 'invalid-key') lines.push('  lumo auth login')
  return lines
}

function renderRows(title: string, rows: readonly DoctorRow[]): string[] {
  if (rows.length === 0) return []
  const lines = ['', title]
  for (const r of rows) {
    lines.push(`  ${r.path}`)
    lines.push(`    ${r.kind} · ${r.state}`)
    if (r.detail) lines.push(`    ${r.detail}`)
    // LUM-1232 S-1: a command sits on its own line with no arrow.
    if (r.suggestion) lines.push(`    ${r.suggestion}`)
  }
  return lines
}

function renderText(report: DoctorReport, auth: DoctorAuth): string {
  const lines: string[] = [
    `Lumo doctor — CLI ${report.cliVersion ?? 'unknown version'}`,
    describeAutoUpdate(report.autoUpdate),
    '',
    ...describeAuth(auth),
  ]
  if (report.repo) {
    lines.push('', `Repo ${report.repo}`)
    if (report.rows.length === 0)
      lines.push('  No Lumo hooks in this repo.', '  lumo init')
    lines.push(
      ...renderRows(
        'Committed (shared with the team)',
        report.rows.filter(r => r.tracked)
      ),
      ...renderRows(
        'Not committed (this checkout only)',
        report.rows.filter(r => !r.tracked)
      )
    )
  }
  if (report.warnings.length > 0) {
    lines.push('', 'Warnings')
    for (const w of report.warnings)
      lines.push(`  ${WARN_PREFIX} ${w.code}: ${w.message}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * `lumo doctor`: read-only report of the current repo's Lumo hooks, rule and
 * git hooks, plus login and API reachability; always exits 0.
 */
export async function doctor(
  options: { json?: boolean } = {},
  deps: DoctorDeps = {}
): Promise<number> {
  const report = collectDoctor(deps)
  // Probed here, not in collectDoctor: uninstall reuses the collector and must
  // not pay for an `npm root -g` spawn or an API call.
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
  const auth = await probeAuth(deps)
  process.stdout.write(
    options.json
      ? stringifyJson({ version: DOCTOR_JSON_VERSION, ...report, auth })
      : renderText(report, auth)
  )
  return 0
}
