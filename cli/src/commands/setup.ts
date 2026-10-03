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

type SetupOptions = {
  user?: boolean
  project?: boolean
  force?: boolean
  agent?: string
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

export async function setup(options: SetupOptions): Promise<number> {
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

  const scope = await resolveScope(options)
  if (!scope) return 130

  const root = scope === 'user' ? os.homedir() : process.cwd()
  const claudeDir = path.join(root, '.claude')

  process.stdout.write(`\nInstalling Lumo for ${scope} scope: ${claudeDir}\n\n`)

  installSkill(claudeDir, options.force === true)
  mergeSettings(claudeDir, agentResult.token)
  if (scope === 'project') {
    installGitHook(root)
  }
  await printSessionRecordNotice()
  printPostInstall()

  return 0
}

async function resolveScope(options: SetupOptions): Promise<Scope | null> {
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
      'Install Lumo for [u]ser (~/.claude) or [p]roject (./.claude)? [u/P]: '
    )
  ).toLowerCase()
  if (answer === 'u' || answer === 'user') return 'user'
  if (answer === '' || answer === 'p' || answer === 'project') return 'project'
  process.stderr.write(`Unrecognized choice "${answer}". Aborting.\n`)
  return null
}

// Recursively list files under `dir` as paths relative to `base`.
function listSkillFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSkillFiles(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full))
  }
  return out
}

function filesEqual(src: string, dst: string): boolean {
  if (!fs.existsSync(dst)) return false
  if (fs.statSync(src).size !== fs.statSync(dst).size) return false
  return fs.readFileSync(src).equals(fs.readFileSync(dst))
}

function installSkill(claudeDir: string, force: boolean): void {
  const skillDir = path.join(claudeDir, 'skills', 'lumo')
  const skillDstMain = path.join(skillDir, 'SKILL.md')
  // The skill is a directory (SKILL.md + references/*.md) bundled in
  // cli/assets/skill/, shipped via package.json "files".
  // From dist/cli/src/commands/setup.js → ../../../../assets/skill
  const skillSrcDir = path.resolve(__dirname, '../../../..', 'assets', 'skill')

  if (!fs.existsSync(path.join(skillSrcDir, 'SKILL.md'))) {
    throw new Error(
      `Bundled skill asset missing at ${skillSrcDir} — reinstall @lumoai/cli.`
    )
  }

  const relFiles = listSkillFiles(skillSrcDir)

  // Non-force, install already present: only overwrite when something differs,
  // and then only with --force.
  if (fs.existsSync(skillDstMain) && !force) {
    const allMatch = relFiles.every(rel =>
      filesEqual(path.join(skillSrcDir, rel), path.join(skillDir, rel))
    )
    if (allMatch) {
      process.stdout.write(`✓ skill already up to date: ${skillDir}\n`)
      return
    }
    process.stdout.write(
      `⚠ ${skillDir} exists and differs from the bundled version.\n` +
        `  Re-run with --force to overwrite.\n`
    )
    return
  }

  // Fresh install or --force: replace the managed references/ dir wholesale so
  // stale reference files don't linger, then copy every bundled file.
  fs.rmSync(path.join(skillDir, 'references'), { recursive: true, force: true })
  for (const rel of relFiles) {
    const dst = path.join(skillDir, rel)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(path.join(skillSrcDir, rel), dst)
  }
  process.stdout.write(
    `✓ wrote skill (${relFiles.length} files): ${skillDir}\n`
  )
}

function mergeSettings(claudeDir: string, agentToken: string): void {
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
}

function gitCapture(cwd: string, args: string[]): string | null {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (res.error || res.status !== 0) return null
  return res.stdout.trim()
}

export function installGitHook(projectRoot: string): void {
  if (
    gitCapture(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true'
  ) {
    process.stdout.write(
      '⚠ Not a git repository (or git unavailable) — skipped prepare-commit-msg hook.\n'
    )
    return
  }

  const coreHooksPath =
    gitCapture(projectRoot, ['config', 'core.hooksPath']) || null
  if (resolveHookInstall(coreHooksPath).mode === 'degrade') {
    printGitHookManualInstructions(coreHooksPath!)
    return
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
    return
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
    return
  }

  try {
    fs.mkdirSync(absHooksDir, { recursive: true })
    fs.writeFileSync(hookPath, content)
    fs.chmodSync(hookPath, 0o755)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stdout.write(`⚠ could not write prepare-commit-msg hook: ${msg}\n`)
    return
  }

  const verb =
    status === 'created'
      ? 'wrote'
      : status === 'appended'
        ? 'appended to'
        : 'updated'
  process.stdout.write(`✓ ${verb} prepare-commit-msg hook: ${hookPath}\n`)
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
 * be fetched — not logged in, offline, an older server — so setup never fails
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

function printPostInstall(): void {
  const onPath = isLumoOnPath()
  const credsPath = path.join(configDir(), 'credentials.json')
  const authed = fs.existsSync(credsPath)

  // LUM-686: same conditional advice, now assembled as NextStep[] and handed
  // to the shared renderer. Locally static — setup has no task state to judge.
  const steps: NextStep[] = []
  if (!onPath || isRunningUnderNpx()) {
    steps.push({
      command: 'npm install -g @lumoai/cli',
      why: 'install the CLI globally so Claude Code hooks can find it',
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
      why: 'All set. Open Claude Code in this directory — the SKILL.md and hooks are wired in.',
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
