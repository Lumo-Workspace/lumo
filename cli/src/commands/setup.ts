import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execSync, spawnSync } from 'child_process'
import { mergeLumoHooks } from '../lib/hooks-template'
import {
  mergeGitHook,
  resolveHookInstall,
  HOOK_SCRIPT_BLOCK,
} from '../lib/git-hook-template'
import { promptLine } from '../lib/line-prompt'
import { normalizeAgent, ENUM_TO_TOKEN, VALID_AGENT_TOKENS } from '../lib/agent'
import { configDir } from '../lib/config'

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

function installSkill(claudeDir: string, force: boolean): void {
  const skillDir = path.join(claudeDir, 'skills', 'lumo')
  const skillDst = path.join(skillDir, 'SKILL.md')
  // Asset bundled in cli/assets/skill.md, shipped via package.json "files".
  // From dist/cli/src/commands/setup.js → ../../../../assets/skill.md
  const skillSrc = path.resolve(__dirname, '../../../..', 'assets', 'skill.md')

  if (!fs.existsSync(skillSrc)) {
    throw new Error(
      `Bundled skill asset missing at ${skillSrc} — reinstall @lumoai/cli.`
    )
  }

  fs.mkdirSync(skillDir, { recursive: true })

  if (fs.existsSync(skillDst) && !force) {
    const srcStat = fs.statSync(skillSrc)
    const dstStat = fs.statSync(skillDst)
    if (srcStat.size === dstStat.size) {
      const a = fs.readFileSync(skillSrc, 'utf8')
      const b = fs.readFileSync(skillDst, 'utf8')
      if (a === b) {
        process.stdout.write(`✓ skill already up to date: ${skillDst}\n`)
        return
      }
    }
    process.stdout.write(
      `⚠ ${skillDst} exists and differs from the bundled version.\n` +
        `  Re-run with --force to overwrite.\n`
    )
    return
  }

  fs.copyFileSync(skillSrc, skillDst)
  process.stdout.write(`✓ wrote skill: ${skillDst}\n`)
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
  if (gitCapture(projectRoot, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    process.stdout.write(
      '⚠ Not a git repository (or git unavailable) — skipped prepare-commit-msg hook.\n'
    )
    return
  }

  const coreHooksPath = gitCapture(projectRoot, ['config', 'core.hooksPath']) || null
  if (resolveHookInstall(coreHooksPath).mode === 'degrade') {
    printGitHookManualInstructions(coreHooksPath!)
    return
  }

  const hooksDirRaw = gitCapture(projectRoot, ['rev-parse', '--git-path', 'hooks'])
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

function printPostInstall(): void {
  const onPath = isLumoOnPath()
  const credsPath = path.join(configDir(), 'credentials.json')
  const authed = fs.existsSync(credsPath)

  process.stdout.write('\nNext steps:\n')

  if (!onPath || isRunningUnderNpx()) {
    process.stdout.write(
      '  • Install the CLI globally so Claude Code hooks can find it:\n' +
        '      npm install -g @lumoai/cli\n'
    )
  }

  if (!authed) {
    process.stdout.write(
      '  • Authenticate so the CLI can sync with the Lumo server:\n' +
        '      lumo auth login\n'
    )
  }

  if (onPath && authed && !isRunningUnderNpx()) {
    process.stdout.write(
      '  • All set. Open Claude Code in this directory — the SKILL.md and\n' +
        '    hooks are wired in.\n'
    )
  }
  process.stdout.write('\n')
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
