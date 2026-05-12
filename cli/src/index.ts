#!/usr/bin/env node
import { Command } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'
import { hookCommand } from './commands/hook'
import { sessionStart } from './commands/session-start'
import { sessionAttach } from './commands/session-attach'
import { taskContext } from './commands/task-context'

const pkg = require('../package.json') as { version: string }

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
  .command('start <identifier>')
  .description(
    'Tag the next `claude code` session with a task (e.g. LUM-42). Writes ~/.lumo/current-task.json.'
  )
  .action(wrap(identifier => sessionStart(identifier as string)))

session
  .command('attach <identifier>')
  .description(
    'Attach the currently-running coding session to a task. Re-tags the running Session row + its untagged hook events, AND writes ~/.lumo/current-task.json so the next session inherits too.'
  )
  .action(wrap(identifier => sessionAttach(identifier as string)))

const task = program
  .command('task')
  .description('Inspect tasks from the terminal')

task
  .command('context <identifier>')
  .description(
    'Print a task + prior session summaries as markdown, for pasting into a coding agent on startup.'
  )
  .action(wrap(identifier => taskContext(identifier as string)))

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
