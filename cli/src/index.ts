#!/usr/bin/env node
import { Command } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'
import { hookCommand } from './commands/hook'

const pkg = require('../package.json') as { version: string }

type CommandFn = () => Promise<number | void>

function wrap(fn: CommandFn) {
  return async () => {
    try {
      const code = await fn()
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

const hook = program
  .command('hook')
  .description(
    'Claude Code hook ingestion (invoked by settings.json, not humans)'
  )

hook
  .command('pre-tool-use')
  .description('Forward a PreToolUse hook event to Lumo')
  .action(wrap(() => hookCommand('pre-tool-use')))

hook
  .command('post-tool-use')
  .description('Forward a PostToolUse hook event to Lumo')
  .action(wrap(() => hookCommand('post-tool-use')))

hook
  .command('stop')
  .description('Forward a Stop hook event to Lumo')
  .action(wrap(() => hookCommand('stop')))

program.parseAsync(process.argv).catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${msg}`)
  process.exit(1)
})
