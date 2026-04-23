#!/usr/bin/env node
import { Command } from 'commander'
import { authLogin } from './commands/auth-login'
import { authLogout } from './commands/auth-logout'
import { whoami } from './commands/whoami'

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

program.parseAsync(process.argv).catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`Error: ${msg}`)
  process.exit(1)
})
