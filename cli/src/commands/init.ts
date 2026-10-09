import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execSync, spawnSync } from 'child_process'
import { mergeLumoHooks } from '../lib/hooks-template'
import { formatNextSteps, type NextStep } from '../lib/next-steps'
import {
  mergeGitHook,
  resolveHookInstall,
  HOOK_SCRIPT_BLOCK,
} from '../lib/git-hook-template'
import { promptLine } from '../lib/line-prompt'
import { normalizeAgent, ENUM_TO_TOKEN, VALID_AGENT_TOKENS } from '../lib/agent'
import { configDir } from '../lib/config'
import { fetchSessionRecordNotice } from '../lib/session-record-notice'
import { BUNDLED_SKILL_REL, listFiles } from '../lib/codex-plugin'
import { hashSkillDir } from '../lib/skill-hash'
import {
  readMarker,
  readRegistry,
  upsertInstall,
  writeMarker,
  type InstallRecord,
} from '../lib/install-registry'
import {
  classifySkillDir,
  isNewerVersion,
  isPathGitTracked,
} from '../lib/install-state'
import { readCliVersion } from '../lib/cli-version'
import { detectInstalledSkills } from '../lib/install-locations'

type InitOptions = {
  user?: boolean
  project?: boolean
  force?: boolean
  agent?: string
  upgrade?: boolean
}

/** Test seams: everything defaults to the real environment. */
export type InitDeps = {
  cliVersion?: string
  homeDir?: string
  cwd?: string
  bundledSkillDir?: string
}

export type SkillInstallResult =
  | 'installed'
  | 'upgraded'
  | 'up-to-date'
  | 'skipped-modified'
  | 'skipped-newer'

export type SkillInstallContext = {
  cliVersion: string
  agent: string
}

type Scope = 'user' | 'project'

/**
 * Validate the `--agent` flag and canonicalize it to the CLI token baked into
 * the hook commands. Defaults to `claude-code` — accurate today, since only
 * Claude Code emits hook events. Returns `{ error }` for an unrecognized
 * token so the caller can abort before writing settings.json.
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
  if (
    options.upgrade &&
    (options.user || options.project || options.force || options.agent)
  ) {
    process.stderr.write(
      'Error: --upgrade cannot be combined with --user, --project, --force or --agent.\n'
    )
    return 1
  }
  if (options.user && options.project) {
    process.stderr.write(
      'Error: --user and --project are mutually exclusive.\n'
    )
    return 1
  }

  const agentResult = resolveAgentToken(options.agent)
  if ('error' in agentResult) {
    process.stderr.write(`Error: ${agentResult.error}\n`)
    return 1
  }

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

  if (options.upgrade) {
    return upgradeInstalls({ cliVersion, homeDir, cwd, bundled })
  }

  const codex = agentResult.token === 'codex'
  const scope = await resolveScope(options, codex)
  if (!scope) return 130

  const root = scope === 'user' ? homeDir : cwd
  const configRoot = path.join(root, codex ? '.agents' : '.claude')

  process.stdout.write(
    `\nInstalling Lumo for ${scope} scope: ${configRoot}\n\n`
  )

  const skillDir = skillInstallDir(root, agentResult.token)
  const skillResult = installSkill(bundled, skillDir, options.force === true, {
    cliVersion,
    agent: agentResult.token,
  })
  if (isInstalledResult(skillResult)) {
    recordSkill(skillDir, scope, agentResult.token, cliVersion)
  }
  if (codex) {
    // LUM-1049: Codex reads skills natively from .agents/skills/; Lumo has no
    // Codex hook adapter yet, so nothing is written to its hook config.
    process.stdout.write(
      'ℹ Codex: Lumo hooks are not available yet — `lumo session attach` and activity capture work in Claude Code only.\n'
    )
  } else {
    const settingsPath = mergeSettings(configRoot, agentResult.token)
    recordInstall(
      'claude-settings',
      settingsPath,
      scope,
      agentResult.token,
      cliVersion
    )
  }
  if (scope === 'project') {
    const hookPath = installGitHook(root)
    if (hookPath) {
      recordInstall('git-hook', hookPath, scope, agentResult.token, cliVersion)
    }
  }
  await printSessionRecordNotice()
  printPostInstall(codex)

  return 0
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

// The skill directory bundled at the package root by scripts/bundle-assets.js
// and shipped via package.json "files".
// From dist/cli/src/commands/setup.js → ../../../../skills/lumo
function bundledSkillDir(): string {
  return path.resolve(__dirname, '../../../..', BUNDLED_SKILL_REL)
}

async function resolveScope(
  options: InitOptions,
  codex: boolean
): Promise<Scope | null> {
  if (options.user) return 'user'
  if (options.project) return 'project'

  if (!process.stdin.isTTY) {
    process.stdout.write(
      'No --user/--project flag given and stdin is not a TTY. Defaulting to --project.\n'
    )
    return 'project'
  }

  const answer = (
    await promptLine(
      codex
        ? 'Install Lumo for [u]ser (~/.agents) or [p]roject (./.agents)? [u/P]: '
        : 'Install Lumo for [u]ser (~/.claude) or [p]roject (./.claude)? [u/P]: '
    )
  ).toLowerCase()
  if (answer === 'u' || answer === 'user') return 'user'
  if (answer === '' || answer === 'p' || answer === 'project') return 'project'
  process.stderr.write(`Unrecognized choice "${answer}". Aborting.\n`)
  return null
}

function filesEqual(src: string, dst: string): boolean {
  if (!fs.existsSync(dst)) return false
  if (fs.statSync(src).size !== fs.statSync(dst).size) return false
  return fs.readFileSync(src).equals(fs.readFileSync(dst))
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
  const cls = classifySkillDir(skillDir)
  let result: SkillInstallResult = 'installed'

  // No-downgrade has no --force exception: a managed copy newer than this CLI
  // is never touched.
  const installed = cls.state === 'managed' ? (cls.version ?? '0.0.0') : null
  if (installed !== null && isNewerVersion(ctx.cliVersion, installed)) {
    process.stdout.write(
      `⚠ your CLI (${ctx.cliVersion}) is older than the installed skill (${installed}) — run lumo update\n`
    )
    return 'skipped-newer'
  }

  if (cls.state !== 'missing' && !force) {
    const allMatch = relFiles.every(rel =>
      filesEqual(path.join(skillSrcDir, rel), path.join(skillDir, rel))
    )
    if (
      allMatch ||
      (installed !== null && !isNewerVersion(installed, ctx.cliVersion))
    ) {
      if (!readMarker(skillDir)) {
        // Adopt a legacy copy: explicit command, so a tracked dir may get the marker.
        writeSkillMarker(skillDir, ctx, allMatch ? ctx.cliVersion : installed!)
        if (cls.gitTracked) process.stdout.write(gitDiffNote(skillDir))
      }
      process.stdout.write(`✓ skill already up to date: ${skillDir}\n`)
      return 'up-to-date'
    }
    if (cls.state === 'modified') {
      process.stdout.write(
        `⚠ ${skillDir} exists and differs from the bundled version (modified locally).\n` +
          `  Skipped. Re-run with --force to overwrite.\n`
      )
      return 'skipped-modified'
    }
    result = 'upgraded'
  } else if (cls.state !== 'missing') {
    result = 'upgraded'
  }

  // Fresh install, upgrade, or --force: the whole skills/lumo/ dir is
  // Lumo-managed, so replace it wholesale — stale files (top-level or under
  // references/) don't linger — then copy every bundled file.
  fs.rmSync(skillDir, { recursive: true, force: true })
  for (const rel of relFiles) {
    const dst = path.join(skillDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(skillSrcDir, rel), dst)
  }
  writeSkillMarker(skillDir, ctx, ctx.cliVersion)
  process.stdout.write(
    `✓ wrote skill (${relFiles.length} files): ${skillDir}\n`
  )
  if (cls.gitTracked) process.stdout.write(gitDiffNote(skillDir))
  return result
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
 * `lumo init --upgrade`: upgrade every known install (registry records plus
 * detected locations) that is managed and older; re-merge hooks for recorded
 * claude-settings. Modified or newer copies are skipped with a message.
 */
async function upgradeInstalls(args: {
  cliVersion: string
  homeDir: string
  cwd: string
  bundled: string
}): Promise<number> {
  const { cliVersion, homeDir, cwd, bundled } = args
  const reg = readRegistry()
  const targets = new Map<
    string,
    { path: string; scope: Scope; agent: string }
  >()
  for (const r of reg.installs) {
    if (r.kind === 'skill') {
      targets.set(r.path, { path: r.path, scope: r.scope, agent: r.agent })
    }
  }
  for (const l of detectInstalledSkills({ homeDir, cwd })) {
    if (!targets.has(l.path)) targets.set(l.path, l)
  }

  process.stdout.write('\nUpgrading Lumo installs\n\n')
  let found = 0
  let failures = 0
  const fail = (target: string, err: unknown): void => {
    failures++
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`✗ ${target}: ${msg}\n`)
  }
  for (const t of targets.values()) {
    if (!fs.existsSync(t.path)) continue
    found++
    try {
      const res = installSkill(bundled, t.path, false, {
        cliVersion,
        agent: t.agent,
      })
      if (isInstalledResult(res))
        recordSkill(t.path, t.scope, t.agent, cliVersion)
    } catch (err) {
      fail(t.path, err)
    }
  }
  for (const r of reg.installs) {
    if (r.kind !== 'claude-settings' || !fs.existsSync(r.path)) continue
    found++
    try {
      const tracked = isPathGitTracked(r.path)
      mergeSettings(path.dirname(r.path), r.agent)
      recordInstall('claude-settings', r.path, r.scope, r.agent, cliVersion)
      if (tracked) process.stdout.write(gitDiffNote(r.path))
    } catch (err) {
      fail(r.path, err)
    }
  }
  if (found === 0) {
    process.stdout.write(
      'No Lumo installs found. Run `lumo init` to install.\n'
    )
  }
  return failures > 0 ? 1 : 0
}

function mergeSettings(claudeDir: string, agentToken: string): string {
  const settingsPath = path.join(claudeDir, 'settings.json')
  let existing: unknown = {}

  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Cannot parse existing ${settingsPath}: ${msg}. Fix the JSON and re-run.`
      )
    }
  } else {
    fs.mkdirSync(claudeDir, { recursive: true })
  }

  const { merged, stats } = mergeLumoHooks(
    existing as Parameters<typeof mergeLumoHooks>[0],
    agentToken
  )
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n')

  const changed = stats.addedEvents.length + stats.updatedEvents.length
  if (changed === 0) {
    process.stdout.write(
      `✓ hooks already wired in (agent=${agentToken}): ${settingsPath} (${stats.alreadyPresent.length} events)\n`
    )
  } else {
    process.stdout.write(
      `✓ merged hooks into ${settingsPath} (agent=${agentToken}; added ${stats.addedEvents.length}, updated ${stats.updatedEvents.length}, kept ${stats.alreadyPresent.length})\n`
    )
  }
  return settingsPath
}

function gitCapture(cwd: string, args: string[]): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (res.error || res.status !== 0) return null
  return res.stdout.trim()
}

/** Returns the hook file path when Lumo's block is in place, else null. */
export function installGitHook(projectRoot: string): string | null {
  if (
    gitCapture(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true'
  ) {
    process.stdout.write(
      '⚠ Not a git repository (or git unavailable) — skipped prepare-commit-msg hook.\n'
    )
    return null
  }

  const coreHooksPath =
    gitCapture(projectRoot, ['config', 'core.hooksPath']) || null
  if (resolveHookInstall(coreHooksPath).mode === 'degrade') {
    printGitHookManualInstructions(coreHooksPath!)
    return null
  }

  const hooksDirRaw = gitCapture(projectRoot, [
    'rev-parse',
    '--git-path',
    'hooks',
  ])
  if (!hooksDirRaw) {
    process.stdout.write(
      '⚠ could not resolve git hooks dir — skipped prepare-commit-msg hook.\n'
    )
    return null
  }
  const absHooksDir = path.isAbsolute(hooksDirRaw)
    ? hooksDirRaw
    : path.join(projectRoot, hooksDirRaw)
  const hookPath = path.join(absHooksDir, 'prepare-commit-msg')

  const existing = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, 'utf8')
    : null
  const { content, status } = mergeGitHook(existing)

  if (status === 'unchanged') {
    process.stdout.write(
      `✓ prepare-commit-msg hook already up to date: ${hookPath}\n`
    )
    return hookPath
  }

  try {
    fs.mkdirSync(absHooksDir, { recursive: true })
    fs.writeFileSync(hookPath, content)
    fs.chmodSync(hookPath, 0o755)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`⚠ could not write prepare-commit-msg hook: ${msg}\n`)
    return null
  }

  const verb =
    status === 'created'
      ? 'wrote'
      : status === 'appended'
        ? 'appended to'
        : 'updated'
  process.stdout.write(`✓ ${verb} prepare-commit-msg hook: ${hookPath}\n`)
  return hookPath
}

function printGitHookManualInstructions(coreHooksPath: string): void {
  process.stdout.write(
    `\n⚠ core.hooksPath is set to "${coreHooksPath}" (husky or a custom hooks dir).\n` +
      `  Skipped auto-install to avoid clobbering it. To auto-tag commits with\n` +
      `  [LUM-N], add this block to your prepare-commit-msg hook\n` +
      `  (e.g. .husky/prepare-commit-msg), then make it executable:\n\n` +
      HOOK_SCRIPT_BLOCK +
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

function printPostInstall(codex: boolean): void {
  const onPath = isLumoOnPath()
  const credsPath = path.join(configDir(), 'credentials.json')
  const authed = fs.existsSync(credsPath)

  // LUM-686: same conditional advice, now assembled as NextStep[] and handed
  // to the shared renderer. Locally static — setup has no task state to judge.
  const steps: NextStep[] = []
  if (!onPath || isRunningUnderNpx()) {
    steps.push({
      command: 'npm install -g @lumoai/cli',
      why: codex
        ? 'install the CLI globally so Codex can run lumo commands'
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
      why: codex
        ? 'All set. Start a new Codex session in this directory — the lumo skill is installed.'
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
