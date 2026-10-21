import { EXIT_USAGE } from '../lib/exit-codes'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import {
  CODEX_HOOK_EVENTS,
  type mergeLumoHooks,
  type MergeStats,
} from '../lib/hooks-template'
import { codexHooksPath, codexTrustInstructions } from '../lib/codex-hooks'
import { planGitHookInstall, planHooksMerge } from '../lib/install-plan'
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
import { SCAN_HOOKS } from '../lib/scan-hook-template'
import { normalizeAgent, ENUM_TO_TOKEN, VALID_AGENT_TOKENS } from '../lib/agent'
import { configDir } from '../lib/config'
import { fetchSessionRecordNotice } from '../lib/session-record-notice'
import { isPathGitTracked, repoRoot } from '../lib/repo-root'
import {
  describeAutoUpdate,
  getAutoUpdateStatus,
  isAutoUpdateEligible,
  type AutoUpdateStatus,
  type SpawnSyncFn,
} from '../lib/auto-update'
import { findCliPackageRoot, readCliVersion } from '../lib/cli-version'
import {
  classifySkillStub,
  installSkillStub,
  skillStubPaths,
} from '../lib/skill-stub'

export type InitOptions = {
  agent?: string
  upgrade?: boolean
  dryRun?: boolean
  /** LUM-1258: also install the pre-commit / pre-push scan hooks (opt-in). */
  scanHooks?: boolean
}

/** Test seams: everything defaults to the real environment. */
export type InitDeps = {
  cliVersion?: string | null
  cwd?: string
  /** Whether the running CLI is a global npm install (auto-update only runs for those). */
  isGlobalInstall?: () => boolean
  /** Package root and spawnSync for the default eligibility probe (same seams as doctor). */
  pkgRoot?: string | null
  spawnSync?: SpawnSyncFn
}

/** LUM-1118: `lumo init --upgrade` is gone; re-running init refreshes an install. */
export const UPGRADE_REMOVED =
  '`lumo init --upgrade` was removed — re-run `lumo init` in the repo to refresh (optionally `--agent <token>`); preview it with `lumo init --dry-run`.'

/** LUM-1292: init only sets up the git repo it runs in. */
export const NOT_A_REPO =
  'lumo init sets up the current repo — run it inside a git repository.'

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
 * <token>` narrows it to that one — for a team that uses only one agent.
 */
export const DEFAULT_INIT_AGENTS = ['claude-code', 'codex'] as const

export function initAgentTokens(
  raw: string | undefined
): { tokens: string[] } | { error: string } {
  if (raw === undefined) return { tokens: [...DEFAULT_INIT_AGENTS] }
  const res = resolveAgentToken(raw)
  return 'error' in res ? res : { tokens: [res.token] }
}

/**
 * `lumo init`: write the Lumo hooks of the current git repo — Claude Code's
 * `.claude/settings.json`, Codex's `.codex/hooks.json` and
 * `.codex/rules/lumo.rules` — the frozen skill stub (`.claude/skills/lumo`,
 * `.agents/skills/lumo`) and its prepare-commit-msg hook (plus the scan
 * hooks with `--scan-hooks`). Nothing outside the repo is written.
 */
export async function init(
  options: InitOptions,
  deps: InitDeps = {}
): Promise<number> {
  if (options.upgrade) {
    process.stderr.write(`Error: ${UPGRADE_REMOVED}\n`)
    return EXIT_USAGE
  }

  const agentResult = initAgentTokens(options.agent)
  if ('error' in agentResult) {
    process.stderr.write(`Error: ${agentResult.error}\n`)
    return 1
  }
  const tokens = agentResult.tokens

  const root = repoRoot(deps.cwd ?? process.cwd())
  if (!root) {
    process.stderr.write(`Error: ${NOT_A_REPO}\n`)
    return 1
  }
  const cliVersion =
    deps.cliVersion !== undefined ? deps.cliVersion : readCliVersion()

  if (options.dryRun) {
    const items = planInit({
      tokens,
      root,
      scanHooks: options.scanHooks === true,
    })
    process.stdout.write(
      renderInitPlan(items, {
        cliVersion,
        root,
        applyCommand: initApplyCommand(options),
      })
    )
    return items.some(i => i.action === 'error') ? 1 : 0
  }

  process.stdout.write(`\nInstalling Lumo hooks for this repo: ${root}\n`)
  let stubFailures = 0

  for (const token of tokens) {
    if (tokens.length > 1) process.stdout.write(`\n${agentHeading(token)}\n`)
    else process.stdout.write('\n')
    if (token === 'codex') installCodex(root)
    else mergeHooksFile(path.join(root, '.claude', 'settings.json'), token)
    for (const file of skillStubPaths(root, [token]))
      if (!writeSkillStub(file)) stubFailures++
  }
  process.stdout.write('\n')
  installGitHook(root)
  if (options.scanHooks) {
    let installed = 0
    for (const spec of SCAN_HOOKS) if (installGitHook(root, spec)) installed++
    // Only about hooks that are in place (not a husky print-out).
    if (installed > 0)
      process.stdout.write(
        '  Scan hooks block only on a finding that would block DONE; skip once with --no-verify.\n'
      )
  }
  await printSessionRecordNotice()
  printPostInstall(tokens)
  process.stdout.write(`${describeAutoUpdate(autoUpdateForInstall(deps))}\n`)

  return stubFailures > 0 ? 1 : 0
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
function installCodex(root: string): void {
  const hooksPath = codexHooksPath(root)
  const { stats } = mergeHooksFile(hooksPath, 'codex', CODEX_HOOK_EVENTS)
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
  const res = installCodexRules(rulesPath)
  if (res === 'skipped-foreign') {
    process.stdout.write(
      `⚠ ${rulesPath} exists and was not written by Lumo — left as is, so \`lumo\` commands may not reach the Lumo API from Codex's sandbox.\n` +
        `  To use Lumo's rule instead, move that file aside and re-run \`lumo init\`.\n`
    )
  } else {
    process.stdout.write(
      res === 'unchanged'
        ? `✓ Codex rule already in place: ${rulesPath}\n`
        : `✓ wrote Codex rule: ${rulesPath}\n`
    )
    if (tracked && res !== 'unchanged')
      process.stdout.write(gitDiffNote(rulesPath))
    process.stdout.write(`${codexRulesNote(rulesPath)}\n`)
  }
  process.stdout.write(`\n${codexTrustInstructions(hooksPath)}\n`)
}

/**
 * The frozen skill stub (LUM-1292): always written, different content is
 * overwritten (no local-modification protection), identical is a no-op.
 * Returns false (error on stderr) when the file cannot be written; init then
 * finishes the other files and exits 1.
 */
function writeSkillStub(file: string): boolean {
  let res: ReturnType<typeof installSkillStub>
  let tracked = false
  try {
    tracked = classifySkillStub(file) !== 'missing' && isPathGitTracked(file)
    res = installSkillStub(file)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`Error: could not write skill stub ${file}: ${msg}\n`)
    return false
  }
  if (res === 'unchanged') {
    process.stdout.write(`✓ skill stub already up to date: ${file}\n`)
    return true
  }
  process.stdout.write(
    `✓ ${res === 'created' ? 'wrote' : 'updated'} skill stub: ${file}\n`
  )
  if (tracked) process.stdout.write(gitDiffNote(file))
  return true
}

function gitDiffNote(file: string): string {
  return `ℹ ${file} is tracked by git — the change shows up in \`git diff\`; review and commit it for your team.\n`
}

/**
 * Merge the Lumo hook entries into a hooks file — Claude Code's
 * `settings.json`, or Codex's `hooks.json` (LUM-1051) — keeping every other
 * key and non-Lumo hook as is. An existing file is rewritten only when a Lumo
 * entry was added, updated or removed (including one for an event no longer registered), so re-running init leaves it byte-identical
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
      `  removed Lumo hooks for events no longer registered: ${stats.removedEvents.join(', ')}\n`
    )
  if (tracked && changed > 0) process.stdout.write(gitDiffNote(settingsPath))
  return { path: settingsPath, stats }
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
          ? 'All set. Open Claude Code in this repo, or start a new Codex session once its hooks are trusted (above) — the Lumo hooks are installed for both.'
          : codex
            ? 'All set once the hooks are trusted (above). Start a new Codex session in this repo — the Lumo hooks are installed.'
            : 'All set. Open Claude Code in this repo — the Lumo hooks are wired in.',
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
