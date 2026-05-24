#!/usr/bin/env node
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Command } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'
import { hookCommand } from './commands/hook'
import { sessionAttach } from './commands/session-attach'
import { sessionDetach } from './commands/session-detach'
import { sessionStatus } from './commands/session-status'
import { taskContext } from './commands/task-context'
import { taskCreate } from './commands/task-create'
import { taskUpdate } from './commands/task-update'
import { taskList } from './commands/task-list'
import { taskShow } from './commands/task-show'
import { taskComment } from './commands/task-comment'
import { projectList } from './commands/project-list'
import { milestoneList } from './commands/milestone-list'
import { milestoneCreate } from './commands/milestone-create'
import { milestoneShow } from './commands/milestone-show'
import { milestoneUpdate } from './commands/milestone-update'
import { milestoneDelete } from './commands/milestone-delete'
import { sprintCreate } from './commands/sprint-create'
import { docCreate } from './commands/doc-create'
import { docUpdate } from './commands/doc-update'
import { docShow } from './commands/doc-show'
import { docList } from './commands/doc-list'
import { docDelete } from './commands/doc-delete'
import { docBind } from './commands/doc-bind'
import { docUnbind } from './commands/doc-unbind'
import { docShare } from './commands/doc-share'
import { docUnshare } from './commands/doc-unshare'
import { docShareList } from './commands/doc-share-list'
import { docMove } from './commands/doc-move'

// Resolve package.json relative to __dirname so this works regardless of how
// deep the compiled output ends up (flat dist/ or nested dist/cli/src/).
const pkg = require(path.resolve(__dirname, '../../..', 'package.json')) as {
  version: string
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
      console.error(`Error: ${msg}`)
      process.exit(1)
    }
  }
}

const program = new Command()
  .name('lumo')
  .description('Lumo CLI — manage tasks and sessions from the terminal')
  .version(pkg.version)

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

const session = program
  .command('session')
  .description('Manage per-terminal coding-session context')

session
  .command('attach <identifier>')
  .description(
    'Attach the currently-running Claude Code session (CLAUDE_CODE_SESSION_ID) to a task. Sets Session.taskId server-side and re-tags untagged hook events.'
  )
  .action(wrap(identifier => sessionAttach(identifier as string)))

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
  .action(
    wrap((title, options) =>
      taskCreate(title as string, options as Record<string, string>)
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

const milestoneCmd = program
  .command('milestone')
  .description('Inspect milestones from the terminal')

milestoneCmd
  .command('list')
  .description(
    'List milestones for a project. --project required when workspace has >1 project.'
  )
  .option('--project <ref>', 'Project name or slug')
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

const sprintCmd = program
  .command('sprint')
  .description('Inspect sprints from the terminal')

sprintCmd
  .command('create')
  .description(
    'Create a draft sprint. --team required when workspace has >1 team. --start and --end (YYYY-MM-DD) required.'
  )
  .option('--team <ref>', 'Team name or UUID')
  .option('-n, --name <text>', 'Sprint name (server fills default when omitted)')
  .option('--start <date>', 'Start date (YYYY-MM-DD)')
  .option('--end <date>', 'End date (YYYY-MM-DD)')
  .action(wrap(options => sprintCreate(options as Record<string, string>)))

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
  .description('Show document header and body (doc = title or cuid)')
  .action(wrap(reference => docShow(reference as string | undefined)))

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
    'Update a task. Provide at least one of --title, --description, --status, --priority, --assignee, --milestone, or tag flags. Use "" to clear description, assignee, or milestone. --tag/--tag-id (bulk replace) cannot be combined with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id.'
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

hook
  .command('pre-tool-use')
  .description(
    'Forward a PreToolUse hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('pre-tool-use')))

hook
  .command('post-tool-use')
  .description(
    'Forward a PostToolUse hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('post-tool-use')))

hook
  .command('post-tool-use-failure')
  .description(
    'Forward a PostToolUseFailure hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('post-tool-use-failure')))

hook
  .command('user-prompt-submit')
  .description(
    'Forward a UserPromptSubmit hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('user-prompt-submit')))

hook
  .command('stop')
  .description('Forward a Stop hook event to Lumo (reads JSON from stdin)')
  .action(wrap(() => hookCommand('stop')))

hook
  .command('stop-failure')
  .description(
    'Forward a StopFailure hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('stop-failure')))

hook
  .command('permission-request')
  .description(
    'Forward a PermissionRequest hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('permission-request')))

hook
  .command('permission-denied')
  .description(
    'Forward a PermissionDenied hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('permission-denied')))

hook
  .command('session-start')
  .description(
    'Forward a SessionStart hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('session-start')))

hook
  .command('session-end')
  .description(
    'Forward a SessionEnd hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('session-end')))

hook
  .command('subagent-start')
  .description(
    'Forward a SubagentStart hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('subagent-start')))

hook
  .command('subagent-stop')
  .description(
    'Forward a SubagentStop hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('subagent-stop')))

hook
  .command('worktree-create')
  .description(
    'Forward a WorktreeCreate hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('worktree-create')))

hook
  .command('worktree-remove')
  .description(
    'Forward a WorktreeRemove hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('worktree-remove')))

hook
  .command('file-changed')
  .description(
    'Forward a FileChanged hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('file-changed')))

hook
  .command('config-change')
  .description(
    'Forward a ConfigChange hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('config-change')))

hook
  .command('task-created')
  .description(
    'Forward a TaskCreated hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('task-created')))

hook
  .command('task-completed')
  .description(
    'Forward a TaskCompleted hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('task-completed')))

hook
  .command('post-tool-batch')
  .description(
    'Forward a PostToolBatch hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('post-tool-batch')))

hook
  .command('user-prompt-expansion')
  .description(
    'Forward a UserPromptExpansion hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('user-prompt-expansion')))

hook
  .command('notification')
  .description(
    'Forward a Notification hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('notification')))

hook
  .command('elicitation')
  .description(
    'Forward an Elicitation hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('elicitation')))

hook
  .command('elicitation-result')
  .description(
    'Forward an ElicitationResult hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('elicitation-result')))

hook
  .command('cwd-changed')
  .description(
    'Forward a CwdChanged hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('cwd-changed')))

hook
  .command('instructions-loaded')
  .description(
    'Forward an InstructionsLoaded hook event to Lumo (reads JSON from stdin)'
  )
  .action(wrap(() => hookCommand('instructions-loaded')))

program.parseAsync(process.argv).catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${msg}`)
  process.exit(1)
})
