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
import { nextCommand } from './commands/next'
import { cost } from './commands/cost'
import { report } from './commands/report'
import { priority, priorityList } from './commands/priority'
import {
  crossingExplain,
  type CrossingExplainOptions,
} from './commands/crossing-explain'
import {
  crossingDisposition,
  type CrossingDispositionOptions,
} from './commands/crossing-disposition'
import { outcomeShow } from './commands/outcome'
import { taskContext } from './commands/task-context'
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
import { auditList, type AuditListOptions } from './commands/audit-list'
import { tagCreate, tagList } from './commands/tag'
import { taskDelete } from './commands/task-delete'
import { taskHistory } from './commands/task-history'
import { projectCreate, projectUpdate } from './commands/project-manage'
import { taskShow } from './commands/task-show'
import { taskStatus } from './commands/task-status'
import { taskComment } from './commands/task-comment'
import { taskFigmaAdd } from './commands/task-figma-add'
import { taskFigmaList } from './commands/task-figma-list'
import { taskFigmaRm } from './commands/task-figma-rm'
import { taskFigmaRefresh } from './commands/task-figma-refresh'
import { memoryTaskList } from './commands/memory-task-list'
import { memoryTaskAdd } from './commands/memory-task-add'
import { memoryProjectList } from './commands/memory-project-list'
import { memoryProjectAdd } from './commands/memory-project-add'
import { memoryPromote } from './commands/memory-promote'
import { memoryRm } from './commands/memory-rm'
import { memoryShow } from './commands/memory-show'
import { memorySync } from './commands/memory-sync'
import { memoryPush } from './commands/memory-push'
import { memoryFold } from './commands/memory-fold'
import { taskArtifactAdd } from './commands/task-artifact-add'
import { taskArtifactList } from './commands/task-artifact-list'
import { taskArtifactShow } from './commands/task-artifact-show'
import { taskArtifactRm } from './commands/task-artifact-rm'
import { taskArtifactUpdate } from './commands/task-artifact-update'
import { taskTestCaseAdd } from './commands/task-testcase-add'
import { taskTestCaseList } from './commands/task-testcase-list'
import { taskTestCaseShow } from './commands/task-testcase-show'
import { taskTestCaseUpdate } from './commands/task-testcase-update'
import { taskTestCaseRm } from './commands/task-testcase-rm'
import { taskTestCaseRun } from './commands/task-testcase-run'
import { taskTestCaseDisposition } from './commands/task-testcase-disposition'
import {
  findingDisposition,
  type FindingDispositionOptions,
} from './commands/finding-disposition'
import { taskWrapup } from './commands/task-wrapup'
import { taskSlackShow } from './commands/task-slack-show'
import { taskWebShow } from './commands/task-web-show'
import { taskFigmaContext } from './commands/task-figma-context'
import { taskCommentList } from './commands/task-comment-list'
import { taskCommentEdit, taskCommentRm } from './commands/task-comment-manage'
import {
  taskDepsList,
  taskDepsAdd,
  taskDepsConfirm,
  taskDepsDismiss,
  taskDepsRm,
} from './commands/task-deps'
import { taskPrShow } from './commands/task-pr-show'
import { prScan, type PrScanOptions } from './commands/pr-scan'
import {
  workspaceSecurityScan,
  type WorkspaceSecurityScanOptions,
} from './commands/workspace-security-scan'
import { taskLineage } from './commands/task-lineage'
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
import {
  milestoneTestCaseAdd,
  milestoneTestCaseList,
  milestoneTestCaseShow,
  milestoneTestCaseUpdate,
  milestoneTestCaseRm,
  milestoneTestCaseRun,
  milestoneTestCaseDisposition,
} from './commands/milestone-testcase'
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
import { docUpdate } from './commands/doc-update'
import { docShow } from './commands/doc-show'
import { docDiff } from './commands/doc-diff'
import { docRebuildSource } from './commands/doc-rebuild-source'
import { docPatch, docAppend } from './commands/doc-section-edit'
import { docList } from './commands/doc-list'
import { docDelete } from './commands/doc-delete'
import { docBind } from './commands/doc-bind'
import { docUnbind } from './commands/doc-unbind'
import { docShare } from './commands/doc-share'
import { docUnshare } from './commands/doc-unshare'
import { docShareList } from './commands/doc-share-list'
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
import { sanitizeField } from './lib/sanitize'
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

function exitWith(code: number): never {
  const hint = authTracker?.hintFor(code)
  if (hint) console.error(hint)
  const netHint = sandboxNetTracker?.hintFor(code)
  if (netHint) console.error(netHint)
  const versionHint = versionTracker?.hintFor(code)
  if (versionHint) console.error(versionHint)
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

type CommandFn = (...args: unknown[]) => Promise<number | void>

/**
 * Exit-code convention (LUM-755). A command returns the code to propagate:
 *   0 / undefined  success
 *   1              general error (message on stderr)
 *   4              confirmation required — a mutation that needs the user's
 *                  approval printed a `confirmation_required` envelope on
 *                  stdout (see cli/src/lib/confirmation.ts); re-run the
 *                  envelope's `confirmCommand` once the user has approved
 *   5              blocked by a human-only gate — the server refused the
 *                  change (today: a DONE gate) and the CLI printed a
 *                  `DONE_BLOCKED` error on stdout listing every blocker
 *                  (see cli/src/lib/blocked-error.ts); nothing on the CLI
 *                  can clear it — relay it, don't retry
 * 2 (auth) and 3 (validation) are reserved for a later pass.
 */
function wrap(fn: CommandFn) {
  return async (...args: unknown[]) => {
    try {
      const code = await fn(...args)
      if (typeof code === 'number' && code !== 0) exitWith(code)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${sanitizeField(msg)}`)
      exitWith(1)
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
  .showHelpAfterError(
    '(run the command with --help to list its valid flags and arguments)'
  )
  // LUM-686: global mute for the trailing next-step block. `LUMO_NO_HINTS=1`
  // does the same for a whole shell.
  .option('--no-hints', 'suppress the trailing next-step suggestions')

// Commander does not merge program-level options into a subcommand's own
// opts(), so the global `--no-hints` is folded into the env channel before any
// action runs. One silencing path (`nextStepsSilenced`) instead of two.
program.hook('preAction', (thisCommand, actionCommand) => {
  if (thisCommand.opts().hints === false) process.env.LUMO_NO_HINTS = '1'
  versionTracker?.setCommand(commandPathOf(actionCommand))
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

function registerInit(name: string, hidden: boolean): void {
  program
    .command(name, hidden ? { hidden: true } : undefined)
    .description(
      hidden
        ? 'Alias of `lumo init` (kept for older docs and scripts).'
        : "Set up Lumo for Claude Code and Codex together: the skill into .claude/skills/ and .agents/skills/, hook handlers into .claude/settings.json and .codex/hooks.json (which you then trust in Codex /hooks), and a Codex rule (.codex/rules/lumo.rules) that lets `lumo` commands reach the Lumo API from Codex's sandbox. --agent <token> sets up just that agent. Run via `npx @lumoai/cli init` for first-time onboarding; re-run it to refresh an install (unchanged files are not rewritten), with --dry-run to preview."
    )
    .option(
      '--user',
      'Install into ~/.claude and ~/.agents + ~/.codex (applies across all projects for this user)'
    )
    .option(
      '--project',
      'Install into ./.claude and ./.agents + ./.codex (applies to the current project only)'
    )
    .option(
      '--force',
      'Overwrite existing skill files (SKILL.md + references/) even when they were modified locally, and a .codex/rules/lumo.rules Lumo did not write'
    )
    .option(
      '--agent <token>',
      'Set up only this agent (claude-code, codex, cursor, gemini-cli, github-copilot, windsurf). Baked into every hook command; codex installs the Codex skill layout, .codex/hooks.json and .codex/rules/lumo.rules, the others the Claude Code layout. Without it, init sets up claude-code and codex.'
    )
    .option(
      '--dry-run',
      'Print what this init would change — per file the path, the action and a unified diff (JSON hook files show only the Lumo entries, the rest folded; the git hook only its Lumo block), and which Codex hooks would need Trust — without writing any file, marker or registry record'
    )
    // LUM-1118: removed; kept hidden only to print the migration error.
    .addOption(new Option('--upgrade').hideHelp())
    .action(
      wrap(options =>
        init(
          options as {
            user?: boolean
            project?: boolean
            force?: boolean
            agent?: string
            upgrade?: boolean
            dryRun?: boolean
          }
        )
      )
    )
}

registerInit('init', false)
// `setup` is the pre-LUM-1052 name; hidden alias running the same action.
registerInit('setup', true)

const skill = program
  .command('skill')
  .description(
    'Report or refresh only the Lumo skill copies (SKILL.md + references/) — never hooks, settings, Codex hooks/rules or the git hook'
  )

skill
  .command('status')
  .description(
    'Read-only: every Lumo skill copy (user ~/.claude, ~/.agents, this repo, recorded installs) with scope, agent, version and state vs this CLI (up to date / behind CLI / newer than CLI / modified / source) and whether git tracks it'
  )
  .option(
    '--json',
    'Machine-readable output: { schemaVersion, cliVersion, skills: [{ path, scope, agent, version, state, gitTracked }] }'
  )
  .action(wrap(options => skillStatus(options as { json?: boolean })))

skill
  .command('update')
  .description(
    "Refresh the Lumo skill copies that are behind this CLI from the bundled skill — the user copies and the current repo's copies only (copies recorded in other repos are listed, not written: run it in that repo). Never downgrades a newer copy, skips locally modified copies unless --force, never touches the Lumo source repo skill; git-tracked copies are changed but not committed. Hooks, settings, Codex hooks/rules and the git hook are left alone (re-running `lumo init` refreshes those)."
  )
  .option('--user', 'Only user-scope copies (~/.claude, ~/.agents)')
  .option(
    '--project',
    "Only the current repo's copies (git toplevel of the cwd; in a worktree, the worktree)"
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
          user?: boolean
          project?: boolean
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
    'Read-only report of every Lumo install on this machine and repo (skills, Claude/Codex hooks, the Codex rule, git hook): version, state, and the command that fixes it. Warns on missing hook events, `lumo` missing from PATH, untrusted Codex hooks and Codex installs where `lumo` has no network in the sandbox; always exits 0.'
  )
  .option('--json', 'Machine-readable output')
  .action(wrap(options => doctor(options as { json?: boolean })))

program
  .command('uninstall')
  .description(
    'Remove what `lumo init` installed: Lumo skill dirs, Lumo hook entries in Claude settings and Codex hooks.json (~/.codex or ./.codex), the Lumo Codex rule (.codex/rules/lumo.rules), the marked block in prepare-commit-msg, and the install registry records. Locally edited skill copies are skipped unless --force; foreign hooks and file content are kept. Without --confirm prints a confirmation envelope (exit 4) listing every path; never commits. Ends with the manual `npm rm -g @lumoai/cli` step.'
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
  .command('explain [id]')
  .description(
    'Append an agent self-explanation ("申辩") to a boundary crossing (LUM-542). Append-only and for the human reviewer — it never clears the crossing or unblocks Done (a human dispositions that). Several crossings in one call: --file with a JSON array of {"id","note"} (LUM-845); each is reported. Targets crossings on the session-bound task.'
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
    "Rule on one or more boundary crossings from the terminal (LUM-769; several ids = one batch per ruling, LUM-845 — each step prints ONE envelope listing every crossing in full and carrying one receipt per crossing as --receipt <id>=<token>,…; drop an id between steps to leave that crossing OPEN; every write is reported per crossing) through a three-step confirmation handshake the server enforces: (1) no step flag — prints the crossing (severity, detail, agent explanations) as an envelope with a stage-1 read receipt, exit 4, writes nothing; (2) --confirm-read --receipt <r1> after the user confirms they READ it — returns the stage-2 receipt and a second envelope for the ruling, exit 4; (3) --confirm --receipt <r2> after the user approves the ruling — writes. Confirming before the read is acknowledged is refused and told to confirm the read first. Relay each envelope; never supply a step flag yourself. Either ruling clears the crossing's block on DONE and is audited as a CLI-channel disposition. Reverting to OPEN and repository suppression rules stay web-only. Targets a crossing on the session-bound task unless --task is given."
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
    "Read receipt(s) from the previous step's envelope (its confirmCommand carries them — a bare token for one crossing, <id>=<token>,… for a batch); required with --confirm-read (stage 1) and --confirm (stage 2), verified server-side per crossing"
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
  .description('Rule on PR security findings with user approval (LUM-1128)')

finding
  .command('disposition <ids...>')
  .description(
    "Record the user's ruling on one or more PR security findings (LUM-1128) — how a blocking finding is cleared for DONE (the web panel stays a second surface). Without --confirm it reads the findings from the server and prints ONE confirmation envelope (one line per finding: id, severity, title, ruling, note), exit 4, writes nothing; relay it and re-run its confirmCommand only after the user approves. With --confirm it applies each ruling, reports each finding, and the server records it as channel CLI (actor, session, time); the web panel can correct it. Ids are listed by `lumo task status`. Targets findings on the session-bound task unless --task is given."
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

const outcome = program
  .command('outcome')
  .description('Read the post-hoc outcome well (LUM-598)')

outcome
  .command('show <task>')
  .description(
    'Read the post-hoc outcome well for a task: the falsifier verdict (REJECTED | INCONCLUSIVE — never a "pass") plus its backing rejection signals. INCONCLUSIVE means no rejection on record, NOT satisfied.'
  )
  .action(wrap((task: unknown) => outcomeShow(task as string)))

program
  .command('next')
  .description(
    'Recommend the next task(s) to work on, ranked by priority, active sprint, and due date. Prints top N (default 3); pick one and run `session attach` + `task context`. Use --claimable to restrict to the autonomy boundary (claimable ∩ unblocked ∩ in-budget).'
  )
  .option('-n, --count <N>', 'Number of tasks to recommend (default 3)')
  .option(
    '--claimable',
    'Only recommend agent-claimable tasks that are unblocked (F3) and within milestone budget (F2)'
  )
  .action(
    wrap(options =>
      nextCommand(options as { count?: string; claimable?: boolean })
    )
  )

program
  .command('cost')
  .description(
    'Show per-operation (per-tool) token cost. Defaults to a workspace 30-day window; scope with --task / --session'
  )
  .option('--task <id>', 'Aggregate a single task (e.g. LUM-42)')
  .option('--session <id>', 'Aggregate a single Claude Code or Codex session')
  .option(
    '--since <date>',
    'Workspace window lower bound (ISO date); default last 30 days'
  )
  .option(
    '--by <dim>',
    'Headline grouping: tool | model | member | session (case-insensitive; default tool)'
  )
  .option('--json', 'Emit the versioned payload as JSON')
  .action(
    wrap(options =>
      cost(
        options as {
          task?: string
          session?: string
          since?: string
          by?: string
          json?: boolean
        }
      )
    )
  )

program
  .command('report')
  .description(
    'Summarize token usage and tasks completed over a window of local days (default: last 7 days incl. today). Team totals plus a per-member split; --member me for just yourself'
  )
  .option(
    '--since <day>',
    'First day, inclusive: a YYYY-MM-DD date, Nd for the N days ending on --until (default: incl. today; e.g. 30d), today, or yesterday'
  )
  .option(
    '--until <day>',
    'Last day, inclusive: a YYYY-MM-DD date, today, or yesterday (default today)'
  )
  .option('--member <ref>', 'Only this member: me, an email, or a display name')
  .option('--project <name>', 'Only tasks (and their sessions) in this project')
  .option('--limit <N>', 'Max completed tasks listed (default 50, max 500)')
  .option('--json', 'Emit the versioned payload as JSON')
  .action(
    wrap(options =>
      report(
        options as {
          since?: string
          until?: string
          member?: string
          project?: string
          limit?: string
          json?: boolean
        }
      )
    )
  )

const priorityCmd = program
  .command('priority [text]')
  .description(
    'Declare the team priority (append-only). With [text] records it directly; with no argument prompts interactively for 1-3 sentences. A newer declaration supersedes the old without deleting it.'
  )
  .action(wrap((text: unknown) => priority(text as string | undefined)))

priorityCmd
  .command('list')
  .description(
    'Print the team priority append history, newest-first (the current declaration is marked with *).'
  )
  .action(wrap(() => priorityList()))

const pr = program
  .command('pr')
  .description('Inspect pull requests by number — linked to a task or not')

pr.command('scan <number>')
  .option(
    '--review <mode>',
    'Request incremental or full AI review without counting toward the automatic budget'
  )
  .option('--pause', 'Pause automatic AI reviews for this PR')
  .option(
    '--resume',
    'Resume automatic AI review of every push and reset the reviewed-commit count'
  )
  .option(
    '--limit <commits>',
    'This PR pauses after N reviewed commits (1..100, over the workspace setting), with pause or resume'
  )
  .description(
    'Read PR scans and control automatic AI reviews. Use --review incremental|full to request a review, or --pause / --resume to control automatic review of every push (paused after N reviewed commits). Rule on a finding with `lumo finding disposition` (exit-4 envelope, the user approves).'
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
      prScan(number as string, options as PrScanOptions)
    )
  )

const session = program
  .command('session')
  .description('Manage per-terminal coding-session context')

session
  .command('attach <identifier>')
  .description(
    'Attach the current Claude Code or Codex session to a task — or, with --steward, to a MILESTONE as a governance session (LUM-640: plan/accept only). Either binding is a lifetime lock: re-attaching the same target is a no-op, anything else is refused — start a new session instead.'
  )
  .option(
    '--steward',
    'Bind as a STEWARD (governance) session to a milestone (id, name, or slug) instead of a task. Steward sessions plan and accept only: self-dispatch to in_progress is refused, and implementation commits/PRs are recorded as boundary crossings.'
  )
  .option(
    '--worktree',
    "Create this task's worktree under .worktrees/ when none exists (LUM-825; only from the main checkout; failures never fail attach). Default: .lumo/worktree.json autoWorktree, else off."
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
  .action(wrap(() => sessionStatus()))

const usage = program.command('usage').description('Token usage maintenance')

usage
  .command('resync')
  .description(
    'Correct historical (inflated) token usage from local transcripts (LUM-932). Dry run by default — prints what would change; add --apply to write. Sends token counts only, never transcript content.'
  )
  .option('--apply', 'Write the corrections (default is a dry run)')
  .option('--json', 'Print the merged server response as JSON')
  .action(
    wrap(options => usageResync(options as { apply?: boolean; json?: boolean }))
  )

const task = program
  .command('task')
  .description('Inspect tasks from the terminal')

task
  .command('context <identifier>')
  .description(
    'Print a task + prior session summaries as markdown, for pasting into a coding agent on startup. Memory prints one headline per item (full card: lumo memory show <id>).'
  )
  .option(
    '--full',
    'Print full memory bodies and the judged-used track-record footer instead of the one-line index'
  )
  .action(
    wrap((identifier, options) =>
      taskContext(identifier as string, options as { full?: boolean })
    )
  )

task
  .command('list')
  .description(
    'List tasks assigned to you, 50 per page. Filter with --status, --project, --milestone; page with --limit / --cursor (a longer list ends with "Showing X-Y of N." and the next-page command).'
  )
  .option(
    '-s, --status <value>',
    'Filter by status: backlog | todo | in_progress | in_review | done (case-insensitive)'
  )
  .option('-p, --project <ref>', 'Filter by project name (case-insensitive)')
  .option('-n, --limit <count>', 'Tasks per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option(
    '-m, --milestone <ref>',
    'Filter by milestone name or UUID (scopes to my tasks under that milestone)'
  )
  .option('--json', 'Emit { tasks, total, nextCursor } as JSON')
  .action(wrap(options => taskList(options as Record<string, string>)))

task
  .command('search [query]')
  .description(
    'Search tasks across the whole workspace (any assignee). [query] terms must all match title/description (or a task number like LUM-42); typo-tolerant and ranked by relevance unless --exact. Every filter is applied server-side; 50 per page (--limit / --cursor, a longer result ends with "Showing X-Y of N." and the next-page command).'
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
  .option('--project <ref>', 'Project name or slug')
  .option('-m, --milestone <ref>', 'Milestone name or UUID')
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
    'Move a task and all its subtasks to the trash (restorable for 30 days from web Settings → Trash, then permanently deleted). Without --confirm: exit 4 + a confirmation envelope listing what goes with it.'
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
  .command('history <identifier>')
  .description(
    'Show the task field-change history (status, priority, title, assignee, due, tags, sprint), oldest first.'
  )
  .option(
    '-n, --limit <count>',
    'Entries per page, newest page first (1-500, default 50)'
  )
  .option(
    '--cursor <cursor>',
    'Continue with earlier entries (from the footer)'
  )
  .option('--json', 'Emit the raw activity entries of this page as JSON')
  .action(
    wrap((identifier, options) =>
      taskHistory(
        identifier as string,
        options as { limit?: string; cursor?: string; json?: boolean }
      )
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
  .command('show <identifier>')
  .description(
    'Show a single task: title, status, priority, assignee, project, URL, description.'
  )
  .action(wrap(identifier => taskShow(identifier as string)))

task
  .command('wrapup [task]')
  .description(
    'Whole wrap-up in one read (LUM-841): test-case signals, security scans, open boundary crossings (each ready to relay, with the per-ruling disposition command), and DONE readiness with the DONE envelope preview (linked PR merge state + local worktree cleanup). Read-only: requests no receipt, changes no status. Defaults to the session-bound task.'
  )
  .action(wrap(taskArg => taskWrapup(taskArg as string | undefined)))

task
  .command('status [task]')
  .description(
    'Task self-check (LUM-344): nextActions (undispositioned security findings + test-case advisories), security-scan coverage, and open boundary crossings. Read-only, no LLM. Defaults to the session-bound task. Run it first when resuming a task. --full adds the dashboard sections (cost, struggle/rework trail, trend).'
  )
  .option(
    '--json',
    'Emit the versioned machine-readable payload (version field; breaking changes bump it)'
  )
  .option(
    '--full',
    'Also print the dashboard sections: cost, struggle/rework trail, trend'
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
    'Reply to a top-level comment: its #id from `task comments list` (unique prefix of 6+ chars)'
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
  .option('--project <ref>', 'Project name or slug')
  .option('--milestone <ref>', 'Milestone name (case-insensitive)')
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
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
  .action(
    wrap((taskId: unknown) => taskFigmaList({ identifier: taskId as string }))
  )

taskFigma
  .command('rm <task> <link-id-or-url>')
  .description('Remove a Figma link from a task (idempotent)')
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

// Tier-2 retrieval commands (LUM-122). `task context` prints the matching
// command at the end of each cheap inline card; the agent runs it to pull the
// full content on demand.
const taskSlack = task.command('slack').description('Inspect Slack context')
taskSlack
  .command('show <identifier> <contextId>')
  .description('Show the full stored Slack thread snapshot')
  .action(wrap((id, ctx) => taskSlackShow(id as string, ctx as string)))

const taskWeb = task.command('web').description('Inspect web link content')
taskWeb
  .command('show <identifier> <linkId>')
  .description('Show the fetched web link body as plain text')
  .action(wrap((id, link) => taskWebShow(id as string, link as string)))

// taskFigma already exists above → attach the context leaf to it.
taskFigma
  .command('context <identifier> <linkId>')
  .description('Show the cached Figma design context (metadata)')
  .action(wrap((id, link) => taskFigmaContext(id as string, link as string)))

// Plural `comments` parent: `task comment <id> <body>` already exists for
// adding a comment, and commander disallows a duplicate name.
const taskComments = task
  .command('comments')
  .description('Read and manage the task comment thread')
taskComments
  .command('list <identifier>')
  .description(
    'List the task comment thread, 50 top-level threads per page (--limit / --cursor; capped to the output budget; --full alone prints every comment)'
  )
  .option('--full', 'Print every comment, bypassing the output-token cap')
  .option('--limit <n>', 'Top-level threads per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .action(
    wrap((id, opts) =>
      taskCommentList(
        id as string,
        opts as { full?: boolean; limit?: string; cursor?: string }
      )
    )
  )
taskComments
  .command('edit <identifier> <comment> <body>')
  .description(
    'Replace the text of one of your own comments. <comment> is its #id from `task comments list` (unique prefix of 6+ chars).'
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
    'Task dependency edges — detected candidates + confirmed blockers'
  )
taskDeps
  .command('list <identifier>')
  .description('List dependency edges (both directions)')
  .action(wrap(id => taskDepsList(id as string)))
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
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
  .action(wrap((id, num) => taskPrShow(id as string, num as string)))

task
  .command('lineage <identifier>')
  .description(
    "Show the causal trail: which context fragments fed this task, each fragment's outcome, and the token/loop cost of the run that consumed it"
  )
  .option(
    '--signal',
    'Append usage-signal health section (fetches /api/lineage/signal)'
  )
  .action(
    wrap((id, options) =>
      taskLineage(id as string, options as { signal?: boolean })
    )
  )

const taskMemory = task
  .command('memory')
  .description('View and record memories scoped to a task')

taskMemory
  .command('list [task]')
  .description(
    "List a task's memories. <task> defaults to the session-bound task."
  )
  .option(
    '--category <cat>',
    'Filter by trap|decision|convention|procedural (case-insensitive)'
  )
  .option('-n, --limit <count>', 'Cap output to the first N rows')
  .action(
    wrap((taskArg: unknown, opts: unknown) =>
      memoryTaskList(
        taskArg as string | undefined,
        opts as Record<string, string>
      )
    )
  )

taskMemory
  .command('add [task]')
  .description(
    'Record a memory on a task (<task> defaults to the bound session). ' +
      'Record only knowledge invisible in the codebase (the why, a runtime gotcha, a non-obvious failure, a non-trivial workflow); skip routine work. ' +
      'Pick --category then its fields.'
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
  .action(
    wrap((taskArg: unknown, opts: unknown) =>
      memoryTaskAdd(
        taskArg as string | undefined,
        opts as Record<string, unknown>
      )
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
  .command('update <task> <artifact-id>')
  .description(
    'Update an artifact’s kind / title / source (not content). Provide at least one flag.'
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
  .action(wrap((taskId: unknown) => taskArtifactList(taskId as string)))

taskArtifact
  .command('show <task> <artifact-id>')
  .description(
    'Show one artifact (key:value header + content body). Find <artifact-id> in `artifact list` column 1.'
  )
  .action(
    wrap((taskId: unknown, artifactId: unknown) =>
      taskArtifactShow(taskId as string, artifactId as string)
    )
  )

taskArtifact
  .command('rm <task> <artifact-id>')
  .description(
    'Delete an artifact from a task (irreversible). Without --confirm: exit 4 + a confirmation envelope naming the artifact.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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

const taskTestCase = task
  .command('testcase')
  .description(
    'Structured test cases on a task (setup / steps / verification / expected) and their run records'
  )

taskTestCase
  .command('add <task>')
  .description(
    'Add a test case. --step / --verify are repeatable and keep the order they appear in.'
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
    wrap((taskId: unknown, options: unknown) =>
      taskTestCaseAdd(taskId as string, options as Record<string, never>)
    )
  )

taskTestCase
  .command('list <task>')
  .description(
    "List a task's test cases with each one's latest run (result, environment, commit)"
  )
  .action(wrap((taskId: unknown) => taskTestCaseList(taskId as string)))

taskTestCase
  .command('show <task/case>')
  .description(
    'Show one test case (four sections, 1-based step numbers) plus its run history. Handle: LUM-42/TC3'
  )
  .action(wrap((handle: unknown) => taskTestCaseShow(handle as string)))

taskTestCase
  .command('update <task/case>')
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
    wrap((handle: unknown, options: unknown) =>
      taskTestCaseUpdate(handle as string, options as Record<string, never>)
    )
  )

taskTestCase
  .command('rm <task/case>')
  .description(
    'Remove a test case (soft delete - its run history stays readable). Without --confirm: exit 4 + a confirmation envelope.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((handle: unknown, options: unknown) =>
      taskTestCaseRm(
        handle as string,
        options as { confirm?: boolean; yes?: boolean }
      )
    )
  )

taskTestCase
  .command('run <task/case>')
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
    'The PR whose change this run exercised (must be linked to this task)'
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
    'Per-step result (repeatable): <step>=<result>[@duration], where <step> is s<n> for a step or v<n> for a verification check (ranges like s1-3) and <result> is pass or fail, e.g. s1-3=pass, v1=fail@0.3s. Steps you do not report are shown as "no per-step result", never as passed',
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
    wrap((handle: unknown, options: unknown) =>
      taskTestCaseRun(handle as string, options as Record<string, never>)
    )
  )

taskTestCase
  .command('disposition <task/case>')
  .description(
    "Rule on a test case whose latest run proved an implementation defect — clears that run's block on DONE. Three-step handshake; never add a step flag yourself."
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
    wrap((handle: unknown, options: unknown) =>
      taskTestCaseDisposition(
        handle as string,
        options as Record<string, never>
      )
    )
  )

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
    'Show or change the PR security-scan switches (LUM-1002): the master scan switch, AI review and exploit-path hunt, with the platform ceiling and what actually runs, plus the request-changes workflow (LUM-1130), whether PR authors may resolve/approve by command (LUM-1142), the learnings scope (LUM-1134) and how many reviewed commits pause automatic review of a PR (LUM-1137). LUM-1133: --repos lists, and --repo <owner/name> --review/--drafts changes, the per-repository automatic review of PRs without a task (default on, drafts skipped). Any member may read; changing is OWNER only, and turning anything off (or the request-changes workflow or author approval on, or the learnings scope to global) exits 4 with a confirmation envelope until --confirm.'
  )
  .option(
    '--scan <on|off>',
    'Master switch: off = no layer runs, no PR comment'
  )
  .option('--ai-review <on|off>', 'AI review (LLM security review and triage)')
  .option('--hunt <on|off>', 'Exploit-path hunt in the sandbox')
  .option(
    '--request-changes <on|off>',
    'Request-changes workflow (default off): Lumo requests changes while threads or Done-blocking findings are open, approves when clean'
  )
  .option(
    '--allow-author-approval <on|off>',
    'PR authors may run `@uselumo resolve` / `approve` on their own PR (default on; CodeRabbit allow_author_approval); off = only other write-access accounts'
  )
  .option(
    '--learnings-scope <local|global|auto>',
    'Which repositories’ learnings the AI review reads (default auto): local = the reviewed repository, global = every repository in this workspace, auto = local for public / global for private repositories'
  )
  .option(
    '--auto-pause-after <n>',
    'Every push to a PR gets an automatic AI review until N commits are reviewed (default 5, 0 = never pause; a PR’s own `pr scan --resume --limit` wins)'
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
  .action(wrap(() => projectList()))

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

const projectMemory = projectCmd
  .command('memory')
  .description('View and record PROJECT-scope memories')

projectMemory
  .command('list [project]')
  .description(
    "List a project's PROJECT-scope memories. <project> defaults to the bound task's project."
  )
  .option(
    '--category <cat>',
    'Filter by trap|decision|convention|procedural (case-insensitive)'
  )
  .option('-n, --limit <count>', 'Cap output to the first N rows')
  .action(
    wrap((p: unknown, opts: unknown) =>
      memoryProjectList(p as string | undefined, opts as Record<string, string>)
    )
  )

projectMemory
  .command('add [project]')
  .description(
    "Record a PROJECT-scope memory. Use PROJECT scope only when the lesson helps any task in the project. <project> defaults to the bound task's project."
  )
  .requiredOption(
    '--category <cat>',
    'trap | decision | convention | procedural (case-insensitive)'
  )
  .option('--trigger <text>', 'trap/procedural trigger')
  .option('--outcome <text>', 'trap outcome')
  .option('--workaround <text>', 'trap optional workaround')
  .option('--what <text>', 'decision')
  .option('--why <text>', 'decision rationale')
  .option('--alternatives <text>', 'decision optional alternatives')
  .option('--implications <text>', 'decision optional implications')
  .option('--rule <text>', 'convention rule')
  .option('--applies <text>', 'convention: where it applies')
  .option('--workflow <text>', 'procedural workflow')
  .option('--step <text>', 'procedural step (repeatable)', collect, [])
  .option(
    '--agent <agent>',
    'Producing agent: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (case-insensitive; default claude-code)'
  )
  .action(
    wrap((p: unknown, opts: unknown) =>
      memoryProjectAdd(p as string | undefined, opts as Record<string, unknown>)
    )
  )

const memoryCmd = program
  .command('memory')
  .description(
    'Operate on a single memory by id (see `lumo task memory` / `lumo project memory` to list/add)'
  )

memoryCmd
  .command('show <memoryId>')
  .description(
    "Show one memory's full card by id (category + content). Use to pull the body of a memory you saw as a one-line index entry at session start."
  )
  .action(wrap((id: unknown) => memoryShow(id as string)))

memoryCmd
  .command('promote <memoryId>')
  .description(
    'Promote a TASK memory to PROJECT scope. Only when the lesson recurs across 2+ tasks.'
  )
  .action(wrap((id: unknown) => memoryPromote(id as string)))

memoryCmd
  .command('rm <memoryId>')
  .description(
    'Delete a memory (hard delete). Without --confirm: exit 4 + a confirmation envelope showing the card.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .action(
    wrap((id: unknown, opts: unknown) =>
      memoryRm(id as string, opts as { confirm?: boolean; yes?: boolean })
    )
  )

memoryCmd
  .command('sync')
  .description(
    'Downsync team memory into the local Claude Code memory store (team/*.md + a managed MEMORY.md block). Only touches files it owns; never clobbers your own memory. Resolves the project from the bound session unless --project is given.'
  )
  .option(
    '--project <ref>',
    'Project to sync (name/slug/id); default = bound session'
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
    'Upsync locally-authored memories (<memory-dir>/outbox/*.json, each {category, content}) to the team via the existing create-project-memory pipeline. Pushed files are removed from the outbox on success.'
  )
  .option(
    '--project <ref>',
    'Project to push to (name/slug/id); default = bound session'
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
  .option('--project <ref>', 'Project name or slug')
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
  .action(wrap(options => milestoneList(options as Record<string, string>)))

milestoneCmd
  .command('create <name>')
  .description(
    'Create a milestone. --project required when workspace has >1 project.'
  )
  .option('--project <ref>', 'Project name or slug')
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
    'Show a milestone: status, dates, description, task counts, and tasks under it. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneShow(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('update <identifier>')
  .description(
    'Update a milestone. Provide at least one of --name, --description, --start, --target, --token-budget. Use "" to clear nullable fields. Completion is derived from task completion (LUM-714) — there is no status flag.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
    'Archive a milestone: hidden from `milestone list` by default, history and task links preserved, reversible with `milestone unarchive`. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneArchive(identifier as string, options as { project?: string })
    )
  )

milestoneCmd
  .command('unarchive <identifier>')
  .description(
    'Restore an archived milestone so it shows in `milestone list` again. Identifier accepts UUID or name.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneUnarchive(identifier as string, options as { project?: string })
    )
  )

milestoneCmd
  .command('add <identifier> <tasks...>')
  .description(
    'Bind one or more tasks to a milestone in one call. <identifier> accepts a name or UUID; each <task> accepts LUM-N or UUID. Per-task result with a tally; partial failures do not roll back.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
    'Unbind one or more tasks from a milestone in one call. Tasks not currently in the milestone are skipped (idempotent), never reassigned. <identifier> accepts a name or UUID; each <task> accepts LUM-N or UUID.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
    'Batch-mark tasks agent-claimable within a milestone (steward triage, LUM-646). Choose a direction: --claimable or --not-claimable. Tasks not in the milestone are skipped. <identifier> accepts a name or UUID; each <task> accepts LUM-N or UUID. `lumo next --claimable` then surfaces only claimable ∩ unblocked ∩ in-budget tasks.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
    'Show the AI-generated summary for a milestone. Identifier accepts a milestone name or UUID. Prints "(no summary generated yet)" when none exists. Use --retry to queue regeneration before fetching.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
    "Assemble a structured changelog from the milestone's DONE tasks + merged PRs + frozen claimSnapshot (pure assembly, no LLM; runs on any status). Headline counts carry a baseline vs prior completed milestones; every claim shows provenance. Identifier accepts a milestone name or UUID. --json emits the raw structured payload."
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
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
    "Reorder a project's milestones. Pass every milestone (name or UUID) in the desired order. --project required when workspace has >1 project."
  )
  .option('--project <ref>', 'Project name or slug')
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
  .option('--project <ref>', 'Project name or slug')
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
    'Milestone test cases — cross-task end-to-end cases and the milestone close contract (LUM-1135). The close gate opens only when every case’s latest run passed (or a proven defect was dispositioned known).'
  )

milestoneTestCase
  .command('add <milestone>')
  .description(
    'Add a milestone test case. --step / --verify are repeatable and keep the order they appear in.'
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
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, options: unknown) =>
      milestoneTestCaseAdd(ms as string, options as Record<string, never>)
    )
  )

milestoneTestCase
  .command('list <milestone>')
  .description(
    "List a milestone's test cases with each one's latest run (result, environment, commit)"
  )
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, options: unknown) =>
      milestoneTestCaseList(ms as string, options as { project?: string })
    )
  )

milestoneTestCase
  .command('show <milestone> <case>')
  .description(
    'Show one test case (four sections, 1-based step numbers) plus its run history. Case: TC3'
  )
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, caseRef: unknown, options: unknown) =>
      milestoneTestCaseShow(
        ms as string,
        caseRef as string,
        options as { project?: string }
      )
    )
  )

milestoneTestCase
  .command('update <milestone> <case>')
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
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, caseRef: unknown, options: unknown) =>
      milestoneTestCaseUpdate(
        ms as string,
        caseRef as string,
        options as Record<string, never>
      )
    )
  )

milestoneTestCase
  .command('rm <milestone> <case>')
  .description(
    'Remove a milestone test case (soft delete - its run history stays readable). Without --confirm: exit 4 + a confirmation envelope.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
  )
  .option('--yes', 'Alias of --confirm (kept for compatibility)')
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, caseRef: unknown, options: unknown) =>
      milestoneTestCaseRm(
        ms as string,
        caseRef as string,
        options as { project?: string; confirm?: boolean; yes?: boolean }
      )
    )
  )

milestoneTestCase
  .command('run <milestone> <case>')
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
    'Per-step result (repeatable): <step>=<result>[@duration], where <step> is s<n> for a step or v<n> for a verification check (ranges like s1-3) and <result> is pass or fail, e.g. s1-3=pass, v1=fail@0.3s. Steps you do not report are shown as "no per-step result", never as passed',
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
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, caseRef: unknown, options: unknown) =>
      milestoneTestCaseRun(
        ms as string,
        caseRef as string,
        options as Record<string, never>
      )
    )
  )

milestoneTestCase
  .command('disposition <milestone> <case>')
  .description(
    "Rule on a test case whose latest run proved an implementation defect — clears that run's hold on the milestone close gate. Three-step handshake; never add a step flag yourself."
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
  .option(
    '--project <ref>',
    'Project name or slug (needed when the milestone name is ambiguous)'
  )
  .action(
    wrap((ms: unknown, caseRef: unknown, options: unknown) =>
      milestoneTestCaseDisposition(
        ms as string,
        caseRef as string,
        options as Record<string, never>
      )
    )
  )

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
  .action(wrap(options => sprintList(options as Record<string, string>)))

sprintCmd
  .command('show <identifier>')
  .description(
    'Show a sprint: status, dates, progress, and tasks. Identifier accepts a sprint number or UUID.'
  )
  .option('--team <ref>', 'Team name or UUID (when workspace has >1 team)')
  .action(
    wrap((identifier, options) =>
      sprintShow(identifier as string, options as { team?: string })
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
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
    'Close an ACTIVE sprint. With no unfinished tasks, closes immediately. Pass --move-all to move unfinished tasks to the next sprint, or --backlog-all to return them to the backlog; either mode without --confirm exits 4 with a confirmation envelope listing the tasks that would move.'
  )
  .option('--team <ref>', 'Team name or UUID (informational)')
  .option('--move-all', 'Move all unfinished tasks to the next sprint')
  .option('--backlog-all', 'Return all unfinished tasks to the backlog')
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
    'Create a new document. Body comes from --content, --file, or piped stdin (pick one). --scope defaults to personal. Use --task LUM-N to bind the new doc to a task, --parent to file it under another doc.'
  )
  .option('--content <text>', 'Inline markdown content')
  .option('--file <path>', 'Read markdown content from file')
  .option(
    '--scope <scope>',
    'personal | workspace (case-insensitive; default: personal)'
  )
  .option('--project <ref>', 'Project name or slug to file under')
  .option('--task <LUM-N>', 'Bind to this task after creation')
  .option('--parent <doc>', 'File under this parent doc (cuid or title)')
  .option('--tag <name>', 'Attach tag by name (repeatable)', collect, [])
  .option('--tag-id <cuid>', 'Attach tag by id (repeatable)', collect, [])
  .action(
    wrap((title, opts) =>
      docCreate(title as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('import-gdoc <url>')
  .description('Import a Google Doc as a Lumo doc (one-way Google → Lumo)')
  .option(
    '--scope <scope>',
    'personal | workspace (case-insensitive; default: personal)'
  )
  .option('--task <LUM-N>', 'Bind the imported doc to this task')
  .action(
    wrap((url, opts) => docImportGdoc(url as string, opts as ImportGdocOptions))
  )

doc
  .command('sync <doc>')
  .description('Re-sync a Google-imported doc (overwrites the Lumo body)')
  .action(wrap(ref => docSync(ref as string)))

doc
  .command('update <doc>')
  .description(
    'Update an existing document. <doc> accepts a cuid or a case-insensitive title (ambiguous titles fail with candidates). Replacement body comes from --content, --file, or piped stdin (pick one). A body update that drops tables/rows/headings versus the stored body is rejected with 422 (structure guard) unless --allow-shrink is passed. --tag/--tag-id (bulk replace) cannot be combined with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id.'
  )
  .option('--title <text>', 'New title')
  .option('--content <text>', 'Replace content (inline)')
  .option('--file <path>', 'Replace content from file')
  .option('--scope <scope>', 'personal | workspace (case-insensitive)')
  .option('--project <ref>', 'Project name/slug; pass "" to clear')
  .option(
    '--tag <name>',
    'Set tags by name (bulk replace, repeatable)',
    collect,
    []
  )
  .option(
    '--tag-id <cuid>',
    'Set tags by id (bulk replace, repeatable)',
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
  .action(
    wrap((reference, opts) =>
      docUpdate(reference as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('show <doc>')
  .description(
    'Show document header and body (doc = title or cuid). --raw prints the byte-identical markdown source of the last markdown upload (a legal edit base); it errors when no markdown source is stored instead of falling back to the lossy HTML→markdown render. --section <heading> prints just that section of the markdown source (revision goes to stderr).'
  )
  .option(
    '--raw',
    'Print the stored markdown source verbatim (no header); errors if absent'
  )
  .option(
    '--section <heading>',
    'Print one heading-addressed section of the markdown source (prefix with #… to pin depth, e.g. "## Status")'
  )
  .action(
    wrap((reference, opts) =>
      docShow(
        reference as string | undefined,
        opts as { raw?: boolean; section?: string }
      )
    )
  )

doc
  .command('patch <doc>')
  .description(
    'Replace one heading-addressed section of the markdown source (heading line included), leaving every byte outside the section untouched. Requires the doc to have a stored markdown source. Commits conditionally on the body revision: a concurrent edit fails with 409 instead of being overwritten. A replacement that drops tables/rows/headings within the addressed section is rejected with 422 (structure guard) unless --allow-shrink is passed.'
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
    'Append markdown at the end of a heading-addressed section (before the next same-or-higher heading), or at the document end when --section is omitted. Pure insertion — no existing byte is modified — which makes it the safest write for running logs/ledgers. 409 on concurrent edits.'
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
    "Regenerate the stored markdown source from the doc's HTML body using a lossless serializer (tables/rows/headings round-trip), re-enabling doc show --raw / diff / patch / append for a source-less doc. The rebuilt source is structure-guarded: any table/tr/heading shrink is rejected with 422 (no silent flattening) unless --allow-shrink is passed. A doc that already has a source is refused with 409 unless --force re-derives it (replacing a byte-faithful source with a serializer-derived one)."
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
    'The user has approved replacing the existing source (LUM-755); pair with --force as the envelope instructs'
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
  .option('--project <ref>', 'Filter by project name/slug')
  .option('--task <LUM-N>', 'Only docs bound to this task')
  .option('--limit <n>', 'Docs per page (1-500, default 50)')
  .option(
    '--cursor <cursor>',
    'Continue from a previous page (from the footer)'
  )
  .option('--tree', 'Render as an indented tree (paged in tree order)')
  .action(wrap(opts => docList(opts as Record<string, string>)))

doc
  .command('move <doc>')
  .description(
    'Move a doc under a different parent or to top level. Exactly one of --parent or --root is required. The moved doc lands at the end of its new sibling list; reordering among siblings is web-UI only.'
  )
  .option('--parent <doc>', 'New parent doc (cuid or title)')
  .option('--root', 'Move to top level (no parent)')
  .action(
    wrap((reference, opts) =>
      docMove(reference as string | undefined, opts as Record<string, unknown>)
    )
  )

doc
  .command('delete <doc>')
  .description(
    'Move a document and everything nested under it to the trash (restorable for 30 days by its owner from web Settings → Trash, then permanently deleted). Without --confirm: exit 4 + a confirmation envelope with the title.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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

doc
  .command('bind <doc> <task>')
  .description(
    'Bind a document to a task by adding an EXPLICIT mention row. Idempotent. If a CONTENT-derived mention already exists for the same pair, it is upgraded to EXPLICIT so `doc unbind` can later remove it.'
  )
  .action(
    wrap((docRef, task) =>
      docBind(docRef as string | undefined, task as string | undefined)
    )
  )

doc
  .command('unbind <doc> <task>')
  .description(
    'Unbind a document from a task. Removes EXPLICIT mentions only — purely CONTENT-derived mentions (from @LUM-N in the body) cannot be removed via CLI and fail with 409; edit the doc body in the web UI instead.'
  )
  .action(
    wrap((docRef, task) =>
      docUnbind(docRef as string | undefined, task as string | undefined)
    )
  )

doc
  .command('share <doc> <member>')
  .description(
    'Share a document with a workspace member. PRIVATE docs are auto-promoted to SHARED. <member> accepts "me", an email, or a display name.'
  )
  .option(
    '--role <role>',
    'viewer | editor | manager (case-insensitive; default: viewer)'
  )
  .action(
    wrap((docRef, member, opts) =>
      docShare(
        docRef as string | undefined,
        member as string | undefined,
        opts as { role?: string }
      )
    )
  )

doc
  .command('unshare <doc> <member>')
  .description(
    'Remove a member from a document\'s share list. Idempotent — prints "Not shared with …" if no row exists.'
  )
  .action(
    wrap((docRef, member) =>
      docUnshare(docRef as string | undefined, member as string | undefined)
    )
  )

doc
  .command('share-list <doc>')
  .description(
    'List the members a document is shared with, as fixed-width rows: <displayName>  <ROLE>.'
  )
  .action(wrap(docRef => docShareList(docRef as string | undefined)))

task
  .command('update <identifier>')
  .description(
    'Update a task. Provide at least one of --title, --description, --status, --priority, --assignee, --milestone, --sprint, or tag flags. Use "" to clear description, assignee, milestone, or sprint binding. --tag/--tag-id (bulk replace) cannot be combined with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id.'
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
    'Milestone name (case-insensitive); empty string to unbind'
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
    'Set tags by name (bulk replace, repeatable)',
    collect,
    []
  )
  .option(
    '--tag-id <cuid>',
    'Set tags by id (bulk replace, repeatable)',
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
    'With --status done: the user has approved the DONE transition shown in the confirmation envelope (LUM-755). Without it, --status done with no other flag runs in one step when every linked PR (at least one) is merged and nothing blocks DONE (LUM-1106); otherwise it exits 4 and prints the envelope (status change, every linked PR, a ⚠ line for unmerged ones) instead of a prompt.'
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
    'Create a worktree at .worktrees/<LUM-N>[-slug] on branch lumo/<LUM-N>[-slug] off the remote default branch (origin/HEAD), link node_modules when present, copy the husky shim when husky owns hooks, and apply .lumo/worktree.json (linkPaths, copyPaths, notes). Run from the main checkout.'
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
    'The user has seen and approved the verifyCommand shown in the confirmation envelope (LUM-755). Only meaningful with --verify.'
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
    'Remove the worktree for a task (git worktree remove). Without --confirm — or with uncommitted changes and no --force — exits 4 with a confirmation envelope naming the path, branch and what would be discarded. Keeps the branch unless --delete-branch.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
  .action(wrap(() => worktreeList()))

worktree
  .command('prune')
  .description(
    'Remove the worktrees of tasks that are already DONE (closed on the web or another machine too). Keeps any worktree with uncommitted changes, commits that are neither pushed nor the head of a merged linked PR, or the current directory inside it. Without --confirm exits 4 with an envelope listing what goes and what stays. Never deletes branches.'
  )
  .option(
    '--confirm',
    'The user has approved the change shown in the confirmation envelope (LUM-755). Without it the command exits 4 and prints what it would do.'
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
// and the server-side HookEventType slugs.
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
    'Forward a WorktreeCreate hook event to Lumo (reads JSON from stdin)',
  ],
  [
    'worktree-remove',
    'Forward a WorktreeRemove hook event to Lumo (reads JSON from stdin)',
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

if (!isUpdateCheckWorker && !isIntrospect) {
  program.parseAsync(process.argv).catch(err => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${sanitizeField(msg)}`)
    process.exit(1)
  })
}

// Exported for introspection tooling only (LUMO_CLI_INTROSPECT=1); the real
// CLI entry never imports this module.
export { program }
