import { EXIT_USAGE } from '../lib/exit-codes'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execSync, spawnSync } from 'child_process'
import {
  CODEX_HOOK_EVENTS,
  type mergeLumoHooks,
  type MergeStats,
} from '../lib/hooks-template'
import { codexHooksPath, codexTrustInstructions } from '../lib/codex-hooks'
import {
  decideSkillInstall,
  planGitHookInstall,
  planHooksMerge,
} from '../lib/install-plan'
import { planInit, renderInitPlan, initApplyCommand } from '../lib/init-dry-run'
import {
  codexRulesNote,
  codexRulesPath,
  installCodexRules,
} from '../lib/codex-rules'
import { formatNextSteps, type NextStep } from '../lib/next-steps'
import {
  PREPARE_COMMIT_MSG_HOOK,
  type GitHookSpec,
} from '../lib/git-hook-template'
import {
  SCAN_HOOKS,
  SCAN_LOG_CONFIG,
  SCAN_LOG_HOOKS,
} from '../lib/scan-hook-template'
import { normalizeAgent, ENUM_TO_TOKEN, VALID_AGENT_TOKENS } from '../lib/agent'
import { configDir } from '../lib/config'
import { fetchSessionRecordNotice } from '../lib/session-record-notice'
import { bundledSkillDir, copySkillTree, listFiles } from '../lib/codex-plugin'
import { hashSkillDir } from '../lib/skill-hash'
import {
  GIT_HOOK_AGENT,
  readMarker,
  upsertInstall,
  writeMarker,
  type InstallRecord,
} from '../lib/install-registry'
import { isPathGitTracked } from '../lib/install-state'
import {
  describeAutoUpdate,
  getAutoUpdateStatus,
  isAutoUpdateEligible,
  type AutoUpdateStatus,
  type SpawnSyncFn,
} from '../lib/auto-update'
import { findCliPackageRoot, readCliVersion } from '../lib/cli-version'
import { parseInstallScope } from '../lib/install-scope'

export type InitOptions = {
  /** LUM-1233 3g (Q6): `user | project` (was the booleans --user / --project). */
  scope?: string
  force?: boolean
  agent?: string
  upgrade?: boolean
  dryRun?: boolean
  /** LUM-1258: also install the pre-commit / pre-push scan hooks (opt-in). */
  scanHooks?: boolean
  /** LUM-1259: with --scan-hooks, also record each commit's scan on the server. */
  scanLog?: boolean
}

/** Test seams: everything defaults to the real environment. */
export type InitDeps = {
  cliVersion?: string
  homeDir?: string
  cwd?: string
  bundledSkillDir?: string
  /** Whether the running CLI is a global npm install (auto-update only runs for those). */
  isGlobalInstall?: () => boolean
  /** Package root and spawnSync for the default eligibility probe (same seams as doctor). */
  pkgRoot?: string | null
  spawnSync?: SpawnSyncFn
}

export type SkillInstallResult =
  | 'installed'
  | 'upgraded'
  | 'up-to-date'
  | 'skipped-modified'
  | 'skipped-newer'
  | 'skipped-source'

export type SkillInstallContext = {
  cliVersion: string
  agent: string
}

type Scope = 'user' | 'project'

/** LUM-1118: `lumo init --upgrade` is gone; re-running init refreshes an install. */
export const UPGRADE_REMOVED =
  '`lumo init --upgrade` was removed — re-run `lumo init` for the scope to refresh (`--scope user|project`, optionally `--agent <token>`); preview it with `lumo init --dry-run`.'

/**
 * Validate the `--agent` flag and canonicalize it to the CLI token baked into
 * the hook commands. Without the flag the token is `claude-code`; `init`
 * itself then installs every default agent (see `initAgentTokens`). Returns
 * `{ error }` for an unrecognized token so the caller can abort before
 * writing settings.json.
 */
export function resolveAgentToken(
  raw: string | undefined
): { token: string } | { error: string } {
  if (raw === undefined) return { token: 'claude-code' }
  const enumValue = normalizeAgent(raw)
  if (!enumValue) {
    return {
      error: `Unknown agent "${raw}". Valid agents: ${VALID_AGENT_TOKENS.join(', ')}.`,
    }
  }
  return { token: ENUM_TO_TOKEN[enumValue]! }
}

/**
 * LUM-1054: the agents `lumo init` sets up. No `--agent` → Claude Code and
 * Codex together (user ruling: no agent detection, always both); `--agent
 * <token>` narrows it to that one, as before.
 */
export const DEFAULT_INIT_AGENTS = ['claude-code', 'codex'] as const

export function initAgentTokens(
  raw: string | undefined
): { tokens: string[] } | { error: string } {
  if (raw === undefined) return { tokens: [...DEFAULT_INIT_AGENTS] }
  const res = resolveAgentToken(raw)
  return 'error' in res ? res : { tokens: [res.token] }
}

function requireCliVersion(): string {
  const v = readCliVersion()
  if (!v) {
    throw new Error(
      'Could not determine the @lumoai/cli version — reinstall @lumoai/cli.'
    )
  }
  return v
}

export async function init(
  options: InitOptions,
  deps: InitDeps = {}
): Promise<number> {
  if (options.upgrade) {
    process.stderr.write(`Error: ${UPGRADE_REMOVED}\n`)
    return EXIT_USAGE
  }
  if (
    options.scope !== undefined &&
    parseInstallScope(options.scope) === null
  ) {
    process.stderr.write(
      `Error: invalid --scope "${options.scope}". Valid values: user, project.\n`
    )
    return EXIT_USAGE
  }

  const agentResult = initAgentTokens(options.agent)
  if ('error' in agentResult) {
    process.stderr.write(`Error: ${agentResult.error}\n`)
    return 1
  }
  const tokens = agentResult.tokens

  const cliVersion = deps.cliVersion ?? readCliVersion()
  if (!cliVersion) {
    process.stderr.write(
      'Error: could not determine the @lumoai/cli version — reinstall @lumoai/cli.\n'
    )
    return 1
  }
  const homeDir = deps.homeDir ?? os.homedir()
  const cwd = deps.cwd ?? process.cwd()
  const bundled = deps.bundledSkillDir ?? bundledSkillDir()

  const scope = resolveScope(options)
  if (options.scanHooks && scope !== 'project') {
    process.stderr.write(
      'Error: --scan-hooks installs git hooks into this repo; it needs --scope project.\n'
    )
    return EXIT_USAGE
  }
  if (options.scanLog && !options.scanHooks) {
    process.stderr.write(
      'Error: --scan-log extends the scan hooks; pass it with --scan-hooks.\n'
    )
    return EXIT_USAGE
  }

  const root = scope === 'user' ? homeDir : cwd
  if (options.dryRun) {
    const items = planInit({
      scope,
      tokens,
      root,
      homeDir,
      bundled,
      cliVersion,
      force: options.force === true,
      scanHooks: options.scanHooks === true,
      scanLog: options.scanLog === true,
    })
    process.stdout.write(
      renderInitPlan(items, {
        cliVersion,
        home: homeDir,
        scope,
        applyCommand: initApplyCommand(scope, options),
      })
    )
    return items.some(i => i.action === 'error') ? 1 : 0
  }
  const configRoots = tokens.flatMap(t =>
    t === 'codex'
      ? [path.join(root, '.agents'), path.join(root, '.codex')]
      : [path.join(root, '.claude')]
  )

  process.stdout.write(
    `\nInstalling Lumo for ${scope} scope: ${[...new Set(configRoots)].join(', ')}\n`
  )

  for (const token of tokens) {
    if (tokens.length > 1) process.stdout.write(`\n${agentHeading(token)}\n`)
    else process.stdout.write('\n')
    const skillDir = skillInstallDir(root, token)
    const skillResult = installSkill(
      bundled,
      skillDir,
      options.force === true,
      {
        cliVersion,
        agent: token,
      }
    )
    if (isInstalledResult(skillResult)) {
      recordSkill(skillDir, scope, token, cliVersion)
    }
    if (token === 'codex') {
      installCodex(root, scope, cliVersion, options.force === true)
    } else {
      const settingsPath = path.join(root, '.claude', 'settings.json')
      mergeHooksFile(settingsPath, token)
      recordInstall('claude-settings', settingsPath, scope, token, cliVersion)
    }
  }
  if (scope === 'project') {
    process.stdout.write('\n')
    const hookPath = installGitHook(root)
    if (hookPath) {
      recordInstall('git-hook', hookPath, scope, GIT_HOOK_AGENT, cliVersion)
    }
    if (options.scanHooks) {
      for (const spec of SCAN_HOOKS) {
        const scanPath = installGitHook(root, spec)
        if (scanPath)
          recordInstall(
            'scan-hook',
            scanPath,
            scope,
            GIT_HOOK_AGENT,
            cliVersion
          )
      }
      process.stdout.write(
        '  Scan hooks block only on a finding that would block DONE; skip once with --no-verify.\n'
      )
    }
    if (options.scanLog) {
      for (const spec of SCAN_LOG_HOOKS) {
        const logPath = installGitHook(root, spec)
        if (logPath)
          recordInstall('scan-hook', logPath, scope, GIT_HOOK_AGENT, cliVersion)
      }
      enableScanLog(root)
    }
  }
  await printSessionRecordNotice()
  printPostInstall(tokens)
  process.stdout.write(`${describeAutoUpdate(autoUpdateForInstall(deps))}\n`)

  return 0
}

/**
 * Auto-update status with eligibility probed (same rule as `lumo doctor` and
 * the worker): "on" for an npm link / npx / monorepo install says it is
 * skipped instead of promising background updates.
 */
function autoUpdateForInstall(deps: InitDeps): AutoUpdateStatus {
  const status = getAutoUpdateStatus()
  if (!status.enabled) return status
  const isGlobal =
    deps.isGlobalInstall ??
    (() =>
      isAutoUpdateEligible(
        deps.pkgRoot !== undefined ? deps.pkgRoot : findCliPackageRoot(),
        deps.spawnSync
      ))
  let eligible = false
  try {
    eligible = isGlobal()
  } catch {
    // Can't tell → treat like any other non-global install (never throws).
  }
  return { ...status, eligible }
}

function agentHeading(token: string): string {
  return token === 'codex'
    ? 'Codex'
    : token === 'claude-code'
      ? 'Claude Code'
      : token
}

/**
 * Codex half of init (LUM-1051 + LUM-1054): hooks into `.codex/hooks.json`
 * (rewritten only when a Lumo entry changes, so trust survives a re-run), the
 * rules file that lets `lumo` reach the API from the sandbox, and the trust
 * instructions.
 */
function installCodex(
  root: string,
  scope: Scope,
  cliVersion: string,
  force: boolean
): void {
  const hooksPath = codexHooksPath(root)
  const { stats } = mergeHooksFile(hooksPath, 'codex', CODEX_HOOK_EVENTS)
  recordInstall('codex-hooks', hooksPath, scope, 'codex', cliVersion)
  // LUM-1112: rewriting a file that already held Lumo entries makes Codex ask
  // for trust again — name the entries it will ask about. A file without
  // Lumo entries (new, or only the user's hooks) needs a first trust instead.
  const hadLumo = stats.alreadyPresent.length + stats.updatedEvents.length > 0
  const changed = [
    ...stats.addedEvents.map(e => `${e} (added)`),
    ...stats.updatedEvents.map(e => `${e} (updated)`),
  ]
  if (hadLumo && changed.length > 0)
    process.stdout.write(
      `  Codex will ask to trust them again — re-trust in Codex /hooks. Events to trust again: ${changed.join(', ')}\n`
    )

  const rulesPath = codexRulesPath(root)
  const tracked = fs.existsSync(rulesPath) && isPathGitTracked(rulesPath)
  const res = installCodexRules(rulesPath, force)
  if (res === 'skipped-foreign') {
    process.stdout.write(
      `⚠ ${rulesPath} exists and was not written by Lumo — left as is, so server-only \`lumo\` commands may not reach the Lumo API from Codex's sandbox.\n` +
        `  Re-run with --force to replace it with Lumo's rules.\n`
    )
  } else {
    process.stdout.write(
      res === 'unchanged'
        ? `✓ Codex rule already in place: ${rulesPath}\n`
        : `✓ wrote Codex rule: ${rulesPath}\n`
    )
    if (tracked && res !== 'unchanged')
      process.stdout.write(gitDiffNote(rulesPath))
    recordInstall('codex-rules', rulesPath, scope, 'codex', cliVersion)
    process.stdout.write(`${codexRulesNote(rulesPath, scope)}\n`)
  }
  process.stdout.write(`\n${codexTrustInstructions(hooksPath)}\n`)
}

/**
 * Where setup installs the lumo skill: Codex loads skills from
 * `<root>/.agents/skills/` (repo or ~), every other agent token keeps the
 * Claude Code layout `<root>/.claude/skills/`.
 */
export function skillInstallDir(root: string, agentToken: string): string {
  return agentToken === 'codex'
    ? path.join(root, '.agents', 'skills', 'lumo')
    : path.join(root, '.claude', 'skills', 'lumo')
}

/**
 * The scope init installs into: `--scope`, else `project` — never an
 * interactive question (LUM-1233 follow-up, CF-1: no prompt anywhere), on a
 * TTY or not. The default is said in one line so it is never a surprise.
 */
export function resolveScope(options: InitOptions): Scope {
  const given = parseInstallScope(options.scope)
  if (given) return given
  process.stdout.write(
    'No --scope given: installing for this repo (--scope project). Pass --scope user to install for every project.\n'
  )
  return 'project'
}

function isInstalledResult(r: SkillInstallResult): boolean {
  return r === 'installed' || r === 'upgraded' || r === 'up-to-date'
}

function recordInstall(
  kind: InstallRecord['kind'],
  installPath: string,
  scope: Scope,
  agent: string,
  version: string,
  hash?: string
): void {
  upsertInstall({
    kind,
    path: installPath,
    scope,
    agent,
    version,
    ...(hash ? { hash } : {}),
    installedAt: new Date().toISOString(),
  })
}

/** Registry record for a skill dir, using the version/hash its marker holds. */
function recordSkill(
  skillDir: string,
  scope: Scope,
  agent: string,
  fallbackVersion: string
): void {
  const marker = readMarker(skillDir)
  recordInstall(
    'skill',
    skillDir,
    scope,
    agent,
    marker?.version ?? fallbackVersion,
    marker?.hash
  )
}

function gitDiffNote(skillDir: string): string {
  return `ℹ ${skillDir} is tracked by git — the change shows up in \`git diff\`; review and commit it for your team.\n`
}

/**
 * Install or upgrade the bundled skill into `skillDir`.
 *
 * - missing → install; `managed` + bundled newer → replace the whole dir
 *   (explicit user command, so git-tracked paths may be written);
 * - same version → up to date; installed newer than the CLI → skip (never
 *   downgrade); `modified` → skip unless `force`.
 * A marker (`.lumo-install.json`) is written after every write.
 */
export function installSkill(
  skillSrcDir: string,
  skillDir: string,
  force: boolean,
  ctx: SkillInstallContext = {
    cliVersion: requireCliVersion(),
    agent: 'claude-code',
  }
): SkillInstallResult {
  if (!fs.existsSync(path.join(skillSrcDir, 'SKILL.md'))) {
    throw new Error(
      `Bundled skill asset missing at ${skillSrcDir} — reinstall @lumoai/cli.`
    )
  }

  const relFiles = listFiles(skillSrcDir)
  const decision = decideSkillInstall(
    skillSrcDir,
    skillDir,
    force,
    ctx.cliVersion
  )
  switch (decision.kind) {
    case 'skipped-source':
      // The Lumo repo's own .claude/skills/lumo is the skill source: never write it.
      process.stdout.write(
        `ℹ ${skillDir} is the Lumo skill source (not an install) — left untouched.\n`
      )
      return 'skipped-source'
    case 'skipped-newer':
      // No-downgrade has no --force exception.
      process.stdout.write(
        `⚠ your CLI (${ctx.cliVersion}) is older than the installed skill (${decision.installed}) — run lumo update\n`
      )
      return 'skipped-newer'
    case 'up-to-date':
      if (decision.adoptVersion !== null) {
        // Adopt a legacy copy: explicit command, so a tracked dir may get the marker.
        writeSkillMarker(skillDir, ctx, decision.adoptVersion)
        if (decision.gitTracked) process.stdout.write(gitDiffNote(skillDir))
      }
      process.stdout.write(`✓ skill already up to date: ${skillDir}\n`)
      return 'up-to-date'
    case 'skipped-modified':
      process.stdout.write(
        `⚠ ${skillDir} exists and differs from the bundled version (modified locally).\n` +
          `  Skipped. Re-run with --force to overwrite.\n`
      )
      return 'skipped-modified'
  }

  // Fresh install, upgrade, or --force: the whole skills/lumo/ dir is
  // Lumo-managed, so replace it wholesale — stale files (top-level or under
  // references/) don't linger — then copy every bundled file.
  copySkillTree(skillSrcDir, skillDir)
  writeSkillMarker(skillDir, ctx, ctx.cliVersion)
  process.stdout.write(
    `✓ wrote skill (${relFiles.length} files): ${skillDir}\n`
  )
  if (decision.gitTracked) process.stdout.write(gitDiffNote(skillDir))
  return decision.result
}

function writeSkillMarker(
  skillDir: string,
  ctx: SkillInstallContext,
  version: string
): void {
  writeMarker(skillDir, {
    version,
    hash: hashSkillDir(skillDir),
    agent: ctx.agent,
    installedAt: new Date().toISOString(),
  })
}

/**
 * Merge the Lumo hook entries into a hooks file — Claude Code's
 * `settings.json`, or Codex's `hooks.json` (LUM-1051) — keeping every other
 * key and non-Lumo hook as is. An existing file is rewritten only when a Lumo
 * entry was added, updated or removed (a retired event, LUM-1235), so re-running init leaves it byte-identical
 * (Codex re-asks for trust after any change).
 */
export function mergeHooksFile(
  settingsPath: string,
  agentToken: string,
  events?: Parameters<typeof mergeLumoHooks>[2],
  opts: { quiet?: boolean } = {}
): { path: string; stats: MergeStats } {
  const plan = planHooksMerge(settingsPath, agentToken, events)
  const { exists, merged, stats } = plan
  const changed =
    stats.addedEvents.length +
    stats.updatedEvents.length +
    stats.removedEvents.length
  const tracked = exists && isPathGitTracked(settingsPath)
  if (plan.writes) {
    if (!exists) fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n')
  }
  if (opts.quiet) return { path: settingsPath, stats }

  if (changed === 0) {
    process.stdout.write(
      `✓ hooks already wired in (agent=${agentToken}): ${settingsPath} (${stats.alreadyPresent.length} events)\n`
    )
  } else {
    process.stdout.write(
      `✓ merged hooks into ${settingsPath} (agent=${agentToken}; added ${stats.addedEvents.length}, updated ${stats.updatedEvents.length}, kept ${stats.alreadyPresent.length}${stats.removedEvents.length > 0 ? `, removed ${stats.removedEvents.length}` : ''})\n`
    )
  }
  if (stats.removedEvents.length > 0)
    process.stdout.write(
      `  removed retired Lumo hooks: ${stats.removedEvents.join(', ')} (they replaced Claude Code's own worktree creation)\n`
    )
  if (tracked && changed > 0) process.stdout.write(gitDiffNote(settingsPath))
  return { path: settingsPath, stats }
}

/**
 * LUM-1259 — turn the local scan log on for this repo (`git config
 * lumo.scanLog true`, repo-local): the post-commit and pre-push hooks then
 * record each commit's scan on the server. The server stores it only when
 * the workspace opted in.
 */
function enableScanLog(root: string): void {
  const r = spawnSync('git', ['config', SCAN_LOG_CONFIG, 'true'], {
    cwd: root,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    process.stdout.write(
      `⚠ could not set git config ${SCAN_LOG_CONFIG}: ${(r.stderr || '').trim() || 'git config failed'}\n`
    )
    return
  }
  process.stdout.write(
    `✓ local scan log on for this repo (git config ${SCAN_LOG_CONFIG} true)\n` +
      '  Each commit’s scan result is recorded on the Lumo server once your workspace opts in\n' +
      '  (an OWNER: lumo workspace security-scan update --local-scan-log on). Results are LOCAL:\n' +
      `  they never block or clear DONE. Off: git config ${SCAN_LOG_CONFIG} false\n`
  )
}

/**
 * Returns the hook file path when Lumo's block is in place, else null.
 * `spec` picks the hook: prepare-commit-msg, or a scan hook (LUM-1258).
 */
export function installGitHook(
  projectRoot: string,
  spec: GitHookSpec = PREPARE_COMMIT_MSG_HOOK
): string | null {
  const name = spec.hook
  const plan = planGitHookInstall(projectRoot, spec)
  switch (plan.status) {
    case 'not-repo':
      process.stdout.write(
        `⚠ Not a git repository (or git unavailable) — skipped ${name} hook.\n`
      )
      return null
    case 'degrade':
      printGitHookManualInstructions(plan.coreHooksPath, spec)
      return null
    case 'no-dir':
      process.stdout.write(
        `⚠ could not resolve git hooks dir — skipped ${name} hook.\n`
      )
      return null
    case 'unchanged':
      process.stdout.write(
        `✓ ${name} hook already up to date: ${plan.hookPath}\n`
      )
      return plan.hookPath
  }

  const { hookPath, content, status } = plan
  try {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true })
    fs.writeFileSync(hookPath, content)
    fs.chmodSync(hookPath, 0o755)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`⚠ could not write ${name} hook: ${msg}\n`)
    return null
  }

  const verb =
    status === 'created'
      ? 'wrote'
      : status === 'appended'
        ? 'appended to'
        : 'updated'
  process.stdout.write(`✓ ${verb} ${name} hook: ${hookPath}\n`)
  return hookPath
}

function printGitHookManualInstructions(
  coreHooksPath: string,
  spec: GitHookSpec
): void {
  process.stdout.write(
    `\n⚠ core.hooksPath is set to "${coreHooksPath}" (husky or a custom hooks dir).\n` +
      `  Skipped auto-install to avoid clobbering it. To ${spec.purpose},\n` +
      `  add this block to your ${spec.hook} hook\n` +
      `  (e.g. .husky/${spec.hook}), then make it executable:\n\n` +
      spec.block +
      `\n\n`
  )
}

/**
 * LUM-943: tell the member how their workspace keeps session records (mode,
 * retention, where an OWNER changes it). Prints nothing when the notice can't
 * be fetched — not logged in, offline, an older server — so init never fails
 * or stalls on it.
 */
export async function printSessionRecordNotice(
  fetchNotice: () => Promise<string | null> = fetchSessionRecordNotice
): Promise<void> {
  let notice: string | null = null
  try {
    notice = await fetchNotice()
  } catch {
    notice = null
  }
  if (notice) process.stdout.write(`\nℹ ${notice}\n`)
}

function printPostInstall(tokens: readonly string[]): void {
  const onPath = isLumoOnPath()
  const credsPath = path.join(configDir(), 'credentials.json')
  const authed = fs.existsSync(credsPath)
  const codex = tokens.includes('codex')
  const claude = tokens.some(t => t !== 'codex')

  // LUM-686: same conditional advice, now assembled as NextStep[] and handed
  // to the shared renderer. Locally static — setup has no task state to judge.
  const steps: NextStep[] = []
  if (!onPath || isRunningUnderNpx()) {
    steps.push({
      command: 'npm install -g @lumoai/cli',
      why:
        codex && claude
          ? 'install the CLI globally so Claude Code, Codex and their hooks can run lumo'
          : codex
            ? 'install the CLI globally so Codex and its hooks can run lumo'
            : 'install the CLI globally so Claude Code hooks can find it',
    })
  }
  if (!authed) {
    steps.push({
      command: 'lumo auth login',
      why: 'authenticate so the CLI can sync with the Lumo server',
    })
  }
  if (onPath && authed && !isRunningUnderNpx()) {
    steps.push({
      command: null,
      why:
        codex && claude
          ? 'All set. Open Claude Code in this directory, or start a new Codex session once its hooks are trusted (above) — the lumo skill and hooks are installed for both.'
          : codex
            ? 'All set once the hooks are trusted (above). Start a new Codex session in this directory — the lumo skill and hooks are installed.'
            : 'All set. Open Claude Code in this directory — the SKILL.md and hooks are wired in.',
    })
  }
  process.stdout.write(`\n${formatNextSteps(steps)}\n\n`)
}

function isLumoOnPath(): boolean {
  try {
    // `command -v` is a POSIX shell builtin (`execSync` defaults to /bin/sh
    // on Unix). `where` is a cmd.exe builtin on Windows.
    execSync(process.platform === 'win32' ? 'where lumo' : 'command -v lumo', {
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function isRunningUnderNpx(): boolean {
  const argv1 = process.argv[1] || ''
  return /[\\/]_npx[\\/]/.test(argv1) || process.env.npm_command === 'exec'
}
