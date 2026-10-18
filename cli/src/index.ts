#!/usr/bin/env node
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Command, Option } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'
import { installAuthFailureTracker } from './lib/auth-failure'
import { installSandboxNetworkTracker } from './lib/sandbox-network-hint'
import {
  commandPathOf,
  installVersionCompatTracker,
} from './lib/version-compat'
import { hookCommand } from './commands/hook'
import type { HookPath } from './lib/hook-runner'
import { sessionAttach } from './commands/session-attach'
import { sessionStatus } from './commands/session-status'
import { usageResync } from './commands/usage-resync'
import { status, type StatusOptions } from './commands/status'
import { usageShow, type UsageShowOptions } from './commands/usage'
import { priorityCreate, priorityList } from './commands/priority'
import {
  crossingExplain,
  type CrossingExplainOptions,
} from './commands/crossing-explain'
import {
  crossingDisposition,
  type CrossingDispositionOptions,
} from './commands/crossing-disposition'
import {
  crossingList,
  type CrossingListOptions,
} from './commands/crossing-list'
import { taskCreate } from './commands/task-create'
import { taskUpdate } from './commands/task-update'
import { taskList } from './commands/task-list'
import { taskSearch } from './commands/task-search'
import { taskStatuses } from './commands/task-statuses'
import { taskTemplateList } from './commands/task-template-list'
import {
  taskTemplateShow,
  taskTemplateCreate,
  taskTemplateEdit,
  taskTemplateRm,
} from './commands/task-template-manage'
import { taskDecide } from './commands/task-decide'
import { memberList } from './commands/member-list'
import { projectOverview } from './commands/overview'
import { auditList, type AuditListOptions } from './commands/audit-list'
import { tagCreate, tagList } from './commands/tag'
import { taskDelete } from './commands/task-delete'
import { projectCreate, projectUpdate } from './commands/project-manage'
import { taskShow, type TaskShowOptions } from './commands/task-show'
import { findRemovedCommand, removedCommandLines } from './lib/removed-commands'
import { taskStatus } from './commands/task-status'
import { taskComment } from './commands/task-comment'
import { taskFigmaAdd } from './commands/task-figma-add'
import { taskFigmaList } from './commands/task-figma-list'
import { taskFigmaRm } from './commands/task-figma-rm'
import { taskFigmaRefresh } from './commands/task-figma-refresh'
import { memoryAdd, memoryList, memoryUpdate } from './commands/memory'
import { memoryDelete } from './commands/memory-delete'
import { memoryShow } from './commands/memory-show'
import { memorySync } from './commands/memory-sync'
import { memoryPush } from './commands/memory-push'
import { memoryFold } from './commands/memory-fold'
import { taskArtifactAdd } from './commands/task-artifact-add'
import { taskArtifactList } from './commands/task-artifact-list'
import { taskArtifactShow } from './commands/task-artifact-show'
import { taskArtifactRm } from './commands/task-artifact-rm'
import { taskArtifactUpdate } from './commands/task-artifact-update'
import {
  testCaseAdd,
  testCaseDelete,
  testCaseDisposition,
  testCaseDownload,
  testCaseList,
  testCaseRun,
  testCaseShow,
  testCaseUpdate,
  type TestCaseParentKind,
} from './commands/testcase'
import {
  findingDisposition,
  type FindingDispositionOptions,
} from './commands/finding-disposition'
import { taskSlackShow } from './commands/task-slack-show'
import { taskWebShow } from './commands/task-web-show'
import { taskFigmaContext } from './commands/task-figma-context'
import { taskCommentEdit, taskCommentRm } from './commands/task-comment-manage'
import {
  taskDepsAdd,
  taskDepsConfirm,
  taskDepsDismiss,
  taskDepsRm,
} from './commands/task-deps'
import { taskPrShow } from './commands/task-pr-show'
import {
  prReview,
  prShow,
  type PrReviewOptions,
  type PrShowOptions,
} from './commands/pr-scan'
import {
  workspaceSecurityScan,
  type WorkspaceSecurityScanOptions,
} from './commands/workspace-security-scan'
import { projectList } from './commands/project-list'
import { milestoneList } from './commands/milestone-list'
import { milestoneCreate } from './commands/milestone-create'
import { milestoneShow } from './commands/milestone-show'
import { milestoneUpdate } from './commands/milestone-update'
import { milestoneDelete } from './commands/milestone-delete'
import { milestoneArchive } from './commands/milestone-archive'
import { milestoneUnarchive } from './commands/milestone-unarchive'
import { milestoneAdd } from './commands/milestone-add'
import { milestoneRemove } from './commands/milestone-remove'
import { milestoneTriage } from './commands/milestone-triage'
import { milestoneSummary } from './commands/milestone-summary'
import { milestoneChangelog } from './commands/milestone-changelog'
import { milestoneReorder } from './commands/milestone-reorder'
import { milestoneMove } from './commands/milestone-move'
import { sprintCreate } from './commands/sprint-create'
import { sprintList } from './commands/sprint-list'
import { sprintShow } from './commands/sprint-show'
import { sprintUpdate } from './commands/sprint-update'
import { sprintDelete } from './commands/sprint-delete'
import { sprintStart } from './commands/sprint-start'
import { sprintClose } from './commands/sprint-close'
import { sprintSummary } from './commands/sprint-summary'
import { sprintAdd } from './commands/sprint-add'
import { sprintRemove } from './commands/sprint-remove'
import { docCreate } from './commands/doc-create'
import {
  docImportGdoc,
  type ImportGdocOptions,
} from './commands/doc-import-gdoc'
import { docSync } from './commands/doc-sync'
import { docDiff } from './commands/doc-diff'
import { docRebuildSource } from './commands/doc-rebuild-source'
import { docPatch, docAppend } from './commands/doc-section-edit'
import { docList } from './commands/doc-list'
import { docDelete } from './commands/doc-delete'
import {
  docShowWithMembers,
  docUpdateWithRelations,
} from './commands/doc-relations'
import { docMove } from './commands/doc-move'
import { update } from './commands/update'
import { init } from './commands/init'
import { doctor } from './commands/doctor'
import { skillStatus, skillUpdate } from './commands/skill'
import { uninstall } from './commands/uninstall'
import { worktreeAdd } from './commands/worktree-add'
import { worktreeRm } from './commands/worktree-rm'
import { worktreeList } from './commands/worktree-list'
import { worktreePrune } from './commands/worktree-prune'
import {
  maybeRefreshInBackground,
  printUpdateNoticeIfAny,
  runBackgroundRefresh,
} from './lib/update-check'
import { finalizeErrorOutput, installErrorOutput } from './lib/error-output'
import { EXIT_ERROR, EXIT_USAGE } from './lib/exit-codes'
import { attachHelpSections } from './lib/help-text'
import { describeThrownError } from './lib/errors'
import {
  maybeAutoSync,
  shouldAutoSync,
  shouldCheckForUpdates,
} from './lib/auto-sync'

// Introspection mode: tooling (CLI grammar extraction) imports
// this module to walk the registered commander tree without running the CLI.
// Skips package.json resolution (which assumes the compiled dist/ layout),
// update checks, local-state cleanup, and parseAsync. Never set for real runs.
const isIntrospect = process.env.LUMO_CLI_INTROSPECT === '1'

// Resolve package.json relative to __dirname so this works regardless of how
// deep the compiled output ends up (flat dist/ or nested dist/cli/src/).
const pkg = isIntrospect
  ? { name: '@lumoai/cli', version: '0.0.0-introspect' }
  : (require(path.resolve(__dirname, '../../..', 'package.json')) as {
      name: string
      version: string
    })

// Detached background-refresh worker: re-entry point for the spawn() in
// maybeRefreshInBackground(). Fetches latest, writes cache, exits — skipping
// commander.parseAsync() below.
const isUpdateCheckWorker =
  process.argv[2] === '__update-check' && !!process.argv[3]

if (isUpdateCheckWorker) {
  runBackgroundRefresh(process.argv[3] as string, pkg.version)
    .catch(() => {})
    .finally(() => process.exit(0))
} else if (!isIntrospect) {
  // Not for `uninstall`: the background worker could reinstall the CLI after
  // `npm rm -g` or recreate ~/.lumo after `--purge`.
  if (shouldCheckForUpdates(process.argv)) {
    printUpdateNoticeIfAny(pkg.name, pkg.version)
    maybeRefreshInBackground(pkg.name)
  }
  // First run of a new version: refresh user-scope installs. Silent for
  // `lumo hook …` (its output is consumed by the agent). Skipped entirely for
  // read-only `doctor` and `uninstall`. Never throws.
  if (shouldAutoSync(process.argv))
    maybeAutoSync(pkg.version, { quiet: process.argv[2] === 'hook' })
}

// LUM-1232 batch E: one error shape on stderr (`Error:` / `Usage:` / `Hint:`),
// and with `--json` one JSON error object instead. Installed before the
// trackers below so they still see every line. Not for `lumo hook …` (its
// stderr is read by the agent harness as-is).
if (!isIntrospect && !isUpdateCheckWorker && process.argv[2] !== 'hook') {
  installErrorOutput({ json: process.argv.slice(2).includes('--json') })
}

// LUM-843: a 401 that a command reported only as `HTTP 401` still ends with
// the `lumo auth login` remediation, so agents need no whoami pre-probe.
const authTracker =
  !isIntrospect && !isUpdateCheckWorker ? installAuthFailureTracker() : null
// LUM-1054: inside Codex's sandbox (no network) an unreachable API ends with
// the cause and the fix instead of a bare `fetch failed`.
const sandboxNetTracker =
  !isIntrospect && !isUpdateCheckWorker ? installSandboxNetworkTracker() : null
// LUM-1110: every API request carries X-Lumo-Cli-Version; a 426 (CLI too old)
// ends with `lumo update`, a route-missing 404 with "server may not have
// deployed this yet" instead of a bare HTTP 404.
const versionTracker =
  !isIntrospect && !isUpdateCheckWorker
    ? installVersionCompatTracker(pkg.version)
    : null

/** The command being run (set in preAction; null before parsing finishes). */
let currentCommand: CommandLike | null = null

interface CommandLike {
  name(): string
  usage(): string
  parent: unknown
  commands: readonly CommandLike[]
  aliases(): string[]
}

/** `Usage:` / `--help` context for the failing command, if known. */
function usageContext(cmd: CommandLike | null): {
  usage: string | null
  helpCommand: string | null
} {
  if (!cmd) return { usage: null, helpCommand: null }
  const path = commandPathOf(cmd)
  const base = path ? `lumo ${path}` : 'lumo'
  return { usage: `${base} ${cmd.usage()}`, helpCommand: base }
}

/**
 * The deepest registered command named by argv (options skipped) — what a
 * Commander parse error is about, since preAction never ran for it.
 */
function commandFromArgv(root: CommandLike, argv: string[]): CommandLike {
  let node = root
  for (const tok of argv) {
    if (tok.startsWith('-')) continue
    const next = node.commands.find(
      c => c.name() === tok || c.aliases().includes(tok)
    )
    if (!next) break
    node = next
  }
  return node
}

function exitWith(code: number): never {
  const hint = authTracker?.hintFor(code)
  if (hint) console.error(hint)
  const netHint = sandboxNetTracker?.hintFor(code)
  if (netHint) console.error(netHint)
  const versionHint = versionTracker?.hintFor(code)
  if (versionHint) console.error(versionHint)
  finalizeErrorOutput(code, usageContext(currentCommand))
  process.exit(code)
}

// One-shot cleanup of pre-LUM-46 local state. The session→task binding
// is now server-authoritative; the legacy global pointer and the
// per-session sentinel directory are both obsolete. Failures are
// swallowed so a permission glitch doesn't prevent CLI invocation.
if (!isIntrospect) {
  const dir = process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
  try {
    fs.rmSync(path.join(dir, 'current-task.json'), { force: true })
  } catch {}
  try {
    fs.rmSync(path.join(dir, 'sessions'), { recursive: true, force: true })
  } catch {}
}

const collect = (val: string, acc: string[]): string[] => [...acc, val]
// LUM-1143: like `collect`, but an absent flag stays undefined ("leave the
// list alone") while a given one — even "" — replaces it.
const collectList = (val: string, acc: string[] | undefined): string[] => [
  ...(acc ?? []),
  val,
]

type CommandFn = (...args: unknown[]) => Promise<number | void>

/**
 * Exit-code convention (LUM-755). A command returns the code to propagate:
 * (LUM-1232: the constants live in cli/src/lib/exit-codes.ts.)
 *   0 / undefined  success
 *   1              general error (message on stderr): not found, auth,
 *                  permission, server, network
 *   2              usage error — unknown flag, missing / extra argument,
 *                  invalid flag value — caught before any network call
 *                  (`Error:` + `Usage:` + `Hint:` on stderr)
 *   4              confirmation required — a mutation that needs the user's
 *                  approval printed a `confirmation_required` envelope on
 *                  stdout (see cli/src/lib/confirmation.ts); re-run the
 *                  envelope's `confirmCommand` once the user has approved
 *   5              blocked by a human-only gate — the server refused the
 *                  change (today: a DONE gate) and the CLI printed a
 *                  `DONE_BLOCKED` error on stdout listing every blocker
 *                  (see cli/src/lib/blocked-error.ts); nothing on the CLI
 *                  can clear it — relay it, don't retry
 * 3 is reserved. Lumo's 4 is not gh's 4 (gh: authentication required).
 */
function wrap(fn: CommandFn) {
  return async (...args: unknown[]) => {
    try {
      const code = await fn(...args)
      if (typeof code === 'number' && code !== 0) exitWith(code)
    } catch (err) {
      // LUM-1232 X-3: a thrown git / tool message is wrapped, never passed
      // through as the whole error.
      for (const line of describeThrownError(err)) console.error(line)
      exitWith(EXIT_ERROR)
    }
  }
}

const program = new Command()
  .name('lumo')
  .description('Lumo CLI — manage tasks and sessions from the terminal')
  .version(pkg.version)
  // Make usage errors actionable for agents: suggest near-miss spellings and
  // point at --help instead of dead-ending on "unknown option". Subcommands
  // created via .command() inherit these settings.
  .showSuggestionAfterError(true)
  // LUM-1233 3g: every command's --help lists the global flags (--project,
  // --no-hints) under "Global Options"; subcommands inherit the setting.
  .configureHelp({ showGlobalOptions: true })
  // LUM-1232 batch E: a parse error prints `Error: …`, then `Usage:` and a
  // `Hint:` pointing at --help (added by finalizeErrorOutput), and exits 2.
  // Subcommands inherit both settings.
  .configureOutput({
    outputError: (str, write) => write(str.replace(/^error: /, 'Error: ')),
  })
  .exitOverride(err => {
    if (err.exitCode === 0) process.exit(0) // --help / --version
    finalizeErrorOutput(
      EXIT_USAGE,
      usageContext(
        commandFromArgv(
          program as unknown as CommandLike,
          // What was actually parsed (== process.argv for the real CLI).
          (
            (program as unknown as { rawArgs?: string[] }).rawArgs ??
            process.argv
          ).slice(2)
        )
      )
    )
    process.exit(EXIT_USAGE)
  })
  // LUM-686: global mute for the trailing next-step block. `LUMO_NO_HINTS=1`
  // does the same for a whole shell.
  .option('--no-hints', 'suppress the trailing next-step suggestions')
  // LUM-1233 3g (GF-1): one global --project. Commands that resolve names in
  // a project (tasks, docs, milestones, memory, test cases, usage) read it as
  // their own `project` option; the rest accept and ignore it.
  .option(
    '--project <ref>',
    "The project to resolve names in (name or slug); defaults to the bound task's project where a command needs one"
  )

// Commander does not merge program-level options into a subcommand's own
// opts(), so the global `--no-hints` is folded into the env channel before any
// action runs. One silencing path (`nextStepsSilenced`) instead of two.
program.hook('preAction', (thisCommand, actionCommand) => {
  if (thisCommand.opts().hints === false) process.env.LUMO_NO_HINTS = '1'
  // The global --project lands in the action's own options, so every command
  // keeps reading `opts.project` exactly as when it declared the flag.
  const project = thisCommand.opts().project as string | undefined
  if (project !== undefined) actionCommand.setOptionValue('project', project)
  versionTracker?.setCommand(commandPathOf(actionCommand))
  currentCommand = actionCommand as unknown as CommandLike
})

const auth = program.command('auth').description('Manage Lumo authentication')

auth
  .command('login')
  .description('Log in to Lumo by pasting an API key')
  .action(wrap(authLogin))

auth
  .command('logout')
  .description('Log out and remove local credentials')
  .action(wrap(authLogout))

program
  .command('whoami')
  .description(
    'Show the logged-in identity from local credentials (one line; no network call)'
  )
  .option('--full', 'Also print workspace name, key name and API URL')
  .option('--json', 'Emit the identity as JSON (never includes the token)')
  .action(
    wrap(options => whoami(options as { full?: boolean; json?: boolean }))
  )

program
  .command('update')
  .description(
    `Check npm for a newer ${pkg.name} and install it globally if available. The CLI also updates itself in the background by default; --auto on|off toggles that.`
  )
  .option('--auto <on|off>', 'Turn background auto-update on or off')
  .action(wrap(options => update(options as { auto?: string })))

function registerInit(): void {
  program
    .command('init')
    .description(
      'Set up Lumo for Claude Code and Codex: the skill, hook handlers and a Codex sandbox rule. Re-run to refresh an install; --dry-run previews, --agent <token> sets up one agent.'
    )
    .option(
      '--scope <scope>',
      'user | project (case-insensitive) — user: ~/.claude, ~/.agents + ~/.codex, for every project of this user; project: ./.claude, ./.agents + ./.codex, this repo only'
    )
    .option(
      '--force',
      'Overwrite existing skill files (SKILL.md + references/) even when they were modified locally, and a .codex/rules/lumo.rules Lumo did not write'
    )
    .option(
      '--agent <token>',
      'Set up only this agent (claude-code, codex, cursor, gemini-cli, github-copilot, windsurf). Default: claude-code and codex.'
    )
    .option(
      '--dry-run',
      'Print what init would change (per file: path, action, unified diff) and which Codex hooks need Trust, without writing anything'
    )
    // LUM-1118: removed; kept hidden only to print the migration error.
    .addOption(new Option('--upgrade').hideHelp())
    .action(
      wrap(options =>
        init(
          options as {
            scope?: string
            force?: boolean
            agent?: string
            upgrade?: boolean
            dryRun?: boolean
          }
        )
      )
    )
}

registerInit()

const skill = program
  .command('skill')
  .description(
    'Report or refresh only the Lumo skill copies (SKILL.md + references/) — never hooks, settings, Codex hooks/rules or the git hook'
  )

skill
  .command('status')
  .description(
    'Read-only: every Lumo skill copy (user, this repo, recorded installs) with scope, agent, version, state vs this CLI and whether git tracks it.'
  )
  .option(
    '--json',
    'Machine-readable output: { schemaVersion, cliVersion, skills: [{ path, scope, agent, version, state, gitTracked }] }'
  )
  .action(wrap(options => skillStatus(options as { json?: boolean })))

skill
  .command('update')
  .description(
    'Refresh the Lumo skill copies that are behind this CLI (user and current-repo copies) from the bundled skill. Never downgrades; skips modified copies unless --force; never commits.'
  )
  .option(
    '--scope <scope>',
    "user | project (case-insensitive) — user: only ~/.claude, ~/.agents copies; project: only the current repo's copies (git toplevel of the cwd; in a worktree, the worktree)"
  )
  .option(
    '--agent <token>',
    'Only copies of this agent (claude-code = .claude/skills/lumo, codex = .agents/skills/lumo)'
  )
  .option(
    '--dry-run',
    'List, per copy, the files that would be added / modified / deleted (with line counts) and write nothing'
  )
  .option(
    '--force',
    'Also overwrite locally modified copies (discards those edits); still never downgrades'
  )
  .action(
    wrap(options =>
      skillUpdate(
        options as {
          scope?: string
          agent?: string
          dryRun?: boolean
          force?: boolean
        }
      )
    )
  )

program
  .command('doctor')
  .description(
    'Read-only report of every Lumo install on this machine and repo (skills, hooks, Codex rule, git hook): version, state and the command that fixes it, plus warnings. Always exits 0.'
  )
  .option('--json', 'Machine-readable output')
  .action(wrap(options => doctor(options as { json?: boolean })))

program
  .command('uninstall')
  .description(
    'Remove what `lumo init` installed: skills, hook entries, the Codex rule, the git hook block and registry records. Without --confirm exits 4 listing every path; never commits.'
  )
  .option(
    '--scope <scope>',
    'user (this machine), project (the current repo) or all (also recorded installs in other repos). Default: all'
  )
  .option(
    '--agent <token>',
    'Only installs of this agent (claude-code, codex, git, ...); the prepare-commit-msg hook is labelled git, so it is included only by --agent git'
  )
  .option(
    '--force',
    'Also delete skill copies that were edited locally (discards those edits)'
  )
  .option(
    '--purge',
    'Also delete everything in ~/.lumo (credentials, caches, install registry)'
  )
  .option(
    '--confirm',
    'Apply the removal after the user has approved the envelope'
  )
  .action(
    wrap(options =>
      uninstall(
        options as {
          scope?: string
          agent?: string
          force?: boolean
          purge?: boolean
          confirm?: boolean
        }
      )
    )
  )

const crossing = program
  .command('crossing')
  .description(
    'Inspect, annotate and (with user approval) disposition boundary crossings'
  )

crossing
  .command('list [task]')
  .description(
    "Read-only: a task's boundary crossings in full, as the web Record panel shows them. Open rows only by default; --all adds the dispositioned history. Defaults to the session-bound task."
  )
  .option(
    '--all',
    'Also list dispositioned crossings (the ruling history), not just open ones'
  )
  .option('--json', 'Emit the raw server rows as JSON (same --all filter)')
  .action(
    wrap((task: unknown, options: unknown) =>
      crossingList(task as string | undefined, options as CrossingListOptions)
    )
  )

crossing
  .command('explain [id]')
  .description(
    'Append an agent self-explanation to boundary crossings for the human reviewer. Append-only: it never clears a crossing or unblocks Done. --file takes a JSON array of {"id","note"}.'
  )
  .option(
    '--note <text>',
    'The explanation to record (the rationale for the action / why it may be a false positive); required with <id>'
  )
  .option(
    '--file <path>',
    'Batch: a JSON array of {"id": "<crossing>", "note": "<text>"} — one note per crossing, in one call; "-" reads stdin. Replaces <id> --note'
  )
  .option(
    '--task <identifier>',
    'Task the crossing belongs to (defaults to the session-bound task; unattached sessions must pass it)'
  )
  .action(
    wrap((id: unknown, options: unknown) =>
      crossingExplain(id as string, options as CrossingExplainOptions)
    )
  )

crossing
  .command('disposition <ids...>')
  .description(
    'Rule on one or more boundary crossings through a three-step handshake (show, confirm read, confirm ruling); each step exits 4 with an envelope to relay. Never supply a step flag yourself.'
  )
  .option(
    '--false-positive',
    'Rule the crossing a false positive (not a real issue)'
  )
  .option(
    '--confirmed',
    'Rule the crossing confirmed (a real issue, acknowledged)'
  )
  .option('--note <text>', 'Optional disposition note recorded with the ruling')
  .option(
    '--task <identifier>',
    'Task the crossing belongs to (defaults to the session-bound task)'
  )
  .option(
    '--receipt <token>',
    "Receipt(s) from the previous step's envelope: a bare token for one crossing, <id>=<token>,… for a batch. Required with --confirm-read and --confirm"
  )
  .option(
    '--confirm-read',
    'Step 2: the user confirmed they have read the envelope (never add this on your own initiative). Returns the ruling envelope; writes nothing'
  )
  .option(
    '--confirm',
    'Step 3: the user approved the ruling (never add this on your own initiative). Refused unless the read was confirmed first'
  )
  .action(
    wrap((ids: unknown, options: unknown) =>
      crossingDisposition(
        ids as string[],
        options as CrossingDispositionOptions
      )
    )
  )

const finding = program
  .command('finding')
  .description('Rule on PR security findings with user approval')

finding
  .command('disposition <ids...>')
  .description(
    "Record the user's ruling on one or more PR security findings, which clears a DONE blocker. Without --confirm it prints one confirmation envelope (exit 4) and writes nothing."
  )
  .option('--false-positive', 'Rule the findings false positives')
  .option(
    '--accepted-risk',
    'Rule the findings accepted risks (real, knowingly carried — add a --note)'
  )
  .option('--note <text>', 'Optional note recorded with each ruling')
  .option(
    '--task <identifier>',
    'Task the findings belong to (defaults to the session-bound task)'
  )
  .option(
    '--confirm',
    'The user approved the envelope (never add this on your own initiative)'
  )
  .action(
    wrap((ids: unknown, options: unknown) =>
      findingDisposition(ids as string[], options as FindingDispositionOptions)
    )
  )

program
  .command('status')
  .description(
    'Me across the workspace: the team priority, my inbox, my drafts and the next tasks to work on. --inbox / --drafts / --next print only those sections. Read-only; for one task use `lumo task status`.'
  )
  .option(
    '--inbox',
    'My notifications: pending responses first, then the rest; • marks unread'
  )
  .option('--drafts', 'My unsent task / project drafts from the web composer')
  .option(
    '--next',
    'The next tasks to work on, ranked by priority, active sprint and due date'
  )
  .option(
    '--claimable',
    'Next: only agent-claimable tasks that are unblocked and within milestone budget'
  )
  .option('-n, --limit <N>', 'Next: number of tasks to recommend (default 3)')
  .option(
    '--json',
    "Print the sections as JSON (one section flag: that section's own envelope)"
  )
  .action(wrap(options => status(options as StatusOptions)))

const priorityCmd = program
  .command('priority')
  .description('The team priority: an append-only list of declarations')

priorityCmd
  .command('create <text>')
  .description(
    'Declare the team priority (1-3 sentences). A newer declaration supersedes the old without deleting it.'
  )
  .action(wrap((text: unknown) => priorityCreate(text as string)))

priorityCmd
  .command('list')
  .description(
    'Print the team priority append history, newest-first (the current declaration is marked with *).'
  )
  .option('--json', 'Print { version, priorities, current } as JSON')
  .action(wrap(opts => priorityList(opts as { json?: boolean })))

const pr = program
  .command('pr')
  .description('Inspect pull requests by number — linked to a task or not')

pr.command('show <number>')
  .description(
    "Read a PR's security scans (read-only): layers, findings, the AI review budget. Request or pause a review with `lumo pr review`; rule with `lumo finding disposition`."
  )
  .option(
    '--repo <owner/repo>',
    'Narrow to one repo when the same PR number exists in several (the error lists the candidates)'
  )
  .option(
    '--all',
    "Every pushed head's scan, newest first, instead of the latest only"
  )
  .option(
    '--full',
    'Append the per-task hunt detail: commands (with gate refusals), step trace, stop arithmetic, wrap-up, sites, model, diff sizing'
  )
  .option(
    '--json',
    'Emit the versioned machine-readable payload ({ pullRequest, scans[].stages / findings[] / hunt.tasks[] })'
  )
  .action(
    wrap((number, options) =>
      prShow(number as string, options as PrShowOptions)
    )
  )

pr.command('review <number>')
  .description(
    'Request an AI review now (incremental by default, --full for a full one; not counted toward the automatic budget), or --pause / --resume automatic review of every push.'
  )
  .option('--full', 'A full review instead of an incremental one')
  .option('--pause', 'Pause automatic AI reviews for this PR')
  .option(
    '--resume',
    'Resume automatic AI review of every push and reset the reviewed-commit count'
  )
  .option(
    '--limit <commits>',
    'With --pause / --resume: this PR pauses after N reviewed commits (1..100, over the workspace setting)'
  )
  .option(
    '--repo <owner/repo>',
    'Narrow to one repo when the same PR number exists in several (the error lists the candidates)'
  )
  .action(
    wrap((number, options) =>
      prReview(number as string, options as PrReviewOptions)
    )
  )

const session = program
  .command('session')
  .description('Manage per-terminal coding-session context')

session
  .command('attach <identifier>')
  .description(
    'Attach this Claude Code or Codex session to a task, or with --steward to a milestone as a governance session. The binding is a lifetime lock: start a new session to switch.'
  )
  .option(
    '--steward',
    'Bind as a STEWARD (governance) session to a milestone (id, name or slug). Stewards plan and accept only; implementation commits/PRs are recorded as boundary crossings.'
  )
  .option(
    '--worktree',
    "Create this task's worktree under .worktrees/ when none exists (main checkout only; failures never fail attach). Default: .lumo/worktree.json autoWorktree, else off."
  )
  .option(
    '--no-worktree',
    'Do not create a worktree even when .lumo/worktree.json sets autoWorktree'
  )
  .action(
    wrap((identifier, options) =>
      sessionAttach(
        identifier as string,
        options as { steward?: boolean; worktree?: boolean }
      )
    )
  )

session
  .command('status')
  .description(
    'Show what the current Claude Code or Codex session is bound to: a task, a milestone (STEWARD governance session), or nothing.'
  )
  .option('--json', 'Print { version, session } as JSON')
  .action(wrap(opts => sessionStatus(opts as { json?: boolean })))

const usage = program
  .command('usage')
  .description('Token usage: what it cost, who used it, and corrections')

usage
  .command('show')
  .description(
    'Token cost per operation (default: workspace, last 30 days, by tool); --by member --tasks adds the tasks completed over local days.'
  )
  .option(
    '--by <dim>',
    'Headline grouping: tool | model | member | session (case-insensitive; default tool)'
  )
  .option('--task <id>', 'Cost of a single task (e.g. LUM-42)')
  .option('--session <id>', 'Cost of a single Claude Code or Codex session')
  .option(
    '--since <day>',
    'First day, inclusive: YYYY-MM-DD, Nd (the N days ending on --until), today, yesterday, or a timestamp. Default: last 30 days (7 with --tasks)'
  )
  .option(
    '--tasks',
    'Append the tasks completed in the window (tokens split per member)'
  )
  .option(
    '--until <day>',
    'Last day, inclusive: YYYY-MM-DD, today, or yesterday (default today)'
  )
  .option(
    '--member <ref>',
    'With --tasks: only this member (me, an email, or a display name)'
  )
  .option(
    '--limit <N>',
    'With --tasks: max completed tasks listed (default 50, max 500)'
  )
  .option('--json', 'Emit the versioned payload as JSON')
  .action(wrap(options => usageShow(options as UsageShowOptions)))

usage
  .command('resync')
  .description(
    'Correct historical (inflated) token usage from local transcripts; --dry-run previews. Sends token counts only, never transcript content.'
  )
  .option('--dry-run', 'Show what would be corrected and write nothing')
  .option('--json', 'Print the merged server response as JSON')
  .action(
    wrap(options =>
      usageResync(options as { dryRun?: boolean; json?: boolean })
    )
  )

const task = program
  .command('task')
  .description('Inspect tasks from the terminal')

task
  .command('list')
  .description(
    'List tasks assigned to you, 50 per page. Filter with --status, --project, --milestone; page with --limit / --cursor (a longer list ends with "Showing X-Y of N." and the next-page command).'
  )
  .option(
    '-s, --status <value>',
    'Filter by status: backlog | todo | in_progress | in_review | done (case-insensitive)'
  )
  .option('-n, --limit <count>', 'Tasks per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option(
    '-m, --milestone <ref>',
    'Filter by milestone slug, name or id (scopes to my tasks under that milestone)'
  )
  .option(
    '--json',
    'Print { version, tasks, total, nextCursor, deprecatedFields } as JSON'
  )
  .option(
    '--fields <list>',
    'With --json: print only these comma-separated task fields, e.g. ref,title,status (an unknown name lists the valid ones)'
  )
  .action(wrap(options => taskList(options as Record<string, string>)))

task
  .command('search [query]')
  .description(
    'Search tasks across the workspace (any assignee): all [query] terms must match title/description or a task number like LUM-42. Typo-tolerant unless --exact; 50 per page.'
  )
  .option(
    '-a, --assignee <ref>',
    'Assignee — me, an email, a member or agent name, or none for unassigned; repeatable (ORed)',
    collect,
    []
  )
  .option('--tag <name>', 'Tag name (repeatable = any of)', collect, [])
  .option(
    '-s, --status <value>',
    'Status: backlog | todo | in_progress | in_review | done (case-insensitive; repeatable or comma-separated)',
    collect,
    []
  )
  .option(
    '-p, --priority <level>',
    'Priority: low | medium | high | urgent (case-insensitive; repeatable or comma-separated)',
    collect,
    []
  )
  .option('-m, --milestone <ref>', 'Milestone slug, name or id')
  .option('--sprint <ref>', 'Sprint number or UUID')
  .option('--team <ref>', 'Team to resolve --sprint against')
  .option('--due-after <date>', 'Due on or after YYYY-MM-DD (your local day)')
  .option('--due-before <date>', 'Due on or before YYYY-MM-DD (your local day)')
  .option('-n, --limit <count>', 'Tasks per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option(
    '--exact',
    'Substring matching only, in board order (default: typo-tolerant, ranked by relevance)'
  )
  .option('--json', 'Emit { tasks, truncated, total, nextCursor } as JSON')
  .action(
    wrap((query, options) =>
      taskSearch(query as string | undefined, options as Record<string, never>)
    )
  )

task
  .command('delete <identifier>')
  .description(
    'Move a task and its subtasks to the trash (restorable for 30 days from web Settings → Trash). Without --confirm: exit 4 with an envelope listing what goes with it.'
  )
  .option(
    '--confirm',
    'The user has approved the deletion shown in the confirmation envelope. Without it the command exits 4 and deletes nothing.'
  )
  .action(
    wrap((identifier, options) =>
      taskDelete(identifier as string, options as { confirm?: boolean })
    )
  )

task
  .command('statuses')
  .description(
    'Show the task status set, allowed transitions and priorities, as served by the API.'
  )
  .option('--json', 'Emit the catalog as JSON')
  .action(wrap(options => taskStatuses(options as { json?: boolean })))

task
  .command('show [task]')
  .description(
    'Show a task: title, status, fields, description. Aspect flags add sections (combine freely); defaults to the bound task.'
  )
  .option(
    '--full',
    'Alone: the whole task context for starting work (prior sessions, memory index, linked sources, test cases). With an aspect flag: that aspect in long form'
  )
  .option(
    '--memory',
    'The task context with every memory body and the judged-used track record'
  )
  .option(
    '--comments',
    'Add the comment thread (50 top-level threads per page)'
  )
  .option('--history', 'Add the field-change history, oldest first')
  .option('--scans', "Add the security scans of the task's linked PRs")
  .option(
    '--runs',
    'Add the agent runs (session, summary, turns, tool calls, tokens, attribution)'
  )
  .option(
    '--outcome',
    'Add the post-hoc outcome well (REJECTED or INCONCLUSIVE)'
  )
  .option(
    '--lineage',
    'Add the causal trail: context fragments, their outcomes and run cost'
  )
  .option('--deps', 'Add the dependency edges (both directions)')
  .option(
    '--all',
    "With --scans: every pushed head's scan, not the latest only"
  )
  .option('--signal', 'With --lineage: append the usage-signal health section')
  .option(
    '-n, --limit <count>',
    'With exactly one of --comments / --history: entries per page (1-500, default 50)'
  )
  .option(
    '--cursor <cursor>',
    'With exactly one of --comments / --history: continue from the footer'
  )
  .option(
    '--json',
    'Print { version, task } plus one key per aspect (context, comments, history, …) as JSON'
  )
  .action(
    wrap((taskArg, opts) =>
      taskShow(taskArg as string | undefined, opts as TaskShowOptions)
    )
  )

task
  .command('status [task]')
  .description(
    'Task self-check: next actions, scan coverage, open crossings; when READY for DONE, what DONE would change and the command to run. Defaults to the bound task.'
  )
  .option(
    '--json',
    'Emit the versioned machine-readable payload (version field; breaking changes bump it)'
  )
  .option(
    '--full',
    "Also print cost, the rework trail, trend and each test case's latest run (as in `testcase list`)"
  )
  .action(
    wrap((taskArg, options) =>
      taskStatus(
        taskArg as string | undefined,
        options as { json?: boolean; full?: boolean }
      )
    )
  )

task
  .command('comment <identifier> <body>')
  .description(
    'Add a comment to a task. Body is plain text — quote it to pass spaces or newlines.'
  )
  .option(
    '--reply-to <comment>',
    'Reply to a top-level comment: its #id from `task show --comments` (unique prefix of 6+ chars)'
  )
  .action(
    wrap((identifier, body, opts) =>
      taskComment(
        identifier as string,
        body as string,
        opts as { replyTo?: string }
      )
    )
  )

task
  .command('create <title>')
  .description(
    'Create a task. --project required when workspace has >1 project; defaults: priority=low, assignee=me.'
  )
  .option('-d, --description <text>', 'Task description')
  .option(
    '-p, --priority <level>',
    'Priority: low | medium | high | urgent (case-insensitive; default: low)'
  )
  .option('-a, --assignee <ref>', 'Assignee email, name, or "me" (default: me)')
  .option(
    '--milestone <ref>',
    'Milestone slug (as in the web URL) or name (case-insensitive)'
  )
  .option('--due <date>', 'Due date, YYYY-MM-DD (your local day)')
  .option(
    '--template <key>',
    'Pre-fill the description from a task template (see `task template list`); not with --description'
  )
  .option('--tag <name>', 'Attach tag by name (repeatable)', collect, [])
  .option('--tag-id <cuid>', 'Attach tag by id (repeatable)', collect, [])
  .option(
    '--sprint <ref>',
    'Sprint number or UUID to add the task to after creation'
  )
  .option(
    '--rework-of <id>',
    'Declare this is rework of an existing task (redirects you to fix it; creates nothing)'
  )
  .option(
    '--new-scope',
    'Declare this is genuinely new work, outside your current task’s scope'
  )
  .action(
    wrap((title, options) =>
      taskCreate(title as string, options as Record<string, string>)
    )
  )

const taskTemplate = task
  .command('template')
  .description('Task templates that pre-fill a new task description')

taskTemplate
  .command('list')
  .description(
    'List the task templates available to `task create --template <key>`: built-ins plus your workspace ones.'
  )
  .option('--json', 'Emit the templates (with their Markdown content) as JSON')
  .action(wrap(options => taskTemplateList(options as { json?: boolean })))

taskTemplate
  .command('show <key>')
  .description(
    "Print one template's Markdown (built-in or workspace) — redirect to save it: `show agent-brief > brief.md`."
  )
  .option('--json', 'Emit key, name, description, isSystem and content as JSON')
  .action(
    wrap((key, options) =>
      taskTemplateShow(key as string, options as { json?: boolean })
    )
  )

taskTemplate
  .command('create <key>')
  .description(
    'Create a workspace template from a local Markdown file (OWNER only). <key> is a lowercase slug; built-in keys are reserved.'
  )
  .option('--name <name>', 'Display name (required, ≤80 chars)')
  .option(
    '--file <path>',
    'UTF-8 Markdown file with the template body (required, ≤20,000 chars); `-` reads stdin'
  )
  .action(
    wrap((key, options) =>
      taskTemplateCreate(
        key as string,
        options as { name?: string; file?: string }
      )
    )
  )

taskTemplate
  .command('edit <key>')
  .description(
    'Change a workspace template (OWNER only): new name, new body from a Markdown file, and/or a new key. Built-ins cannot be edited.'
  )
  .option('--name <name>', 'New display name')
  .option(
    '--file <path>',
    'Replace the body with this UTF-8 Markdown file; `-` reads stdin'
  )
  .option('--key <new-key>', 'Rename the key')
  .action(
    wrap((key, options) =>
      taskTemplateEdit(
        key as string,
        options as { name?: string; file?: string; key?: string }
      )
    )
  )

taskTemplate
  .command('rm <key>')
  .description(
    'Delete a workspace template (OWNER only, irreversible). Without --confirm: exit 4 + a confirmation envelope naming it.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((key, options) =>
      taskTemplateRm(
        key as string,
        options as { confirm?: boolean; yes?: boolean }
      )
    )
  )

task
  .command('decide <identifier> <text>')
  .description(
    "Append a dated ruling to the task description's `## Decisions` section (created if missing). Use for decisions instead of comments."
  )
  .action(
    wrap((identifier, text) => taskDecide(identifier as string, text as string))
  )

const taskFigma = task
  .command('figma')
  .description('Attach Figma file/frame links to a task')

taskFigma
  .command('add <task> <url>')
  .description(
    'Attach a Figma file or frame URL to the given task. Fetches file/frame name + thumbnail via Figma OAuth.'
  )
  .action(
    wrap((taskId: unknown, url: unknown) =>
      taskFigmaAdd({ identifier: taskId as string, url: url as string })
    )
  )

taskFigma
  .command('list <task>')
  .description('List Figma links attached to a task')
  .option('--json', 'Print { version, figmaLinks, total, nextCursor } as JSON')
  .action(
    wrap((taskId: unknown, opts: unknown) =>
      taskFigmaList({
        identifier: taskId as string,
        json: (opts as { json?: boolean }).json,
      })
    )
  )

taskFigma
  .command('rm <task> <link>')
  .description(
    'Remove a Figma link from a task (idempotent). <link> is the Figma URL, the 8-char short ref `figma list` prints, a unique id prefix (6+ chars) or the full id; an ambiguous ref removes nothing'
  )
  .action(
    wrap((taskId: unknown, linkIdOrUrl: unknown) =>
      taskFigmaRm({
        identifier: taskId as string,
        linkIdOrUrl: linkIdOrUrl as string,
      })
    )
  )

taskFigma
  .command('refresh <task>')
  .description(
    'Re-fetch Figma metadata + thumbnail for every link on this task. Per-link failures isolated.'
  )
  .action(
    wrap((taskId: unknown) =>
      taskFigmaRefresh({ identifier: taskId as string })
    )
  )

// Tier-2 retrieval commands (LUM-122). `task show --full` prints the matching
// command at the end of each cheap inline card; the agent runs it to pull the
// full content on demand.
const taskSlack = task.command('slack').description('Inspect Slack context')
taskSlack
  .command('show <identifier> <ref>')
  .description(
    'Show the full stored Slack thread snapshot (<ref>: the 8-char short ref `task show --full` / the listing prints, a unique id prefix of 6+ chars, or the full id)'
  )
  .option('--json', 'Print { version, slackContext } as JSON')
  .action(
    wrap((id, ctx, opts) =>
      taskSlackShow(id as string, ctx as string, opts as { json?: boolean })
    )
  )

const taskWeb = task.command('web').description('Inspect web link content')
taskWeb
  .command('show <identifier> <ref>')
  .description(
    'Show the fetched web link body as plain text (<ref>: the 8-char short ref `task show --full` / the listing prints, a unique id prefix of 6+ chars, or the full id)'
  )
  .option('--json', 'Print { version, webLink } as JSON')
  .action(
    wrap((id, link, opts) =>
      taskWebShow(id as string, link as string, opts as { json?: boolean })
    )
  )

// taskFigma already exists above → attach the context leaf to it.
taskFigma
  .command('context <identifier> <ref>')
  .description(
    'Show the cached Figma design context (metadata) (<ref>: the 8-char short ref `task show --full` / the listing prints, a unique id prefix of 6+ chars, or the full id)'
  )
  .option(
    '--json',
    'Print { version, figmaLink, designContextAvailable, note } as JSON'
  )
  .action(
    wrap((id, link, opts) =>
      taskFigmaContext(id as string, link as string, opts as { json?: boolean })
    )
  )

// Plural `comments` parent: `task comment <id> <body>` already exists for
// adding a comment, and commander disallows a duplicate name.
const taskComments = task
  .command('comments')
  .description(
    'Manage the task comment thread (read it with `lumo task show --comments`)'
  )
taskComments
  .command('edit <identifier> <comment> <body>')
  .description(
    'Replace the text of one of your own comments. <comment> is its #id from `task show --comments` (unique prefix of 6+ chars).'
  )
  .action(
    wrap((id, comment, body) =>
      taskCommentEdit(id as string, comment as string, body as string)
    )
  )
taskComments
  .command('rm <identifier> <comment>')
  .description(
    'Delete one of your own comments (soft delete; replies under it are hidden too). Without --confirm: exit 4 + a confirmation envelope quoting the comment.'
  )
  .option(
    '--confirm',
    'The user has approved the deletion shown in the confirmation envelope. Without it the command exits 4 and deletes nothing.'
  )
  .action(
    wrap((id, comment, opts) =>
      taskCommentRm(
        id as string,
        comment as string,
        opts as { confirm?: boolean }
      )
    )
  )

const taskDeps = task
  .command('deps')
  .description(
    'Manage task dependency edges (read them with `lumo task show --deps`)'
  )
taskDeps
  .command('add <identifier>')
  .requiredOption('--blocked-by <blocker>', 'blocker task (LUM-N)')
  .description('Declare a manual hard dependency (CONFIRMED)')
  .action(
    wrap((id, opts) => taskDepsAdd(id as string, opts as { blockedBy: string }))
  )
taskDeps
  .command('confirm <identifier> <edge>')
  .option('--reverse', 'flip direction when confirming')
  .description('Confirm a detected candidate edge')
  .action(
    wrap((id, edge, opts) =>
      taskDepsConfirm(
        id as string,
        edge as string,
        opts as { reverse?: boolean }
      )
    )
  )
taskDeps
  .command('dismiss <identifier> <edge>')
  .description('Dismiss a candidate (never re-suggested)')
  .action(wrap((id, edge) => taskDepsDismiss(id as string, edge as string)))
taskDeps
  .command('rm <identifier> <edge>')
  .description(
    'Delete a dependency edge. Without --confirm: exit 4 + a confirmation envelope describing the edge.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((id, edge, opts) =>
      taskDepsRm(
        id as string,
        edge as string,
        opts as { confirm?: boolean; yes?: boolean }
      )
    )
  )

const taskPr = task.command('pr').description('Inspect linked PRs')
taskPr
  .command('show <identifier> <number>')
  .description(
    'Show the synced PR record (diff/review comments when available)'
  )
  .option(
    '--json',
    'Print { version, pullRequest, task, liveDiffAvailable, note } as JSON'
  )
  .action(
    wrap((id, num, opts) =>
      taskPrShow(id as string, num as string, opts as { json?: boolean })
    )
  )

const taskArtifact = task
  .command('artifact')
  .description(
    'Record spec-engineering artifacts (spec / plan / design …) on a task'
  )

taskArtifact
  .command('add <task>')
  .description(
    'Attach an artifact to a task. --kind/--title/--source are stored verbatim; --file supplies the content.'
  )
  .requiredOption(
    '--kind <kind>',
    'Artifact kind, e.g. spec | plan | design (opaque)'
  )
  .requiredOption('--title <title>', 'Artifact title')
  .requiredOption(
    '--file <path>',
    'File whose contents become the artifact body'
  )
  .requiredOption(
    '--source <source>',
    'Spec-gen framework, formal name e.g. Superpowers | "Spec Kit" | BMad | OpenSpec | GSD (opaque; quote names with spaces)'
  )
  .requiredOption(
    '--agent <agent>',
    'Coding tool that produced the artifact: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (case-insensitive)'
  )
  .action(
    wrap((taskId: unknown, options: unknown) =>
      taskArtifactAdd(taskId as string, options as Record<string, string>)
    )
  )

taskArtifact
  .command('update <task> <artifact>')
  .description(
    'Update an artifact’s kind / title / source (not content). Provide at least one flag. <artifact>: the 8-char short ref in `artifact list` column 1, a unique id prefix or the full id.'
  )
  .option('--kind <kind>', 'New artifact kind (opaque)')
  .option('--title <title>', 'New artifact title')
  .option(
    '--source <source>',
    'New spec-gen framework, formal name e.g. Superpowers | "Spec Kit" | BMad | OpenSpec | GSD (quote names with spaces)'
  )
  .option(
    '--agent <agent>',
    'New coding tool: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (case-insensitive)'
  )
  .action(
    wrap((taskId: unknown, artifactId: unknown, options: unknown) =>
      taskArtifactUpdate(
        taskId as string,
        artifactId as string,
        options as Record<string, string>
      )
    )
  )

taskArtifact
  .command('list <task>')
  .description('List artifacts attached to a task, in order')
  .option('--json', 'Print { version, artifacts, total, nextCursor } as JSON')
  .action(
    wrap((taskId: unknown, opts: unknown) =>
      taskArtifactList(taskId as string, opts as { json?: boolean })
    )
  )

taskArtifact
  .command('show <task> <artifact>')
  .description(
    'Show one artifact (key:value header + content body). <artifact>: the 8-char short ref in `artifact list` column 1 (also printed by `task show --full`), a unique id prefix or the full id.'
  )
  .option('--json', 'Print { version, artifact, task } as JSON')
  .action(
    wrap((taskId: unknown, artifactId: unknown, opts: unknown) =>
      taskArtifactShow(
        taskId as string,
        artifactId as string,
        opts as { json?: boolean }
      )
    )
  )

taskArtifact
  .command('rm <task> <artifact>')
  .description(
    'Delete an artifact from a task (irreversible; <artifact>: short ref, unique id prefix or full id). Without --confirm: exit 4 + a confirmation envelope naming the artifact.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((taskId: unknown, artifactId: unknown, options: unknown) =>
      taskArtifactRm(
        taskId as string,
        artifactId as string,
        options as { confirm?: boolean; yes?: boolean }
      )
    )
  )

/**
 * LUM-1233 batch 3a: one definition for `task testcase …` and
 * `milestone testcase …` — the same verbs, flags and help text on both, so
 * they cannot drift. Each per-case verb takes the handle `<parent>/TC<n>`.
 */
function registerTestCaseCommands(
  group: Command,
  kind: TestCaseParentKind
): void {
  const parent = kind === 'task' ? '[task]' : '<milestone>'
  const handle = `<${kind}/case>`
  const example = kind === 'task' ? 'LUM-42/TC3' : 'headless-web-cli/TC3'
  const parentNote =
    kind === 'task' ? ' Defaults to the session-bound task.' : ''

  group
    .command(`add ${parent}`)
    .description(
      `Add a test case. --step / --verify are repeatable and keep the order they appear in.${parentNote}`
    )
    .requiredOption('--title <title>', 'Test case title')
    .option(
      '--setup <text>',
      'Preconditions, e.g. "The user is on the Dashboard."'
    )
    .option(
      '--step <text>',
      'One execution step (repeatable, ordered). At least one is required.',
      collect,
      [] as string[]
    )
    .option(
      '--verify <text>',
      'One verification step (repeatable, ordered). May be omitted entirely.',
      collect,
      [] as string[]
    )
    .requiredOption('--expected <text>', 'Expected result')
    .option(
      '--requires-env <environment>',
      'local | preview | production (case-insensitive) - this case only proves anything when run there; a PASS recorded elsewhere is capped to UNPROVEN. Matched exactly: there is no environment hierarchy'
    )
    .action(
      wrap((ref: unknown, options: unknown) =>
        testCaseAdd(
          kind,
          ref as string | undefined,
          options as Record<string, never>
        )
      )
    )

  group
    .command(`list ${parent}`)
    .description(
      `List test cases with each one's latest run (result, environment, commit).${parentNote}`
    )
    .option(
      '--json',
      'Print { version, testCases, total, nextCursor, summary } as JSON'
    )
    .action(
      wrap((ref: unknown, opts: unknown) =>
        testCaseList(
          kind,
          ref as string | undefined,
          opts as { project?: string; json?: boolean }
        )
      )
    )

  group
    .command(`show ${handle}`)
    .description(
      `Show one test case (four sections, 1-based step numbers) plus its run history; evidence is listed under the step it is attached to. Handle: ${example}`
    )
    .option('--json', 'Print { version, testCase, runs, pullRequests } as JSON')
    .action(
      wrap((h: unknown, opts: unknown) =>
        testCaseShow(
          kind,
          h as string,
          opts as { project?: string; json?: boolean }
        )
      )
    )

  group
    .command(`download ${handle} <dir>`)
    .description(
      `Save the Lumo-hosted evidence files of every run of a test case into <dir>/<run>/ using your API key (external links are listed, not downloaded). Handle: ${example}`
    )
    .action(
      wrap((h: unknown, dir: unknown, opts: unknown) =>
        testCaseDownload(
          kind,
          h as string,
          dir as string,
          opts as { project?: string }
        )
      )
    )

  group
    .command(`update ${handle}`)
    .description(
      'Edit a test case. --step / --verify REPLACE the whole list (they do not append). Provide at least one field.'
    )
    .option('--title <title>', 'New title')
    .option('--setup <text>', 'New preconditions')
    .option(
      '--step <text>',
      'Replacement step (repeatable, ordered) - replaces the whole steps list',
      collect,
      [] as string[]
    )
    .option(
      '--verify <text>',
      'Replacement verification step (repeatable, ordered) - replaces the whole list',
      collect,
      [] as string[]
    )
    .option('--expected <text>', 'New expected result')
    .option(
      '--requires-env <environment>',
      'local | preview | production | none (case-insensitive) - this case only proves anything when run there; a PASS recorded elsewhere is capped to UNPROVEN. Pass "none" to clear it. Matched exactly: there is no environment hierarchy'
    )
    .action(
      wrap((h: unknown, options: unknown) =>
        testCaseUpdate(kind, h as string, options as Record<string, never>)
      )
    )

  group
    .command(`delete ${handle}`)
    .description(
      'Delete a test case (soft delete - its run history stays readable). Without --confirm: exit 4 + a confirmation envelope.'
    )
    .option(
      '--confirm',
      'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
    )
    .action(
      wrap((h: unknown, options: unknown) =>
        testCaseDelete(
          kind,
          h as string,
          options as { project?: string; confirm?: boolean }
        )
      )
    )

  group
    .command(`run ${handle}`)
    .description(
      'Record one execution. --env is REQUIRED and has no default - a run must say which environment it ran in.'
    )
    .requiredOption(
      '--result <result>',
      'pass | fail | blocked (case-insensitive)'
    )
    .requiredOption(
      '--env <environment>',
      'local | preview | production (case-insensitive; no default - say where this ran)'
    )
    .option(
      '--pr <number>',
      'The PR whose change this run exercised (must be linked to the task; a milestone run refuses it and records the commit)'
    )
    .option(
      '--commit <sha>',
      'Which commit this run exercised. Auto-detected from local git ONLY for --env local; required to record one for preview/production (the local checkout is not what they run)'
    )
    .option(
      '--failed-step <n>',
      '1-based index into the steps list (FAIL only; mutually exclusive with --failed-verify)'
    )
    .option(
      '--failed-verify <n>',
      '1-based index into the verification list (FAIL only; mutually exclusive with --failed-step)'
    )
    .option(
      '--cause <cause>',
      'Why it failed: defect | outdated | external | unknown (case-insensitive). REQUIRED on --result fail, refused otherwise. Only "defect" carries a burden of proof (needs at least one --evidence / --evidence-file); "unknown" is a real answer'
    )
    .option(
      '--unproven <n>',
      '1-based index of a verification step this run could NOT observe (repeatable). A reported PASS that declares one is capped to UNPROVEN - you cannot pass on what you did not check',
      collect,
      [] as string[]
    )
    .option('--note <text>', 'Free-text note about this run')
    .option(
      '--evidence <url>',
      'Evidence link (repeatable)',
      collect,
      [] as string[]
    )
    .option(
      '--evidence-file <path>',
      'Local file to upload as evidence: png/jpeg/webp/gif/txt/log/json, max 10 MB each, 5 files (repeatable)',
      collect,
      [] as string[]
    )
    .option(
      '--step <spec>',
      'Per-step result (repeatable): <step>=<result>[@duration], where <step> is s<n> for a step or v<n> for a verification check (ranges like s1-3) and <result> is pass, fail or skip:<reason>, e.g. s1-3=pass, v1=fail@0.3s, s4=skip:"no real DB". Required: every step must be reported or the run is rejected',
      collect,
      [] as string[]
    )
    .option(
      '--step-evidence <spec>',
      'Attach evidence to one reported step (repeatable): s3=shot.png or v1=https://... Files count toward the 5-file limit',
      collect,
      [] as string[]
    )
    .option(
      '--actual <text>',
      'What actually happened at the failing step (FAIL only), shown next to the expected result'
    )
    .action(
      wrap((h: unknown, options: unknown) =>
        testCaseRun(kind, h as string, options as Record<string, never>)
      )
    )

  group
    .command(`disposition ${handle}`)
    .description(
      "Rule on a test case whose latest run proved an implementation defect — clears that run's block. Three-step handshake; never add a step flag yourself."
    )
    .option(
      '--known-defect',
      'We accept this defect and ship anyway (does NOT claim it is fixed)'
    )
    .option(
      '--not-a-defect',
      'The failure was mis-attributed to the implementation'
    )
    .option('--note <text>', 'Why this ruling')
    .option(
      '--receipt <token>',
      'The read receipt from the previous step of the handshake'
    )
    .option(
      '--confirm-read',
      "Step 2 — THE USER's confirmation that they read the envelope. Never add this yourself."
    )
    .option(
      '--confirm',
      "Step 3 — THE USER's approval of the ruling. Never add this yourself."
    )
    .action(
      wrap((h: unknown, options: unknown) =>
        testCaseDisposition(kind, h as string, options as Record<string, never>)
      )
    )
}

const taskTestCase = task
  .command('testcase')
  .description(
    'Structured test cases on a task (setup / steps / verification / expected) and their run records'
  )

registerTestCaseCommands(taskTestCase, 'task')

const memberCmd = program
  .command('member')
  .description('Inspect workspace members from the terminal')

memberCmd
  .command('list')
  .description(
    'List workspace members (name, email, role) and agent actors — the refs `--assignee` accepts.'
  )
  .option('--json', 'Emit the directory as JSON')
  .action(wrap(options => memberList(options as { json?: boolean })))

const auditCmd = program
  .command('audit')
  .description('Workspace audit log (workspace owners only)')

auditCmd
  .command('list')
  .description(
    'List the workspace audit log, newest first: who did what, when, from where (OWNER only).'
  )
  .option(
    '--action <action>',
    'An action key (member.role_changed) or an area (invite)'
  )
  .option(
    '--actor <ref>',
    'me, system, an email, a member name, a member id or a Clerk user id'
  )
  .option('--since <when>', 'From: 7d, 2026-10-01 or an ISO date-time')
  .option('--until <when>', 'To (inclusive): 2026-10-04 or an ISO date-time')
  .option(
    '--target-type <type>',
    'workspace | member | invite | data_export | session | task_template | integration | api_key | document | task | boundary_crossing | suppression_rule | security_finding | test_case_run | sentry_mapping | audit_log (case-insensitive)'
  )
  .option('--target <id>', 'Target id')
  .option('--limit <n>', 'Events per page (1-200, default 50)')
  .option('--cursor <cursor>', 'Continue from a previous page')
  .option('--json', 'Emit the page as JSON')
  .option('--csv', 'Write the filtered log as CSV to stdout (capped)')
  .action(wrap(options => auditList(options as AuditListOptions)))

const workspaceCmd = program
  .command('workspace')
  .description('Workspace settings from the terminal')

workspaceCmd
  .command('security-scan')
  .description(
    'Show or change the PR security-scan and AI review settings, workspace-wide or per repository (--repo). Any member may read; changing is OWNER only, and turning things off needs --confirm.'
  )
  .option(
    '--scan <on|off>',
    'Master switch: off = no layer runs, no PR comment'
  )
  .option('--ai-review <on|off>', 'AI review (LLM security review and triage)')
  .option('--hunt <on|off>', 'Exploit-path hunt in the sandbox')
  .option(
    '--reward-hack <on|off>',
    'Agent behavior check: whether the agent sessions behind a PR gamed tests or checks (advisory)'
  )
  .option(
    '--request-changes <on|off>',
    'Request-changes workflow (default off): Lumo requests changes while threads or Done-blocking findings are open, approves when clean'
  )
  .option(
    '--allow-author-approval <on|off>',
    'PR authors may run `@uselumo resolve` / `approve` on their own PR (default on); off = only other write-access accounts'
  )
  .option(
    '--learnings-scope <local|global|auto>',
    'Which repositories’ learnings the AI review reads (default auto): local = the reviewed repository, global = every repository in this workspace, auto = local for public / global for private repositories'
  )
  .option(
    '--auto-pause-after <n>',
    'Every push to a PR gets an automatic AI review until N commits are reviewed (default 5, 0 = never pause; a PR’s own `pr review --resume --limit` wins)'
  )
  .option('--disable-all', 'Turn every layer switch off at once')
  .option('--enable-all', 'Turn every layer switch on at once')
  .option(
    '--repos',
    'List each connected repository with its automatic review settings'
  )
  .option(
    '--repo <owner/name>',
    'One connected repository: show it, or change it with --review / --drafts'
  )
  .option(
    '--review <on|off>',
    'With --repo: review every PR without a task automatically'
  )
  .option(
    '--drafts <on|off>',
    'With --repo: review draft PRs too (off = wait for ready for review)'
  )
  .option(
    '--base-branches <regex>',
    'With --repo (repeatable; replaces the list, "" clears): also review PRs whose base branch fully matches; the default branch is always reviewed, ".*" = all',
    collectList
  )
  .option(
    '--labels <label>',
    'With --repo (repeatable; replaces the list, "" clears): label = review only PRs carrying one (opts in when --review off), !label = skip PRs carrying it',
    collectList
  )
  .option(
    '--ignore-title <keyword>',
    'With --repo (repeatable; replaces the list, "" clears): skip PRs whose title contains it (case-insensitive)',
    collectList
  )
  .option(
    '--ignore-users <login>',
    'With --repo (repeatable; replaces the list, "" clears): never auto-review PRs by this author (exact, case-sensitive; beats every other rule)',
    collectList
  )
  .option(
    '--description-keyword <text>',
    'With --repo ("" clears): with --review off, review PRs whose description contains it'
  )
  .option(
    '--path-filter <glob>',
    'With --repo (repeatable; replaces the list, "" clears): what the AI review and hunt read; !glob excludes, glob restricts to matches; lockfiles and generated files are excluded by default',
    collectList
  )
  .option(
    '--title-check <off|warning|error>',
    'With --repo: the pre-merge title check (default warning); error = a failed check keeps Lumo at "Changes requested" (request-changes workflow on) until fixed or `@uselumo ignore pre-merge checks`'
  )
  .option(
    '--title-requirements <text>',
    'With --repo ("" clears): extra rules the PR title must meet, in plain language'
  )
  .option(
    '--description-check <off|warning|error>',
    "With --repo: the pre-merge description check (default warning; follows the repository's PR template if it has one)"
  )
  .option(
    '--override-reviewers-only <on|off>',
    "With --repo: only the PR's reviewers (requested by name, or who already submitted a review; never the PR author) may `@uselumo ignore pre-merge checks` (default off)"
  )
  .option(
    '--issue-assessment <off|warning|error>',
    'With --repo: the pre-merge check that judges each requirement of the linked Lumo task (Goal, Done when items) and of the issues the PR description closes or links as Addressed / Not addressed / Unclear (default warning; not applicable without a linked task or issue; unmet ones are flagged in a review comment)'
  )
  .option(
    '--task-details-on-public-repos <on|off>',
    "With --repo: quote the linked Lumo task's requirements on a PUBLIC repository's PRs too (default off: only the item and its outcome are shown there; private repositories always show them)"
  )
  .option(
    '--profile <quiet|chill|assertive>',
    'With --repo: which findings get inline comments — quiet = only HIGH and Done-blocking (MEDIUM and path-instruction findings listed in the summary), chill (default) = HIGH, MEDIUM and any finding a path instruction asked for, assertive = LOW too. Never changes detection or what blocks Done'
  )
  .option(
    '--tone <text>',
    'With --repo ("" clears; ≤250 chars): how the AI review words its findings and PR description, and Lumo its answers on the PR — wording only'
  )
  .option(
    '--path-instruction <glob=instructions>',
    'With --repo (repeatable; replaces the list, "" clears; ≤20): extra AI review instructions for files matching the glob, e.g. "scripts/**=Flag any console.log". They add checks, never remove one',
    collectList
  )
  .option(
    '--summary <description|comment|off>',
    "With --repo: where Lumo's high-level summary of each PR goes — description (default) = into the PR description (at an `@uselumo summary` line, else appended) and kept in sync on every review, comment = only in Lumo's summary comment, off = nowhere. Lumo only edits its own section of the description"
  )
  .option(
    '--sequence-diagrams <on|off>',
    "With --repo: a Mermaid sequence diagram of each PR's main call flow in the walkthrough of Lumo's summary comment (default on; trivial PRs never get one). `@uselumo diagram` on a PR draws it again"
  )
  .option('--confirm', 'The user approved the listed changes')
  .option('--json', 'Emit { switches, platform, effective } as JSON')
  .action(
    wrap(options =>
      workspaceSecurityScan(options as WorkspaceSecurityScanOptions)
    )
  )

const tagCmd = program
  .command('tag')
  .description('Workspace tags (labels) from the terminal')

tagCmd
  .command('list')
  .description(
    'List workspace tags with their color and how many tasks / docs carry each.'
  )
  .option('--json', 'Emit the tags as JSON')
  .action(wrap(options => tagList(options as { json?: boolean })))

tagCmd
  .command('create <name>')
  .description(
    'Create a tag (≤30 chars). A duplicate name is refused (409). To tag a task, use `task update --add-tag`.'
  )
  .option('--color <hex>', 'Tag color as #rrggbb')
  .action(
    wrap((name, options) =>
      tagCreate(name as string, options as { color?: string })
    )
  )

const projectCmd = program
  .command('project')
  .description('Inspect projects from the terminal')

projectCmd
  .command('list')
  .description(
    'List projects in the current workspace. Slug column matches `task create --project <ref>`.'
  )
  .option('--json', 'Print { version, projects, total, nextCursor } as JSON')
  .action(wrap(opts => projectList(opts as { json?: boolean })))

projectCmd
  .command('overview [project]')
  .description(
    "A project's health and stats as on its web page: stalled and high-stakes tasks, stale PRs, overdue, status mix, workload, recent completions and the latest summary. Read-only."
  )
  .option('--report', "Print the summary's full report under its TL;DR")
  .option('--json', 'Emit { project, stats, summary } as JSON')
  .action(
    wrap((ref, options) =>
      projectOverview(
        ref as string | undefined,
        options as { json?: boolean; report?: boolean }
      )
    )
  )

projectCmd
  .command('create <name>')
  .description('Create a project in the workspace (≤200 chars).')
  .option('-d, --description <text>', 'Project description')
  .action(
    wrap((name, options) =>
      projectCreate(name as string, options as { description?: string })
    )
  )

projectCmd
  .command('update <project>')
  .description(
    'Update a project (name or slug): --name, --description ("" clears), --owner (me | email | name; "" clears).'
  )
  .option('--name <text>', 'New project name')
  .option('-d, --description <text>', 'Description; empty string clears it')
  .option(
    '--owner <ref>',
    'Owner: me, an email or a member name; empty string clears it'
  )
  .action(
    wrap((ref, options) =>
      projectUpdate(ref as string, options as Record<string, string>)
    )
  )

const memoryCmd = program
  .command('memory')
  .description(
    'Team memory: add, list, show, update, delete; --scope task|project picks the scope'
  )

memoryCmd
  .command('add')
  .description(
    'Record a memory: only knowledge invisible in the codebase (the why, a runtime gotcha, a non-obvious failure). Task scope by default; --scope project when it helps any task in the project.'
  )
  .option(
    '--scope <scope>',
    'task | project (case-insensitive). Default: task, or project when only --project is given'
  )
  .option(
    '--task <LUM-N>',
    'The task (task scope; default: the session-bound task)'
  )
  .requiredOption(
    '--category <cat>',
    'trap | decision | convention | procedural (case-insensitive)'
  )
  .option('--trigger <text>', 'trap/procedural: the situation that triggers it')
  .option('--outcome <text>', 'trap: what goes wrong')
  .option('--workaround <text>', 'trap: optional fix')
  .option('--what <text>', 'decision: the decision')
  .option('--why <text>', 'decision: rationale')
  .option('--alternatives <text>', 'decision: optional alternatives considered')
  .option('--implications <text>', 'decision: optional implications')
  .option('--rule <text>', 'convention: the rule')
  .option('--applies <text>', 'convention: where the rule applies')
  .option('--workflow <text>', 'procedural: the workflow name')
  .option('--step <text>', 'procedural: a step (repeatable)', collect, [])
  .option(
    '--agent <agent>',
    'Producing agent: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (case-insensitive; default claude-code)'
  )
  .action(wrap((opts: unknown) => memoryAdd(opts as Record<string, never>)))

memoryCmd
  .command('list')
  .description(
    'List memories of a task (default: the bound task) or, with --scope project, of a project; --learnings lists the workspace PR-review learnings.'
  )
  .option(
    '--scope <scope>',
    'task | project (case-insensitive). Default: task, or project when only --project is given'
  )
  .option(
    '--task <LUM-N>',
    'The task (task scope; default: the session-bound task)'
  )
  .option(
    '--category <cat>',
    'Filter by trap|decision|convention|procedural (case-insensitive)'
  )
  .option('-n, --limit <count>', 'Cap output to the first N rows')
  .option(
    '--learnings',
    "The workspace's PR-review learnings (what reviewers told Lumo in review threads), newest first"
  )
  .option(
    '--repo <owner/name>',
    "With --learnings: only this repository's learnings"
  )
  .option(
    '--json',
    'Print { version, memories, total, nextCursor } as JSON ({ version, learnings } with --learnings)'
  )
  .action(wrap((opts: unknown) => memoryList(opts as Record<string, never>)))

memoryCmd
  .command('show <memory>')
  .description(
    "Show one memory's full card (category + content). <memory> = the 8-char short ref from listings and session-start index lines, a unique id prefix (6+ chars) or the full id."
  )
  .option('--json', 'Print { version, memory } as JSON')
  .action(
    wrap((id: unknown, opts: unknown) =>
      memoryShow(id as string, opts as { json?: boolean })
    )
  )

memoryCmd
  .command('update <memory>')
  .description(
    'Change a memory (<memory>: short ref, unique id prefix or full id). --scope project moves a task memory to the project scope — only when the lesson recurs across 2+ tasks.'
  )
  .option(
    '--scope <scope>',
    'project (a memory only moves from task to project)'
  )
  .action(
    wrap((id: unknown, opts: unknown) =>
      memoryUpdate(id as string, opts as { scope?: string })
    )
  )

memoryCmd
  .command('delete <memory>')
  .description(
    'Delete a memory (hard delete; <memory>: short ref, unique id prefix or full id). Without --confirm: exit 4 + a confirmation envelope showing the card.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .action(
    wrap((id: unknown, opts: unknown) =>
      memoryDelete(id as string, opts as { confirm?: boolean })
    )
  )

memoryCmd
  .command('sync')
  .description(
    'Downsync team memory into the local Claude Code memory store (team/*.md + a managed MEMORY.md block); never clobbers your own memory. Project from the bound session unless --project.'
  )
  .option(
    '--dir <path>',
    'Target memory dir (default: ~/.claude/projects/<cwd>/memory)'
  )
  .option('--dry-run', 'Print the reconcile plan without writing files')
  .option(
    '--clean',
    'Remove every file + index block sync owns (full rollback)'
  )
  .option(
    '--no-anchor-check',
    'Skip code-anchor staleness detection (the post-sync check that flags memories referencing deleted files/symbols)'
  )
  .action(
    wrap((opts: unknown) =>
      memorySync(
        opts as {
          project?: string
          dir?: string
          dryRun?: boolean
          clean?: boolean
          anchorCheck?: boolean
        }
      )
    )
  )

memoryCmd
  .command('push')
  .description(
    'Upsync locally-authored memories (<memory-dir>/outbox/*.json, each {category, content}) to the team. Pushed files are removed from the outbox on success.'
  )
  .option(
    '--dir <path>',
    'Memory dir (default: ~/.claude/projects/<cwd>/memory)'
  )
  .option('--dry-run', 'List what would be pushed without sending')
  .action(
    wrap((opts: unknown) =>
      memoryPush(opts as { project?: string; dir?: string; dryRun?: boolean })
    )
  )

memoryCmd
  .command('fold [project-ref]')
  .description(
    'Preview the autonomous topic-fold pass (folding itself runs daily, automatically). Requires --dry-run.'
  )
  .option(
    '--dry-run',
    'preview proposed subsystem cards + which fine cards they fold; writes nothing'
  )
  .action(
    wrap((ref: unknown, opts: unknown) =>
      memoryFold(ref as string | undefined, opts as { dryRun?: boolean })
    )
  )

const milestoneCmd = program
  .command('milestone')
  .description('Inspect milestones from the terminal')

milestoneCmd
  .command('list')
  .description(
    'List milestones for a project, 50 per page (--limit / --cursor). --project required when workspace has >1 project. By default only non-archived milestones are shown.'
  )
  .option('--archived', 'Show only archived milestones')
  .option('--all', 'Show both archived and non-archived milestones')
  .option(
    '--search <text>',
    'Filter by name/description substring (case-insensitive)'
  )
  .option('--limit <n>', 'Milestones per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option('--json', 'Print { version, milestones, total, nextCursor } as JSON')
  .action(wrap(options => milestoneList(options as Record<string, string>)))

milestoneCmd
  .command('create <name>')
  .description(
    'Create a milestone. --project required when workspace has >1 project.'
  )
  .option('-d, --description <text>', 'Milestone description')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--target <date>', 'Target date (YYYY-MM-DD)')
  .action(
    wrap((name, options) =>
      milestoneCreate(name as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('show <identifier>')
  .description(
    'Show a milestone: status, dates, description, task counts, and tasks under it. Identifier accepts the slug (as in the web URL), the name or the id.'
  )
  .option('--json', 'Print { version, milestone, tasks } as JSON')
  .action(
    wrap((identifier, options) =>
      milestoneShow(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('update <identifier>')
  .description(
    'Update a milestone: at least one of --name, --description, --start, --target, --token-budget ("" clears a nullable field). Completion is derived from its tasks.'
  )
  .option('-n, --name <text>', 'New name')
  .option('-d, --description <text>', 'New description (empty string to clear)')
  .option('--start <date>', 'Start date YYYY-MM-DD (empty string to clear)')
  .option('--target <date>', 'Target date YYYY-MM-DD (empty string to clear)')
  .option(
    '--token-budget <tokens>',
    'Advisory token budget, positive integer (empty string to clear). Overview shows burn vs budget; over-budget raises a risk-queue alert — never a hard gate.'
  )
  .action(
    wrap((identifier, options) =>
      milestoneUpdate(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('delete <identifier>')
  .description(
    'Delete a milestone. Tasks under it keep their data (milestoneId is cleared). Without --confirm: exit 4 + a confirmation envelope with the task count.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((identifier, options) =>
      milestoneDelete(
        identifier as string,
        options as { project?: string; confirm?: boolean; yes?: boolean }
      )
    )
  )

milestoneCmd
  .command('archive <identifier>')
  .description(
    'Archive a milestone (slug, name or id): hidden from `milestone list` by default, history and task links kept. Reversible with `milestone unarchive`.'
  )
  .action(
    wrap((identifier, options) =>
      milestoneArchive(identifier as string, options as { project?: string })
    )
  )

milestoneCmd
  .command('unarchive <identifier>')
  .description(
    'Restore an archived milestone so it shows in `milestone list` again. Identifier accepts the slug (as in the web URL), the name or the id.'
  )
  .action(
    wrap((identifier, options) =>
      milestoneUnarchive(identifier as string, options as { project?: string })
    )
  )

milestoneCmd
  .command('add <identifier> <tasks...>')
  .description(
    'Bind one or more tasks (LUM-N or UUID) to a milestone (slug, name or id). Reports each task with a tally; partial failures do not roll back.'
  )
  .action(
    wrap((identifier, tasks, options) =>
      milestoneAdd(
        identifier as string,
        tasks as string[],
        options as { project?: string }
      )
    )
  )

milestoneCmd
  .command('remove <identifier> <tasks...>')
  .description(
    'Unbind one or more tasks (LUM-N or UUID) from a milestone (slug, name or id). Tasks not in the milestone are skipped, never reassigned.'
  )
  .action(
    wrap((identifier, tasks, options) =>
      milestoneRemove(
        identifier as string,
        tasks as string[],
        options as { project?: string }
      )
    )
  )

milestoneCmd
  .command('triage <identifier> <tasks...>')
  .description(
    'Batch-mark tasks in a milestone agent-claimable (--claimable) or not (--not-claimable); tasks outside it are skipped. `lumo next --claimable` then surfaces them.'
  )
  .option('--claimable', 'Mark the listed tasks agent-claimable')
  .option('--not-claimable', 'Mark the listed tasks NOT agent-claimable')
  .action(
    wrap((identifier, tasks, options) =>
      milestoneTriage(
        identifier as string,
        tasks as string[],
        options as {
          project?: string
          claimable?: boolean
          notClaimable?: boolean
        }
      )
    )
  )

milestoneCmd
  .command('summary <identifier>')
  .description(
    'Show the AI-generated summary of a milestone (slug, name or id), or "(no summary generated yet)". --retry queues regeneration before fetching.'
  )
  .option('--retry', 'Trigger summary regeneration before fetching')
  .action(
    wrap((identifier, options) =>
      milestoneSummary(
        identifier as string,
        options as { project?: string; retry?: boolean }
      )
    )
  )

milestoneCmd
  .command('changelog <identifier>')
  .description(
    "Assemble a changelog from a milestone's DONE tasks, merged PRs and frozen claim snapshots (no LLM), with provenance per claim and a baseline vs prior milestones."
  )
  .option('--json', 'Emit the raw structured changelog payload')
  .action(
    wrap((identifier, options) =>
      milestoneChangelog(
        identifier as string,
        options as { project?: string; json?: boolean }
      )
    )
  )

milestoneCmd
  .command('reorder <refs...>')
  .description(
    "Reorder a project's milestones. Pass every milestone (slug, name or id) in the desired order. --project required when workspace has >1 project."
  )
  .action(
    wrap((refs, options) =>
      milestoneReorder(refs as string[], options as { project?: string })
    )
  )

milestoneCmd
  .command('move <ref>')
  .description(
    'Move one milestone before or after another. --before and --after are mutually exclusive; exactly one is required. --project required when workspace has >1 project.'
  )
  .option('--before <ref>', 'Place <ref> immediately before this milestone')
  .option('--after <ref>', 'Place <ref> immediately after this milestone')
  .action(
    wrap((ref, options) =>
      milestoneMove(
        ref as string,
        options as { project?: string; before?: string; after?: string }
      )
    )
  )

const milestoneTestCase = milestoneCmd
  .command('testcase')
  .description(
    "Milestone test cases: cross-task end-to-end cases. The close gate opens only when every case's latest run passed (or a proven defect was dispositioned known)."
  )

registerTestCaseCommands(milestoneTestCase, 'milestone')

const sprintCmd = program
  .command('sprint')
  .description('Inspect sprints from the terminal')

sprintCmd
  .command('list')
  .description(
    'List sprints for a team. --team required when workspace has >1 team. Sorted newest first.'
  )
  .option('--team <ref>', 'Team name or UUID')
  .option(
    '-s, --status <value>',
    'Filter by status: draft | active | closed (case-insensitive)'
  )
  .option('-n, --limit <count>', 'Show only the first N sprints')
  .option('--json', 'Print { version, sprints, total, nextCursor } as JSON')
  .action(wrap(options => sprintList(options as Record<string, string>)))

sprintCmd
  .command('show <identifier>')
  .description(
    'Show a sprint: status, dates, progress, and tasks. Identifier accepts a sprint number or UUID.'
  )
  .option('--team <ref>', 'Team name or UUID (when workspace has >1 team)')
  .option(
    '--json',
    'Print { version, sprint, progress, topBlockers, tasks, burnup, teamPerformance } as JSON'
  )
  .action(
    wrap((identifier, options) =>
      sprintShow(
        identifier as string,
        options as { team?: string; json?: boolean }
      )
    )
  )

sprintCmd
  .command('create')
  .description(
    'Create a draft sprint. --team required when workspace has >1 team. --start and --end (YYYY-MM-DD) required.'
  )
  .option('--team <ref>', 'Team name or UUID')
  .option(
    '-n, --name <text>',
    'Sprint name (server fills default when omitted)'
  )
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .action(wrap(options => sprintCreate(options as Record<string, string>)))

sprintCmd
  .command('update <identifier>')
  .description(
    'Update a sprint. Provide at least one of --name, --start, --end. Identifier accepts a sprint number or UUID. Empty strings are rejected — these fields cannot be cleared.'
  )
  .option('--team <ref>', 'Team name or UUID (when workspace has >1 team)')
  .option('-n, --name <text>', 'New sprint name')
  .option('--start <date>', 'New start date (YYYY-MM-DD)')
  .option('--end <date>', 'New end date (YYYY-MM-DD)')
  .action(
    wrap((identifier, options) =>
      sprintUpdate(identifier as string, options as Record<string, string>)
    )
  )

sprintCmd
  .command('delete <identifier>')
  .description(
    'Delete a DRAFT sprint. Without --confirm: exit 4 + a confirmation envelope with the task count. Server rejects ACTIVE/CLOSED sprints.'
  )
  .option('--team <ref>', 'Team name or UUID (informational)')
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((identifier, options) =>
      sprintDelete(identifier as string, options as Record<string, unknown>)
    )
  )

sprintCmd
  .command('start <identifier>')
  .description('Transition a DRAFT sprint to ACTIVE.')
  .option('--team <ref>', 'Team name or UUID (informational)')
  .action(
    wrap((identifier, options) =>
      sprintStart(identifier as string, options as Record<string, string>)
    )
  )

sprintCmd
  .command('close <identifier>')
  .description(
    'Close an ACTIVE sprint. Unfinished tasks need --move-all (to the next sprint) or --backlog-all (to the backlog); either without --confirm exits 4 with an envelope.'
  )
  .option('--team <ref>', 'Team name or UUID (informational)')
  .option('--move-all', 'Move all unfinished tasks to the next sprint')
  .option('--backlog-all', 'Return all unfinished tasks to the backlog')
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((identifier, options) =>
      sprintClose(identifier as string, options as Record<string, unknown>)
    )
  )

sprintCmd
  .command('summary <identifier>')
  .description(
    'Show the AI-generated summary for a sprint. Identifier accepts a sprint number or UUID. Prints "(no summary generated yet)" when none exists. Use --retry to queue regeneration before fetching.'
  )
  .option('--team <ref>', 'Team name or UUID (when workspace has >1 team)')
  .option('--retry', 'Trigger summary regeneration before fetching')
  .action(
    wrap((identifier, options) =>
      sprintSummary(
        identifier as string,
        options as { team?: string; retry?: boolean }
      )
    )
  )

sprintCmd
  .command('add <identifier> <task>')
  .description('Add a task to a sprint. <task> accepts LUM-N or UUID.')
  .option('--team <ref>', 'Team name or UUID (informational)')
  .action(
    wrap((identifier, task, options) =>
      sprintAdd(
        identifier as string,
        task as string,
        options as Record<string, string>
      )
    )
  )

sprintCmd
  .command('remove <identifier> <task>')
  .description('Remove a task from a sprint. <task> accepts LUM-N or UUID.')
  .option('--team <ref>', 'Team name or UUID (informational)')
  .action(
    wrap((identifier, task, options) =>
      sprintRemove(
        identifier as string,
        task as string,
        options as Record<string, string>
      )
    )
  )

const doc = program.command('doc').description('Manage Lumo documents')

doc
  .command('create [title]')
  .description(
    'Create a document. Body from --content, --file or piped stdin (pick one); --scope defaults to personal. --task LUM-N binds it to a task, --parent files it under another doc.'
  )
  .option('--content <text>', 'Inline markdown content')
  .option('--file <path>', 'Read markdown content from file')
  .option(
    '--scope <scope>',
    'personal | workspace (case-insensitive; default: personal)'
  )
  .option('--task <LUM-N>', 'Bind to this task after creation')
  .option('--parent <doc>', 'File under this parent doc (slug, title or id)')
  .option('--tag <name>', 'Attach tag by name (repeatable)', collect, [])
  .option('--tag-id <cuid>', 'Attach tag by id (repeatable)', collect, [])
  .action(
    wrap((title, opts) =>
      docCreate(title as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('import')
  .description(
    'Import a document into Lumo; --gdoc <url> imports a Google Doc (one-way Google → Lumo)'
  )
  .requiredOption('--gdoc <url>', 'The Google Doc to import (its sharing URL)')
  .option(
    '--scope <scope>',
    'personal | workspace (case-insensitive; default: personal)'
  )
  .option('--task <LUM-N>', 'Bind the imported doc to this task')
  .action(
    wrap(opts => {
      const { gdoc, ...rest } = opts as ImportGdocOptions & { gdoc: string }
      return docImportGdoc(gdoc, rest)
    })
  )

doc
  .command('sync <doc>')
  .description('Re-sync a Google-imported doc (overwrites the Lumo body)')
  .action(wrap(ref => docSync(ref as string)))

doc
  .command('update <doc>')
  .description(
    'Update a document (<doc> = slug, case-insensitive title or id). Body from --content, --file or piped stdin; 422 if it drops tables/rows/headings unless --allow-shrink.'
  )
  .option('--title <text>', 'New title')
  .option('--content <text>', 'Replace content (inline)')
  .option('--file <path>', 'Replace content from file')
  .option('--scope <scope>', 'personal | workspace (case-insensitive)')
  .option(
    '--tag <name>',
    'Set tags by name (bulk replace, repeatable). Cannot be combined with --add-tag* / --remove-tag*',
    collect,
    []
  )
  .option(
    '--tag-id <cuid>',
    'Set tags by id (bulk replace, repeatable). Cannot be combined with --add-tag* / --remove-tag*',
    collect,
    []
  )
  .option('--add-tag <name>', 'Add tag by name (repeatable)', collect, [])
  .option('--add-tag-id <cuid>', 'Add tag by id (repeatable)', collect, [])
  .option(
    '--remove-tag <name>',
    'Remove tag by name (repeatable). Unknown names are find-or-create, so prefer --remove-tag-id to avoid orphan rows.',
    collect,
    []
  )
  .option(
    '--remove-tag-id <cuid>',
    'Remove tag by id (repeatable). Unknown ids are a no-op.',
    collect,
    []
  )
  .option(
    '--if-revision <n>',
    'Only apply if the doc body is still at this revision (from doc show); mismatch fails with a 409 conflict'
  )
  .option(
    '--allow-shrink',
    'Let the update through even when it drops tables/rows/headings versus the stored body (default: rejected with 422)'
  )
  .option(
    '--add-member <member>',
    'Share with a member: "me", an email or a display name (repeatable; PRIVATE docs become SHARED)',
    collect,
    []
  )
  .option(
    '--role <role>',
    'With --add-member: viewer | editor | manager (case-insensitive; default: viewer)'
  )
  .option(
    '--remove-member <member>',
    'Stop sharing with a member (repeatable; a member not on the list is a no-op)',
    collect,
    []
  )
  .option(
    '--add-task <LUM-N>',
    'Bind the document to a task (repeatable; idempotent)',
    collect,
    []
  )
  .option(
    '--remove-task <LUM-N>',
    'Unbind the document from a task (repeatable; a binding from @LUM-N in the body fails with 409)',
    collect,
    []
  )
  .action(
    wrap((reference, opts) =>
      docUpdateWithRelations(
        reference as string | undefined,
        opts as Record<string, never>
      )
    )
  )

doc
  .command('show <doc>')
  .description(
    "Show a document's header and body (doc = slug, title or id). --raw prints the byte-identical markdown source (the edit base); --section <heading> prints one section of it."
  )
  .option(
    '--raw',
    'Print the stored markdown source verbatim (no header); errors if absent'
  )
  .option(
    '--section <heading>',
    'Print one heading-addressed section of the markdown source (prefix with #… to pin depth, e.g. "## Status")'
  )
  .option(
    '--json',
    'Print { version, document } as JSON (not with --raw / --section)'
  )
  .option(
    '--members',
    'Print only the members the document is shared with (NAME  ROLE rows)'
  )
  .action(
    wrap((reference, opts) =>
      docShowWithMembers(
        reference as string | undefined,
        opts as {
          raw?: boolean
          section?: string
          json?: boolean
          members?: boolean
        }
      )
    )
  )

doc
  .command('patch <doc>')
  .description(
    'Replace one heading-addressed section of the markdown source, leaving the rest untouched. 409 on a concurrent edit; 422 if the section loses tables/rows/headings unless --allow-shrink.'
  )
  .requiredOption(
    '--section <heading>',
    'Heading of the section to replace (prefix with #… to pin depth)'
  )
  .option('--content <text>', 'New section content (inline markdown)')
  .option('--file <path>', 'New section content from file')
  .option(
    '--if-revision <n>',
    'Only apply if the doc body is still at this revision (from doc show)'
  )
  .option(
    '--allow-shrink',
    'Let the patch through even when it drops tables/rows/headings within the addressed section (default: rejected with 422)'
  )
  .action(
    wrap((reference, opts) =>
      docPatch(reference as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('append <doc>')
  .description(
    'Append markdown at the end of a heading-addressed section, or at the document end without --section. Pure insertion, the safest write for running logs; 409 on concurrent edits.'
  )
  .option(
    '--section <heading>',
    'Heading of the section to append into (omit to append at the document end)'
  )
  .option('--content <text>', 'Content to append (inline markdown)')
  .option('--file <path>', 'Content to append from file')
  .option(
    '--if-revision <n>',
    'Only apply if the doc body is still at this revision (from doc show)'
  )
  .action(
    wrap((reference, opts) =>
      docAppend(reference as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('diff <doc>')
  .description(
    'Compare the server-side markdown source against a local file. Exit 0 when byte-identical, 1 with a unified diff when divergent. Requires the doc to have a stored markdown source.'
  )
  .requiredOption('--file <path>', 'Local markdown file to compare against')
  .action(
    wrap((reference, opts) =>
      docDiff(reference as string | undefined, opts as { file?: string })
    )
  )

doc
  .command('rebuild-source <doc>')
  .description(
    'Regenerate the markdown source from the HTML body with a lossless serializer, re-enabling show --raw / diff / patch / append. 422 on a structure shrink; 409 if a source exists unless --force.'
  )
  .option(
    '--allow-shrink',
    'Commit even if the rebuilt source re-renders with fewer tables/rows/headings than the stored body (default: rejected with 422)'
  )
  .option(
    '--force',
    'Re-derive the source even when one already exists. Without it an existing source yields exit 4 + a confirmation envelope whose confirmCommand carries --force --confirm.'
  )
  .option(
    '--confirm',
    'The user has approved replacing the existing source; pair with --force as the envelope instructs'
  )
  .option(
    '--if-revision <n>',
    'Only apply if the doc body is still at this revision (from doc show)'
  )
  .action(
    wrap((reference, opts) =>
      docRebuildSource(
        reference as string | undefined,
        opts as {
          allowShrink?: boolean
          force?: boolean
          confirm?: boolean
          ifRevision?: string
        }
      )
    )
  )

doc
  .command('list')
  .description(
    'List documents visible to the current user, 50 per page (--limit / --cursor)'
  )
  .option(
    '--scope <scope>',
    'personal | workspace | all (case-insensitive; default: all)'
  )
  .option('--task <LUM-N>', 'Only docs bound to this task')
  .option('--limit <n>', 'Docs per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option('--tree', 'Render as an indented tree (paged in tree order)')
  .option('--json', 'Print { version, documents, total, nextCursor } as JSON')
  .action(wrap(opts => docList(opts as Record<string, string>)))

doc
  .command('move <doc>')
  .description(
    'Move a doc under a different parent or to top level. Exactly one of --parent or --root is required. The moved doc lands at the end of its new sibling list; reordering among siblings is web-UI only.'
  )
  .option('--parent <doc>', 'New parent doc (slug, title or id)')
  .option('--root', 'Move to top level (no parent)')
  .action(
    wrap((reference, opts) =>
      docMove(reference as string | undefined, opts as Record<string, unknown>)
    )
  )

doc
  .command('delete <doc>')
  .description(
    'Move a document and everything nested under it to the trash (restorable for 30 days from web Settings → Trash). Without --confirm: exit 4 with a confirmation envelope.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((reference, opts) =>
      docDelete(
        reference as string | undefined,
        opts as { confirm?: boolean; yes?: boolean }
      )
    )
  )

task
  .command('update <identifier>')
  .description(
    'Update a task: at least one of --title, --description, --status, --priority, --assignee, --milestone, --sprint or a tag flag. "" clears description, assignee, milestone or sprint.'
  )
  .option('-t, --title <text>', 'New title')
  .option('-d, --description <text>', 'New description (empty string to clear)')
  .option(
    '-s, --status <value>',
    'New status: backlog | todo | in_progress | in_review | done (case-insensitive)'
  )
  .option(
    '-p, --priority <level>',
    'New priority: low | medium | high | urgent (case-insensitive)'
  )
  .option(
    '-a, --assignee <ref>',
    'New assignee: email, name, or "me" (empty string to clear)'
  )
  .option(
    '--milestone <ref>',
    'Milestone slug (as in the web URL) or name (case-insensitive); empty string to unbind'
  )
  .option(
    '--sprint <ref>',
    'Sprint number or UUID to bind the task to; empty string to unbind from current sprint'
  )
  .option(
    '--due <date>',
    'Due date, YYYY-MM-DD (your local day); empty string to clear'
  )
  .option(
    '--claimable',
    'Mark the task agent-claimable (surfaces in `lumo next --claimable`)'
  )
  .option(
    '--not-claimable',
    'Mark the task NOT agent-claimable (mutually exclusive with --claimable)'
  )
  .option(
    '--tag <name>',
    'Set tags by name (bulk replace, repeatable). Cannot be combined with --add-tag* / --remove-tag*',
    collect,
    []
  )
  .option(
    '--tag-id <cuid>',
    'Set tags by id (bulk replace, repeatable). Cannot be combined with --add-tag* / --remove-tag*',
    collect,
    []
  )
  .option('--add-tag <name>', 'Add tag by name (repeatable)', collect, [])
  .option('--add-tag-id <cuid>', 'Add tag by id (repeatable)', collect, [])
  .option(
    '--remove-tag <name>',
    'Remove tag by name (repeatable). Unknown names are find-or-create, so prefer --remove-tag-id to avoid orphan rows.',
    collect,
    []
  )
  .option(
    '--remove-tag-id <cuid>',
    'Remove tag by id (repeatable). Unknown ids are a no-op.',
    collect,
    []
  )
  .option(
    '--confirm',
    'With --status done: the user approved the DONE envelope. Without it, DONE runs in one step when every linked PR (at least one) is merged and nothing blocks; else exits 4.'
  )
  .action(
    wrap((identifier, options) =>
      taskUpdate(identifier as string, options as Record<string, string>)
    )
  )

const worktree = program
  .command('worktree')
  .description(
    'Scaffold, remove, list and prune per-task git worktrees under .worktrees/. Repo-specific links/copies/notes come from .lumo/worktree.json. Local dev tooling; run add/rm from the main checkout.'
  )

worktree
  .command('add <identifier> [slug]')
  .description(
    'Create a worktree at .worktrees/<LUM-N>[-slug] on branch lumo/<LUM-N>[-slug] off origin/HEAD and apply .lumo/worktree.json. Run from the main checkout.'
  )
  .option(
    '--base <ref>',
    'Branch off this ref instead of the remote default branch (skips fetch)'
  )
  .option(
    '--no-fetch',
    'Do not fetch the remote default branch before branching'
  )
  .option(
    '--verify',
    'Run verifyCommand from .lumo/worktree.json in the new worktree to confirm a clean baseline. Without --confirm, exits 4 showing the exact command and creates nothing.'
  )
  .option(
    '--confirm',
    'The user has seen and approved the verifyCommand shown in the confirmation envelope. Only meaningful with --verify.'
  )
  .action(
    wrap((identifier, slug, options) => {
      const o = options as {
        base?: string
        fetch?: boolean
        verify?: boolean
        confirm?: boolean
      }
      return worktreeAdd(identifier as string, slug as string | undefined, {
        base: o.base,
        noFetch: o.fetch === false,
        verify: o.verify,
        confirm: o.confirm,
      })
    })
  )

worktree
  .command('rm <identifier>')
  .description(
    "Remove a task's worktree. Without --confirm (or with uncommitted changes and no --force) exits 4 with an envelope naming what would be discarded. Keeps the branch unless --delete-branch."
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .option('--force', 'Remove even with uncommitted changes (discards them)')
  .option(
    '--delete-branch',
    'Also delete the branch (git branch -d; refuses if unmerged)'
  )
  .action(
    wrap((identifier, options) =>
      worktreeRm(
        identifier as string,
        options as {
          confirm?: boolean
          yes?: boolean
          force?: boolean
          deleteBranch?: boolean
        }
      )
    )
  )

worktree
  .command('list')
  .description(
    'List worktrees under .worktrees/: task id, branch, dirty state, and whether node_modules is symlinked.'
  )
  .option('--json', 'Print { version, worktrees, total, nextCursor } as JSON')
  .action(wrap(opts => worktreeList(opts as { json?: boolean })))

worktree
  .command('prune')
  .description(
    'Remove the worktrees of DONE tasks, keeping any with uncommitted or unpushed work or the current directory inside. Without --confirm exits 4 with an envelope. Never deletes branches.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope. Without it the command exits 4 and prints what it would do.'
  )
  .action(wrap(options => worktreePrune(options as { confirm?: boolean })))

// Claude Code invokes `lumo hook <type>` per tool call, so these handlers
// must never crash the caller. Two invariants keep us safe:
//   1. `hookCommand` is stderr-silent and never throws (it catches internally
//      and routes failures to ~/.lumo/hook.log). That makes `wrap()` a
//      defensive no-op here — its process.exit(1) branch is unreachable.
//   2. `./commands/hook` and its transitive imports (`hook-runner`,
//      `hook-log`, `config`, `api`) must remain side-effect-free at module
//      scope, so a broken hook never fails at import time either.
const hook = program
  .command('hook')
  .description(
    'Coding-agent hook ingestion (invoked by Claude Code settings.json or Codex hooks.json, not humans)'
  )

// Slug → help-text for every `lumo hook <slug>` subcommand. Each one accepts
// an optional `--agent <token>` flag (baked into settings.json by `lumo init
// --agent <token>`); the value rides to the server as the X-Lumo-Agent header
// so auto-sedimented memories are attributed to the agent that produced them.
// Keep this list in sync with LUMO_HOOK_EVENTS (cli/src/lib/hooks-template.ts)
// and the server-side HookEventType slugs. The worktree-* pair is retired
// (RETIRED_LUMO_HOOK_EVENTS) but stays registered for settings written before.
const HOOK_SUBCOMMANDS: ReadonlyArray<readonly [HookPath, string]> = [
  [
    'pre-tool-use',
    'Forward a PreToolUse hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'post-tool-use',
    'Forward a PostToolUse hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'post-tool-use-failure',
    'Forward a PostToolUseFailure hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'user-prompt-submit',
    'Forward a UserPromptSubmit hook event to Lumo (reads JSON from stdin)',
  ],
  ['stop', 'Forward a Stop hook event to Lumo (reads JSON from stdin)'],
  [
    'stop-failure',
    'Forward a StopFailure hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'permission-request',
    'Forward a PermissionRequest hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'permission-denied',
    'Forward a PermissionDenied hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'session-start',
    'Forward a SessionStart hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'session-end',
    'Forward a SessionEnd hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'subagent-start',
    'Forward a SubagentStart hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'subagent-stop',
    'Forward a SubagentStop hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'worktree-create',
    'Retired: forwards a WorktreeCreate event; `lumo init` no longer installs it and removes old entries',
  ],
  [
    'worktree-remove',
    'Retired: forwards a WorktreeRemove event; `lumo init` no longer installs it and removes old entries',
  ],
  [
    'file-changed',
    'Forward a FileChanged hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'config-change',
    'Forward a ConfigChange hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'task-created',
    'Forward a TaskCreated hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'task-completed',
    'Forward a TaskCompleted hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'post-tool-batch',
    'Forward a PostToolBatch hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'user-prompt-expansion',
    'Forward a UserPromptExpansion hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'notification',
    'Forward a Notification hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'elicitation',
    'Forward an Elicitation hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'elicitation-result',
    'Forward an ElicitationResult hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'cwd-changed',
    'Forward a CwdChanged hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'instructions-loaded',
    'Forward an InstructionsLoaded hook event to Lumo (reads JSON from stdin)',
  ],
  // LUM-1051: Codex-only events (CODEX_HOOK_EVENTS in hooks-template.ts).
  [
    'pre-compact',
    'Forward a Codex PreCompact hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'post-compact',
    'Forward a Codex PostCompact hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'interrupt',
    'Forward a Codex Interrupt hook event to Lumo (reads JSON from stdin)',
  ],
]

for (const [slug, description] of HOOK_SUBCOMMANDS) {
  hook
    .command(slug)
    .description(description)
    .option(
      '--agent <token>',
      'Coding agent that owns this session (e.g. claude-code, codex). Baked in by `lumo init --agent`.'
    )
    .action(
      wrap((opts: unknown) =>
        hookCommand(slug, (opts as { agent?: string }).agent)
      )
    )
}

// LUM-1232 batch F (HT-1): `Examples:` / `Exit codes:` sections, after every
// command is registered. Data lives in cli/src/lib/help-text.ts.
attachHelpSections(
  program as unknown as Parameters<typeof attachHelpSections>[0]
)

/**
 * LUM-1233 3a: whether `flag` takes a value on the registered command at
 * `path` — so a tombstone counts positionals the way Commander would (the
 * value of `--result pass` is not a second argument).
 */
function optionTakesValue(path: string, flag: string): boolean {
  let node = program as unknown as {
    commands: readonly { name(): string }[]
    options: readonly {
      long?: string
      short?: string
      required: boolean
      optional: boolean
    }[]
  }
  for (const word of path.split(' ')) {
    const next = node.commands.find(c => c.name() === word)
    if (!next) break
    node = next as unknown as typeof node
  }
  // LUM-1233 3g: a command's own options first, then the global ones
  // (`--project <ref>` is defined once on the program).
  const opt =
    node.options.find(o => o.long === flag || o.short === flag) ??
    (program as unknown as typeof node).options.find(
      o => o.long === flag || o.short === flag
    )
  return opt ? opt.required || opt.optional : false
}

// LUM-1233 (RN-3): a removed command never runs — it fails with exit 2 and
// names its replacement. Checked before Commander, so tombstones never show in
// --help or grammar.json.
const removedCommand =
  !isUpdateCheckWorker && !isIntrospect
    ? findRemovedCommand(process.argv.slice(2), optionTakesValue)
    : null
if (removedCommand) {
  for (const line of removedCommandLines(removedCommand)) console.error(line)
  exitWith(EXIT_USAGE)
} else if (!isUpdateCheckWorker && !isIntrospect) {
  program.parseAsync(process.argv).catch(err => {
    for (const line of describeThrownError(err)) console.error(line)
    exitWith(EXIT_ERROR)
  })
}

// Exported for introspection tooling only (LUMO_CLI_INTROSPECT=1); the real
// CLI entry never imports this module.
export { program }
