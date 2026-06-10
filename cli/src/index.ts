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
import { sessionDetach } from './commands/session-detach'
import { sessionStatus } from './commands/session-status'
import { sessionWrap } from './commands/session-wrap'
import { nextCommand } from './commands/next'
import { verify } from './commands/verify'
import { taskContext } from './commands/task-context'
import { taskCreate } from './commands/task-create'
import { taskUpdate } from './commands/task-update'
import { taskList } from './commands/task-list'
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
import { taskArtifactAdd } from './commands/task-artifact-add'
import { taskCriteriaSet } from './commands/task-criteria-set'
import { taskCriteriaList } from './commands/task-criteria-list'
import { taskArtifactList } from './commands/task-artifact-list'
import { taskArtifactShow } from './commands/task-artifact-show'
import { taskArtifactRm } from './commands/task-artifact-rm'
import { taskArtifactUpdate } from './commands/task-artifact-update'
import { taskSlackShow } from './commands/task-slack-show'
import { taskWebShow } from './commands/task-web-show'
import { taskFigmaContext } from './commands/task-figma-context'
import { taskCommentList } from './commands/task-comment-list'
import {
  taskDepsList,
  taskDepsAdd,
  taskDepsConfirm,
  taskDepsDismiss,
  taskDepsRm,
} from './commands/task-deps'
import { taskPrShow } from './commands/task-pr-show'
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
import { milestoneSummary } from './commands/milestone-summary'
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
import { docUpdate } from './commands/doc-update'
import { docShow } from './commands/doc-show'
import { docDiff } from './commands/doc-diff'
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
import {
  maybeRefreshInBackground,
  printUpdateNoticeIfAny,
  runBackgroundRefresh,
} from './lib/update-check'
import { sanitizeField } from './lib/sanitize'

// Resolve package.json relative to __dirname so this works regardless of how
// deep the compiled output ends up (flat dist/ or nested dist/cli/src/).
const pkg = require(path.resolve(__dirname, '../../..', 'package.json')) as {
  name: string
  version: string
}

// Detached background-refresh worker: re-entry point for the spawn() in
// maybeRefreshInBackground(). Fetches latest, writes cache, exits — skipping
// commander.parseAsync() below.
const isUpdateCheckWorker =
  process.argv[2] === '__update-check' && !!process.argv[3]

if (isUpdateCheckWorker) {
  runBackgroundRefresh(process.argv[3] as string)
    .catch(() => {})
    .finally(() => process.exit(0))
} else {
  printUpdateNoticeIfAny(pkg.name, pkg.version)
  maybeRefreshInBackground(pkg.name)
}

// One-shot cleanup of pre-LUM-46 local state. The session→task binding
// is now server-authoritative; the legacy global pointer and the
// per-session sentinel directory are both obsolete. Failures are
// swallowed so a permission glitch doesn't prevent CLI invocation.
;(() => {
  const dir = process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
  try {
    fs.rmSync(path.join(dir, 'current-task.json'), { force: true })
  } catch {}
  try {
    fs.rmSync(path.join(dir, 'sessions'), { recursive: true, force: true })
  } catch {}
})()

const collect = (val: string, acc: string[]): string[] => [...acc, val]

type CommandFn = (...args: unknown[]) => Promise<number | void>

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
  .action(
    wrap((task: unknown, options: unknown) =>
      verify(task as string | undefined, options as { timeout?: string })
    )
  )

program
  .command('next')
  .description(
    'Recommend the next task(s) to work on, ranked by priority, active sprint, and due date. Prints top N (default 3); pick one and run `session attach` + `task context`.'
  )
  .option('-n, --count <N>', 'Number of tasks to recommend (default 3)')
  .action(wrap(options => nextCommand(options as { count?: string })))

const session = program
  .command('session')
  .description('Manage per-terminal coding-session context')

session
  .command('attach <identifier>')
  .description(
    'Attach the currently-running Claude Code session (CLAUDE_CODE_SESSION_ID) to a task. Sets Session.taskId server-side and re-tags untagged hook events. If the session is already bound to a different task, confirms before overwriting (use --force to skip).'
  )
  .option(
    '--force',
    'Overwrite an existing binding to a different task without confirmation (skips the [y/N] prompt).'
  )
  .action(
    wrap((identifier, options) =>
      sessionAttach(identifier as string, options as { force?: boolean })
    )
  )

session
  .command('status')
  .description(
    'Show the task currently bound to this Claude Code session (or "no task" if none).'
  )
  .action(wrap(() => sessionStatus()))

session
  .command('detach')
  .description(
    'Clear the task binding on the current Claude Code session. Past hook events keep their taskId; only future events become untagged.'
  )
  .action(wrap(() => sessionDetach()))

session
  .command('wrap')
  .description(
    "Session-end wrap-up: draft a progress comment from this session's turn summaries and post it to the bound task after confirmation."
  )
  .option(
    '-y, --yes',
    'Post the drafted comment without prompting (agent-friendly)'
  )
  .option(
    '--dry-run',
    'Print the draft but do not post or advance the watermark'
  )
  .option(
    '--used <indices>',
    'Mark which injected context fragments you actually used (1-based indices, comma/space separated; "none" for all-unused). Omit to skip recording.'
  )
  .action(
    wrap(options =>
      sessionWrap(options as { yes?: boolean; dryRun?: boolean; used?: string })
    )
  )

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
    'Filter by status: todo | in_progress | in_review | done'
  )
  .option('-p, --project <ref>', 'Filter by project name (case-insensitive)')
  .option('-n, --limit <count>', 'Show only the first N tasks')
  .option(
    '-m, --milestone <ref>',
    'Filter by milestone name or UUID (scopes to my tasks under that milestone)'
  )
  .action(wrap(options => taskList(options as Record<string, string>)))

task
  .command('show <identifier>')
  .description(
    'Show a single task: title, status, priority, assignee, project, URL, description.'
  )
  .action(wrap(identifier => taskShow(identifier as string)))

task
  .command('status [task]')
  .description(
    'Acceptance self-check (LUM-344): contract with latest verdicts, verification history, current round, and nextActions (unmet criteria). Read-only, no LLM. Defaults to the session-bound task. Run it first when resuming a task or after a verification round was rejected.'
  )
  .option(
    '--json',
    'Emit the versioned machine-readable payload (version field; breaking changes bump it)'
  )
  .action(
    wrap((taskArg, options) =>
      taskStatus(taskArg as string | undefined, options as { json?: boolean })
    )
  )

task
  .command('comment <identifier> <body>')
  .description(
    'Add a comment to a task. Body is plain text — quote it to pass spaces or newlines.'
  )
  .action(
    wrap((identifier, body) =>
      taskComment(identifier as string, body as string)
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
    'Priority: low | medium | high | urgent (default: low)'
  )
  .option('-a, --assignee <ref>', 'Assignee email, name, or "me" (default: me)')
  .option('--project <ref>', 'Project name or slug')
  .option('--milestone <ref>', 'Milestone name (case-insensitive)')
  .option('--tag <name>', 'Attach tag by name (repeatable)', collect, [])
  .option('--tag-id <cuid>', 'Attach tag by id (repeatable)', collect, [])
  .option(
    '--sprint <ref>',
    'Sprint number or UUID to add the task to after creation'
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
  .description('Inspect the full task comment thread')
taskComments
  .command('list <identifier>')
  .description('List the full task comment thread')
  .action(wrap(id => taskCommentList(id as string)))

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
  .option('--yes', 'skip confirmation')
  .description('Delete a dependency edge')
  .action(
    wrap((id, edge, opts) =>
      taskDepsRm(id as string, edge as string, opts as { yes?: boolean })
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
  .option('--category <cat>', 'Filter by trap|decision|convention|procedural')
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
    'trap | decision | convention | procedural'
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
    'Producing agent: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)'
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
    'Why the contract drifted (with --human): NEW_INFO | SCOPE_CHANGE | DRAFT_BLIND_SPOT | GRANULARITY | OTHER'
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
    'Coding tool that produced the artifact: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf'
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
    'New coding tool: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf'
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
  .description('Delete an artifact from a task. Irreversible — requires --yes.')
  .option('--yes', 'Confirm deletion (required, no interactive prompt)')
  .action(
    wrap((taskId: unknown, artifactId: unknown, options: unknown) =>
      taskArtifactRm(
        taskId as string,
        artifactId as string,
        options as { yes?: boolean }
      )
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

const projectMemory = projectCmd
  .command('memory')
  .description('View and record PROJECT-scope memories')

projectMemory
  .command('list [project]')
  .description(
    "List a project's PROJECT-scope memories. <project> defaults to the bound task's project."
  )
  .option('--category <cat>', 'Filter by trap|decision|convention|procedural')
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
    'trap | decision | convention | procedural'
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
    'Producing agent: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)'
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
  .command('promote <memoryId>')
  .description(
    'Promote a TASK memory to PROJECT scope. Only when the lesson recurs across 2+ tasks.'
  )
  .action(wrap((id: unknown) => memoryPromote(id as string)))

memoryCmd
  .command('rm <memoryId>')
  .description('Delete a memory (hard delete). Requires --yes.')
  .option('--yes', 'Confirm deletion')
  .action(
    wrap((id: unknown, opts: unknown) =>
      memoryRm(id as string, opts as { yes?: boolean })
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
    'Update a milestone. Provide at least one of --name, --description, --status, --start, --target. Use "" to clear nullable fields.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .option('-n, --name <text>', 'New name')
  .option('-d, --description <text>', 'New description (empty string to clear)')
  .option(
    '-s, --status <value>',
    'New status: planned | active | completed | cancelled'
  )
  .option('--start <date>', 'Start date YYYY-MM-DD (empty string to clear)')
  .option('--target <date>', 'Target date YYYY-MM-DD (empty string to clear)')
  .action(
    wrap((identifier, options) =>
      milestoneUpdate(identifier as string, options as Record<string, string>)
    )
  )

milestoneCmd
  .command('delete <identifier>')
  .description(
    'Delete a milestone. Tasks under it keep their data (milestoneId is cleared). Requires --yes.'
  )
  .option('--project <ref>', 'Project name or slug (when identifier is a name)')
  .option('--yes', 'Required: confirm deletion without TTY prompt')
  .action(
    wrap((identifier, options) =>
      milestoneDelete(
        identifier as string,
        options as { project?: string; yes?: boolean }
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
    'Delete a DRAFT sprint. Requires --yes. Server rejects ACTIVE/CLOSED sprints.'
  )
  .option('--team <ref>', 'Team name or UUID (informational)')
  .option('--yes', 'Confirm deletion')
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
    'Close an ACTIVE sprint. With no unfinished tasks, closes immediately. Pass --move-all --yes to move unfinished tasks to the next sprint, or --backlog-all --yes to return them to the backlog.'
  )
  .option('--team <ref>', 'Team name or UUID (informational)')
  .option('--move-all', 'Move all unfinished tasks to the next sprint')
  .option('--backlog-all', 'Return all unfinished tasks to the backlog')
  .option('--yes', 'Required when --move-all or --backlog-all is set')
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
  .option('--scope <scope>', 'personal | workspace (default: personal)')
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
  .option('--scope <scope>', 'personal | workspace (default: personal)')
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
    'Update an existing document. <doc> accepts a cuid or a case-insensitive title (ambiguous titles fail with candidates). Replacement body comes from --content, --file, or piped stdin (pick one). --tag/--tag-id (bulk replace) cannot be combined with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id.'
  )
  .option('--title <text>', 'New title')
  .option('--content <text>', 'Replace content (inline)')
  .option('--file <path>', 'Replace content from file')
  .option('--scope <scope>', 'personal | workspace')
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
  .action(
    wrap((reference, opts) =>
      docUpdate(reference as string | undefined, opts as Record<string, string>)
    )
  )

doc
  .command('show <doc>')
  .description(
    'Show document header and body (doc = title or cuid). --raw prints the byte-identical markdown source of the last markdown upload (a legal edit base); it errors when no markdown source is stored instead of falling back to the lossy HTML→markdown render.'
  )
  .option(
    '--raw',
    'Print the stored markdown source verbatim (no header); errors if absent'
  )
  .action(
    wrap((reference, opts) =>
      docShow(reference as string | undefined, opts as { raw?: boolean })
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
  .command('list')
  .description('List documents visible to the current user')
  .option('--scope <scope>', 'personal | workspace | all (default: all)')
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
  .description('Delete a document (requires --yes)')
  .option('--yes', 'Confirm deletion')
  .action(
    wrap((reference, opts) =>
      docDelete(reference as string | undefined, opts as Record<string, string>)
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
  .option('--role <role>', 'viewer | editor | manager (default: viewer)')
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
    'New status: todo | in_progress | in_review | done'
  )
  .option(
    '-p, --priority <level>',
    'New priority: low | medium | high | urgent'
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
  .action(
    wrap((identifier, options) =>
      taskUpdate(identifier as string, options as Record<string, string>)
    )
  )

const worktree = program
  .command('worktree')
  .description(
    'Scaffold, remove, and list parallel git worktrees under .worktrees/ (node_modules symlink + prisma/jest gotcha guidance). Local dev tooling; run from the main checkout.'
  )

worktree
  .command('add <identifier> [slug]')
  .description(
    'Create a worktree at .worktrees/<LUM-N>[-slug] on branch lumo/<LUM-N>[-slug] off origin/main, symlink node_modules to the main checkout, and print prisma/jest guidance. Run from the main checkout.'
  )
  .option(
    '--base <ref>',
    'Branch off this ref instead of origin/main (skips fetch)'
  )
  .option('--no-fetch', 'Do not `git fetch origin main` before branching')
  .option(
    '--verify',
    'Run `npx jest` in the new worktree to confirm a clean baseline'
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
    'Remove the worktree for a task (git worktree remove). Requires --yes. Refuses a dirty worktree unless --force. Keeps the branch unless --delete-branch.'
  )
  .option('--yes', 'Confirm removal (required, no interactive prompt)')
  .option('--force', 'Remove even with uncommitted changes')
  .option(
    '--delete-branch',
    'Also delete the branch (git branch -d; refuses if unmerged)'
  )
  .action(
    wrap((identifier, options) =>
      worktreeRm(
        identifier as string,
        options as { yes?: boolean; force?: boolean; deleteBranch?: boolean }
      )
    )
  )

worktree
  .command('list')
  .description(
    'List worktrees under .worktrees/: task id, branch, dirty state, and whether node_modules is symlinked.'
  )
  .action(wrap(() => worktreeList()))

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

if (!isUpdateCheckWorker) {
  program.parseAsync(process.argv).catch(err => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${sanitizeField(msg)}`)
    process.exit(1)
  })
}
