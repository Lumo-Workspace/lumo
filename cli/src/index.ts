#!/usr/bin/env node
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Command } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'
import { hookCommand } from './commands/hook'
import type { HookPath } from './lib/hook-runner'
import { sessionAttach } from './commands/session-attach'
import { sessionStatus } from './commands/session-status'
import { nextCommand } from './commands/next'
import { ideaCapture, ideaList, ideaUpdate } from './commands/idea'
import { ideaSlackAdd } from './commands/idea-slack-add'
import { ideaSlackShow } from './commands/idea-slack-show'
import { ideaSlackRm } from './commands/idea-slack-rm'
import { ideaWebAdd } from './commands/idea-web-add'
import { ideaWebShow } from './commands/idea-web-show'
import { ideaWebRm } from './commands/idea-web-rm'
import { ideaFigmaAdd } from './commands/idea-figma-add'
import { ideaFigmaList } from './commands/idea-figma-list'
import { ideaFigmaRm } from './commands/idea-figma-rm'
import { ideaFigmaRefresh } from './commands/idea-figma-refresh'
import { ideaFigmaContext } from './commands/idea-figma-context'
import { ideaComment, ideaCommentList } from './commands/idea-comment'
import { initiativeCreate, initiativeList } from './commands/initiative'
import { plan, planStatus, type PlanOptions } from './commands/plan'
import { cost } from './commands/cost'
import { priority, priorityList } from './commands/priority'
import { criteriaAudit } from './commands/criteria-audit'
import { verify } from './commands/verify'
import {
  crossingExplain,
  type CrossingExplainOptions,
} from './commands/crossing-explain'
import {
  crossingDisposition,
  type CrossingDispositionOptions,
} from './commands/crossing-disposition'
import {
  outcomeShow,
  outcomeRate,
  type OutcomeRateOptions,
} from './commands/outcome'
import { taskContext } from './commands/task-context'
import { taskCreate } from './commands/task-create'
import { taskUpdate } from './commands/task-update'
import { taskList } from './commands/task-list'
import { taskSearch } from './commands/task-search'
import { taskStatuses } from './commands/task-statuses'
import { memberList } from './commands/member-list'
import { tagCreate, tagList } from './commands/tag'
import {
  initiativeProgressAdd,
  initiativeProgressList,
  initiativeUpdate,
  type InitiativeUpdateOptions,
} from './commands/initiative-manage'
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
import { taskCriteriaSet } from './commands/task-criteria-set'
import { taskCriteriaList } from './commands/task-criteria-list'
import { taskCriteriaConfirm } from './commands/task-criteria-confirm'
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
import { milestoneCriteriaSet } from './commands/milestone-criteria-set'
import { milestoneCriteriaList } from './commands/milestone-criteria-list'
import { milestoneCriteriaVerdict } from './commands/milestone-criteria-verdict'
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
import { setup } from './commands/setup'
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

// Introspection mode: tooling (scripts/analysis grammar extraction) imports
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
  runBackgroundRefresh(process.argv[3] as string)
    .catch(() => {})
    .finally(() => process.exit(0))
} else if (!isIntrospect) {
  printUpdateNoticeIfAny(pkg.name, pkg.version)
  maybeRefreshInBackground(pkg.name)
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
      if (typeof code === 'number' && code !== 0) process.exit(code)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${sanitizeField(msg)}`)
      process.exit(1)
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
program.hook('preAction', thisCommand => {
  if (thisCommand.opts().hints === false) process.env.LUMO_NO_HINTS = '1'
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
  .description('Show the currently logged-in identity')
  .action(wrap(whoami))

program
  .command('update')
  .description(
    `Check npm for a newer ${pkg.name} and install it globally if available.`
  )
  .action(wrap(update))

program
  .command('setup')
  .description(
    'Install the Lumo Claude Code skill and wire hook handlers into .claude/settings.json. Run via `npx @lumoai/cli setup` for first-time onboarding.'
  )
  .option(
    '--user',
    'Install into ~/.claude (applies across all projects for this user)'
  )
  .option(
    '--project',
    'Install into ./.claude (applies to the current project only)'
  )
  .option(
    '--force',
    'Overwrite existing skill files (SKILL.md + references/) when they differ from the bundled version'
  )
  .option(
    '--agent <token>',
    'Coding agent these hooks run under (claude-code, codex, cursor, gemini-cli, github-copilot, windsurf). Baked into every hook command. Defaults to claude-code.'
  )
  .action(
    wrap(options =>
      setup(
        options as {
          user?: boolean
          project?: boolean
          force?: boolean
          agent?: string
        }
      )
    )
  )

program
  .command('verify [task]')
  .description(
    'Machine verification loop (LUM-343): run every MACHINE criterion checkpointer locally, report structured verdicts to the server (round cap 3), and print next actions. All-pass moves the task to IN_REVIEW. Defaults to the session-bound task.'
  )
  .option(
    '--timeout <seconds>',
    'Per-checkpointer timeout in seconds (default 600)'
  )
  .option(
    '--note <text>',
    'Optional one-line self-report — what you did and why it is ready. When given, it is recorded as your claim (source AGENT) when the round passes into IN_REVIEW.'
  )
  .action(
    wrap((task: unknown, options: unknown) =>
      verify(
        task as string | undefined,
        options as { timeout?: string; note?: string }
      )
    )
  )

const crossing = program
  .command('crossing')
  .description(
    'Inspect, annotate and (with user approval) disposition boundary crossings'
  )

crossing
  .command('explain <id>')
  .description(
    'Append an agent self-explanation ("申辩") to a boundary crossing (LUM-542). Append-only and for the human reviewer — it never clears the crossing or unblocks Done (a human dispositions that). Targets a crossing on the session-bound task.'
  )
  .requiredOption(
    '--note <text>',
    'The explanation to record (the rationale for the action / why it may be a false positive)'
  )
  .action(
    wrap((id: unknown, options: unknown) =>
      crossingExplain(id as string, options as CrossingExplainOptions)
    )
  )

crossing
  .command('disposition <id>')
  .description(
    "Rule on a boundary crossing from the terminal (LUM-769) through a three-step confirmation handshake the server enforces: (1) no step flag — prints the crossing (severity, detail, agent explanations) as an envelope with a stage-1 read receipt, exit 4, writes nothing; (2) --confirm-read --receipt <r1> after the user confirms they READ it — returns the stage-2 receipt and a second envelope for the ruling, exit 4; (3) --confirm --receipt <r2> after the user approves the ruling — writes. Confirming before the read is acknowledged is refused and told to confirm the read first. Relay each envelope; never supply a step flag yourself. Either ruling clears the crossing's block on DONE and is audited as a CLI-channel disposition. Reverting to OPEN and repository suppression rules stay web-only. Targets a crossing on the session-bound task unless --task is given."
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
    "Read receipt from the previous step's envelope (its confirmCommand carries it); required with --confirm-read (stage 1 receipt) and --confirm (stage 2 receipt), verified server-side"
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
    wrap((id: unknown, options: unknown) =>
      crossingDisposition(id as string, options as CrossingDispositionOptions)
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

outcome
  .command('rate')
  .description(
    'Trust × post-hoc fate: per delivery-time forecast-confidence bracket, the post-hoc REJECTED rate from the outcome well. Honest by construction — thin brackets read "insufficient" and the high-vs-low comparison stays "inconclusive" until the well has enough signal. The rate is a LOWER BOUND (no signal = INCONCLUSIVE, never satisfied).'
  )
  .option(
    '--min <N>',
    'Per-bracket sample floor below which a rate is withheld (default 10)'
  )
  .option('--json', 'Emit the report as JSON')
  .action(wrap(options => outcomeRate(options as OutcomeRateOptions)))

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

const ideaCmd = program
  .command('idea [statement]')
  .description(
    'Capture a team-level idea into the pool (<10s, no friction). Grabs the current Claude Code session id and its bound task as provenance; prints an I-prefixed id (e.g. LUM-I42). The transformer (Spec 2) consumes the pool.'
  )
  .option('-c, --context <text>', 'Free-text origin context for the idea')
  .action(
    wrap((statement, options) =>
      ideaCapture(
        statement as string | undefined,
        options as { context?: string }
      )
    )
  )

ideaCmd
  .command('list')
  .description(
    'List the team idea pool newest-first — each line shows the LUM-I<n> id, status (CAPTURED|DEVELOPING|PLANNED|DROPPED) and statement.'
  )
  .action(wrap(() => ideaList()))

ideaCmd
  .command('update <id>')
  .description(
    'Move an idea through its lifecycle (LUM-679). Allowed: CAPTURED↔DEVELOPING→PLANNED and any state→DROPPED (DROPPED is terminal). <id> is the LUM-I<n> id (a bare number also resolves).'
  )
  .option(
    '-s, --status <value>',
    'New status: captured | developing | planned | dropped (case-insensitive)'
  )
  .action(
    wrap((id, options) =>
      ideaUpdate(id as string | undefined, options as { status?: string })
    )
  )

// Idea evidence commands (LUM-681): mirrors `task slack/web/figma`, hitting
// `/api/ideas/:id/...` instead of `/api/tasks/:id/...`. Lets an agent attach
// Slack threads, web links, and Figma design links to an idea before it goes
// through the plan-run converter.
const ideaSlack = ideaCmd
  .command('slack')
  .description('Attach & inspect Slack context on an idea')
ideaSlack
  .command('add <idea> <permalink>')
  .description('Attach a Slack thread to an idea')
  .action(wrap((id, p) => ideaSlackAdd(id as string, p as string)))
ideaSlack
  .command('show <idea> <contextId>')
  .description('Show the full stored Slack thread snapshot')
  .action(wrap((id, ctx) => ideaSlackShow(id as string, ctx as string)))
ideaSlack
  .command('rm <idea> <contextId>')
  .description('Remove a Slack context from an idea')
  .action(wrap((id, ctx) => ideaSlackRm(id as string, ctx as string)))

const ideaWeb = ideaCmd
  .command('web')
  .description('Attach & inspect web links on an idea')
ideaWeb
  .command('add <idea> <url>')
  .description('Attach a web link to an idea')
  .action(wrap((id, u) => ideaWebAdd(id as string, u as string)))
ideaWeb
  .command('show <idea> <linkId>')
  .description('Show the fetched web link body as plain text')
  .action(wrap((id, l) => ideaWebShow(id as string, l as string)))
ideaWeb
  .command('rm <idea> <linkId>')
  .description('Remove a web link from an idea')
  .action(wrap((id, l) => ideaWebRm(id as string, l as string)))

const ideaFigma = ideaCmd
  .command('figma')
  .description('Attach Figma links to an idea')
ideaFigma
  .command('add <idea> <url>')
  .description('Attach a Figma file/frame URL to an idea')
  .action(
    wrap((id, u) =>
      ideaFigmaAdd({ identifier: id as string, url: u as string })
    )
  )
ideaFigma
  .command('list <idea>')
  .description('List Figma links on an idea')
  .action(wrap(id => ideaFigmaList({ identifier: id as string })))
ideaFigma
  .command('rm <idea> <link-id-or-url>')
  .description('Remove a Figma link from an idea (idempotent)')
  .action(
    wrap((id, l) =>
      ideaFigmaRm({ identifier: id as string, linkIdOrUrl: l as string })
    )
  )
ideaFigma
  .command('refresh <idea>')
  .description('Re-fetch Figma metadata for every link on an idea')
  .action(wrap(id => ideaFigmaRefresh({ identifier: id as string })))
ideaFigma
  .command('context <idea> <linkId>')
  .description('Show cached Figma design context')
  .action(wrap((id, l) => ideaFigmaContext(id as string, l as string)))

ideaCmd
  .command('comment <id> <body>')
  .description(
    'Comment on an idea (LUM-680). <id> is the LUM-I<n> id (a bare number also resolves). Body is plain text — quote it to pass spaces or newlines.'
  )
  .action(
    wrap((id, body) =>
      ideaComment(id as string | undefined, body as string | undefined)
    )
  )

// Plural `comments` parent (mirrors `task comments`): `idea comment <id> <body>`
// already exists for posting, and commander disallows a duplicate name.
const ideaComments = ideaCmd
  .command('comments')
  .description('Inspect an idea comment thread')
ideaComments
  .command('list <id>')
  .description(
    'List an idea comment thread (capped to the output budget; --full prints every comment).'
  )
  .option('--full', 'Print every comment, bypassing the output-token cap')
  .action(
    wrap((id, opts) =>
      ideaCommentList(id as string | undefined, opts as { full?: boolean })
    )
  )

const initiativeCmd = program
  .command('initiative')
  .description(
    'Team-level Initiatives (LUM-INIT-<n>): create, list, update, and post progress updates. Converter-materialised initiatives show here too.'
  )

initiativeCmd
  .command('create <goal>')
  .description(
    'Create a team-level initiative directly from a goal statement — no plan run required. Prints the LUM-INIT-<n> id; --assumption records the bet behind it.'
  )
  .option(
    '--assumption <text>',
    'The bet/assumption behind the initiative (赌注旁注)'
  )
  .action(
    wrap((goal, options) =>
      initiativeCreate(
        goal as string | undefined,
        options as { assumption?: string }
      )
    )
  )

initiativeCmd
  .command('list')
  .description(
    'List the team initiatives newest-first — each line shows the LUM-INIT-<n> id, status (PROPOSED | PLANNED | ACTIVE | COMPLETED | CANCELLED) and goal.'
  )
  .action(wrap(() => initiativeList()))

initiativeCmd
  .command('update <initiative>')
  .description(
    'Update an initiative (LUM-INIT-<n> or its number): status, goal, description, priority, start/target dates. Empty string clears description, priority and dates.'
  )
  .option(
    '-s, --status <value>',
    'Status: proposed | planned | active | completed | cancelled (case-insensitive)'
  )
  .option('--goal <text>', 'New goal statement (the initiative name)')
  .option('-d, --description <text>', 'Description; empty string clears it')
  .option(
    '-p, --priority <level>',
    'Priority: low | medium | high | urgent (case-insensitive); empty string clears it'
  )
  .option(
    '--start <date>',
    'Start date YYYY-MM-DD (your local day); empty string clears it'
  )
  .option(
    '--target <date>',
    'Target date YYYY-MM-DD (your local day); empty string clears it'
  )
  .action(
    wrap((ref, options) =>
      initiativeUpdate(ref as string, options as InitiativeUpdateOptions)
    )
  )

const initiativeProgress = initiativeCmd
  .command('progress')
  .description(
    'Progress updates on an initiative: append-only posts with an optional health (on_track | at_risk | off_track)'
  )

initiativeProgress
  .command('add <initiative> <body>')
  .description(
    'Post a progress update on an initiative (append-only; post a new one to correct).'
  )
  .option(
    '--health <value>',
    'Health: on_track | at_risk | off_track (case-insensitive)'
  )
  .action(
    wrap((ref, body, options) =>
      initiativeProgressAdd(
        ref as string,
        body as string,
        options as { health?: string }
      )
    )
  )

initiativeProgress
  .command('list <initiative>')
  .description(
    'List an initiative’s progress updates newest-first (date, health, author, body).'
  )
  .action(wrap(ref => initiativeProgressList(ref as string)))

const planCmd = program
  .command('plan')
  .description(
    'Start a design-thinking 转换器 run (聚类→对齐→成计划) and print the gate-A web deep-link. Refuses when a run is already active (see `lumo plan status`); --abandon-active abandons the prior run first. Editing/confirmation happen in web.'
  )
  .option(
    '--abandon-active',
    'Abandon the team’s existing active run before starting a fresh one'
  )
  .action(wrap(options => plan(options as PlanOptions)))

planCmd
  .command('status')
  .description(
    'Print the active plan run’s current stage and the deep-link to its next gate; with no active run, prompts to run `lumo plan`.'
  )
  .action(wrap(() => planStatus()))

program
  .command('cost')
  .description(
    'Show per-operation (per-tool) token cost. Defaults to a workspace 30-day window; scope with --task / --session'
  )
  .option('--task <id>', 'Aggregate a single task (e.g. LUM-42)')
  .option('--session <id>', 'Aggregate a single Claude Code session')
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
  .description(
    'Security scans of one PR in the workspace, by PR number (LUM-788): the latest head by default — layer states (same labels as task status / the GitHub summary), every finding incl. dispositioned ones with disposition + source, and the hunt coverage line. Read-only; disposition is web-only.'
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

const criteria = program
  .command('criteria')
  .description('Workspace-level acceptance-criteria analytics')

criteria
  .command('audit')
  .description(
    'Show the workspace referent-kind distribution + self-confirming-green ratio (GET /api/criteria/audit)'
  )
  .action(wrap(() => criteriaAudit()))

const session = program
  .command('session')
  .description('Manage per-terminal coding-session context')

session
  .command('attach <identifier>')
  .description(
    'Attach the currently-running Claude Code session (CLAUDE_CODE_SESSION_ID) to a task — or, with --steward, to a MILESTONE as a governance session (LUM-640: plan/accept only). Either binding is a lifetime lock: re-attaching the same target is a no-op, anything else is refused — start a new session instead.'
  )
  .option(
    '--steward',
    'Bind as a STEWARD (governance) session to a milestone (id, name, or slug) instead of a task. Steward sessions plan and accept only: lumo verify is refused (409, no round burned), self-dispatch to in_progress is refused, and implementation commits/PRs are recorded as boundary crossings.'
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
    'Show what this Claude Code session is bound to: a task, a milestone (STEWARD governance session), or nothing.'
  )
  .action(wrap(() => sessionStatus()))

const task = program
  .command('task')
  .description('Inspect tasks from the terminal')

task
  .command('context <identifier>')
  .description(
    'Print a task + prior session summaries as markdown, for pasting into a coding agent on startup.'
  )
  .action(wrap(identifier => taskContext(identifier as string)))

task
  .command('list')
  .description(
    'List tasks assigned to you. Filter with --status, --project, --milestone, --limit.'
  )
  .option(
    '-s, --status <value>',
    'Filter by status: todo | in_progress | in_review | done (case-insensitive)'
  )
  .option('-p, --project <ref>', 'Filter by project name (case-insensitive)')
  .option('-n, --limit <count>', 'Show only the first N tasks')
  .option(
    '-m, --milestone <ref>',
    'Filter by milestone name or UUID (scopes to my tasks under that milestone)'
  )
  .action(wrap(options => taskList(options as Record<string, string>)))

task
  .command('search [query]')
  .description(
    'Search tasks across the whole workspace (any assignee). [query] terms must all match title/description (or a task number like LUM-42); typo-tolerant and ranked by relevance unless --exact. Every filter is applied server-side.'
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
    'Status: todo | in_progress | in_review | done (case-insensitive; repeatable or comma-separated)',
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
  .option('-n, --limit <count>', 'Show only the first N tasks')
  .option(
    '--exact',
    'Substring matching only, in board order (default: typo-tolerant, ranked by relevance)'
  )
  .option('--json', 'Emit the raw result as JSON')
  .action(
    wrap((query, options) =>
      taskSearch(query as string | undefined, options as Record<string, never>)
    )
  )

task
  .command('delete <identifier>')
  .description(
    'Permanently delete a task (hard delete, no archive; subtasks are kept and detached). Without --confirm: exit 4 + a confirmation envelope listing what goes with it.'
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
    'Show the task field-change history (status, priority, title, assignee, due, parent, tags, sprint), oldest first.'
  )
  .option('-n, --limit <count>', 'Show the last N entries (default 30)')
  .option('--json', 'Emit the raw activity entries as JSON')
  .action(
    wrap((identifier, options) =>
      taskHistory(
        identifier as string,
        options as { limit?: string; json?: boolean }
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
  .command('status [task]')
  .description(
    'Acceptance self-check (LUM-344): contract with latest verdicts, current round, nextActions (unmet criteria + undispositioned security findings, LUM-737), and open boundary crossings. Read-only, no LLM. Defaults to the session-bound task. Run it first when resuming a task or after a verification round was rejected. --full adds the dashboard sections (verification rollup, history, cost, struggle/rework trail, trend).'
  )
  .option(
    '--json',
    'Emit the versioned machine-readable payload (version field; breaking changes bump it)'
  )
  .option(
    '--full',
    'Also print the dashboard sections: verification rollup, history, cost, struggle/rework trail, trend'
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
    '--parent <id>',
    'Parent task (LUM-N, same project) — creates this as a subtask'
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
    'List the task comment thread (capped to the output budget; --full prints every comment)'
  )
  .option('--full', 'Print every comment, bypassing the output-token cap')
  .action(
    wrap((id, opts) =>
      taskCommentList(id as string, opts as { full?: boolean })
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
const taskCriteria = task
  .command('criteria')
  .description(
    'Acceptance criteria — the task\u2019s verification contract (LUM-342)'
  )

taskCriteria
  .command('set <task>')
  .description(
    'Submit the whole acceptance contract from a JSON file. Default = initial agent draft (locked once submitted); --human records a HUMAN_EDIT revision (desired final list; items with "id" keep/update, missing ones are deleted).'
  )
  .requiredOption(
    '--file <path>',
    'JSON array of criteria: [{"statement","verifierType":"MACHINE"|"HUMAN","checkpointer?","evidenceRequired?","id?"}]'
  )
  .option(
    '--human',
    'Record a human contract revision (HUMAN_EDIT) transcribed from the conversation, with session provenance'
  )
  .option(
    '--cause <tag>',
    'Why the contract drifted (with --human): NEW_INFO | SCOPE_CHANGE | DRAFT_BLIND_SPOT | GRANULARITY | OTHER (case-insensitive)'
  )
  .action(
    wrap((taskId: unknown, options: unknown) =>
      taskCriteriaSet(taskId as string, options as Record<string, unknown>)
    )
  )

taskCriteria
  .command('list <task>')
  .description(
    'List a task\u2019s acceptance criteria (id, type, provenance, checkpointer)'
  )
  .action(wrap((taskId: unknown) => taskCriteriaList(taskId as string)))

taskCriteria
  .command('confirm <task>')
  .description(
    'Record the USER\u2019s confirmation of the acceptance contract (LUM-789). Gated: without --confirm it prints a confirmation envelope listing every criterion and exits 4, writing nothing. Confirming never blocks DONE \u2014 an unconfirmed contract still closes normally.'
  )
  .option('--confirm', 'The user has approved this contract')
  .option('--yes', 'Legacy alias of --confirm')
  .action(
    wrap((taskId: unknown, options: unknown) =>
      taskCriteriaConfirm(
        taskId as string,
        options as { confirm?: boolean; yes?: boolean }
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
  .option(
    '--criterion <selector>',
    'Which acceptance criterion this case covers: an id or a >=6-char id prefix from `lumo task criteria list`. Optional - an unlinked case is perfectly legal. A covered criterion stops showing up as a coverage gap; the case NEVER adjudicates it'
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
  .option(
    '--criterion <selector>',
    'Which acceptance criterion this case covers: an id or a >=6-char id prefix from `lumo task criteria list`. Pass "" to unlink (the case itself is untouched). Omit to leave the link as it is'
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
    'List milestones for a project. --project required when workspace has >1 project. By default only non-archived milestones are shown.'
  )
  .option('--project <ref>', 'Project name or slug')
  .option('--archived', 'Show only archived milestones')
  .option('--all', 'Show both archived and non-archived milestones')
  .option(
    '--search <text>',
    'Filter by name/description substring (case-insensitive)'
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

const milestoneCriteria = milestoneCmd
  .command('criteria')
  .description(
    'Milestone-level exit criteria — the close contract (LUM-643). Drafted and adjudicated by the milestone steward (LUM-640) or a human; unresolved criteria refuse status→COMPLETED (human override via web only).'
  )

milestoneCriteria
  .command('set <identifier>')
  .description(
    'Submit the whole exit contract from a JSON file (full replace; adjudicated rows are tombstoned, their verdict trail survives). Default = steward/agent draft; --human records a transcribed HUMAN_EDIT revision. Locked with 409 once the milestone is COMPLETED.'
  )
  .requiredOption(
    '--file <path>',
    'JSON array of criteria: [{"statement","referentKind":"EXTERNAL_FACT"|"AGENT_CONSTRUCTED_STATE"|"PENDING_OUTCOME"}] — no verifierType/checkpointer (exit criteria are adjudicated, not machine-run)'
  )
  .option(
    '--human',
    'Record a human contract revision (HUMAN_EDIT) transcribed from the conversation'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneCriteriaSet(
        identifier as string,
        options as { project?: string; file?: string; human?: boolean }
      )
    )
  )

milestoneCriteria
  .command('list <identifier>')
  .description(
    'List a milestone’s exit criteria: id, verdict (MET | NOT_MET | PENDING), provenance, referent kind, statement — plus whether the close gate is open.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, options) =>
      milestoneCriteriaList(
        identifier as string,
        options as { project?: string }
      )
    )
  )

milestoneCriteria
  .command('verdict <identifier> <criterion>')
  .description(
    'Adjudicate (裁定) one exit criterion: --met or --unmet, with optional --note. Grounding gate: --met on an EXTERNAL_FACT criterion requires --evidence (422 otherwise), and a PENDING_OUTCOME criterion can never be MET. <criterion> = id or ≥6-char id prefix from `criteria list`.'
  )
  .option('--met', 'Adjudicate the criterion MET')
  .option('--unmet', 'Adjudicate the criterion NOT_MET')
  .option('--note <text>', 'Adjudication note (why this verdict)')
  .option(
    '--evidence <pointer>',
    'Evidence pointer backing a MET on EXTERNAL_FACT (URL, commit SHA, CI run, DB probe …)'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .action(
    wrap((identifier, criterion, options) =>
      milestoneCriteriaVerdict(
        identifier as string,
        criterion as string,
        options as {
          project?: string
          met?: boolean
          unmet?: boolean
          note?: string
          evidence?: string
        }
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
  .description('List documents visible to the current user')
  .option(
    '--scope <scope>',
    'personal | workspace | all (case-insensitive; default: all)'
  )
  .option('--project <ref>', 'Filter by project name/slug')
  .option('--task <LUM-N>', 'Only docs bound to this task')
  .option('--limit <n>', 'Cap output to first N rows')
  .option('--tree', 'Render as an indented tree')
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
    'Delete a document and everything nested under it. Without --confirm: exit 4 + a confirmation envelope with the title.'
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
    'New status: todo | in_progress | in_review | done (case-insensitive)'
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
    '--parent <id>',
    'Parent task (LUM-N, same project); empty string to detach from its parent'
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
    'With --status done: the user has approved the DONE transition shown in the confirmation envelope (LUM-755). Without it, --status done exits 4 and prints the envelope (status change, every linked PR, a ⚠ line for unmerged ones) instead of a prompt.'
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
    'Run verifyCommand from .lumo/worktree.json in the new worktree to confirm a clean baseline'
  )
  .action(
    wrap((identifier, slug, options) => {
      const o = options as { base?: string; fetch?: boolean; verify?: boolean }
      return worktreeAdd(identifier as string, slug as string | undefined, {
        base: o.base,
        noFetch: o.fetch === false,
        verify: o.verify,
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
    'Claude Code hook ingestion (invoked by settings.json, not humans)'
  )

// Slug → help-text for every `lumo hook <slug>` subcommand. Each one accepts
// an optional `--agent <token>` flag (baked into settings.json by `lumo setup
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
]

for (const [slug, description] of HOOK_SUBCOMMANDS) {
  hook
    .command(slug)
    .description(description)
    .option(
      '--agent <token>',
      'Coding agent that owns this session (e.g. claude-code, codex). Baked in by `lumo setup --agent`.'
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
