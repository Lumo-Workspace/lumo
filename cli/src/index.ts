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

const pkg = require('../package.json') as { version: string }

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
    'List tasks assigned to you. Filter with --status, --project, --limit.'
  )
  .option(
    '-s, --status <value>',
    'Filter by status: todo | in_progress | in_review | done'
  )
  .option('-p, --project <ref>', 'Filter by project name (case-insensitive)')
  .option('-n, --limit <count>', 'Show only the first N tasks')
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

task
  .command('update <identifier>')
  .description(
    'Update a task. Provide at least one of --title, --description, --status, --priority, --assignee. Use "" to clear description or assignee.'
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
