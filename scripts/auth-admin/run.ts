/**
 * LUM-1071 — the shared entry of scripts/auth-admin/{ban,unban,remove}.ts:
 * parse → resolve the user → print the dry-run plan, or (with --confirm) call
 * the service and print the result. Exit code 0 on success, 1 on any error
 * (the message is printed; never a stack with data).
 */
import { prisma } from '@/lib/db/prisma'
import { authUserAdminService } from '@/lib/services/auth-user-admin.service'
import {
  banExpiresAt,
  describeDatabase,
  formatBanResult,
  formatPlan,
  formatRemoveResult,
  formatUnbanResult,
  parseAuthAdminArgs,
  writeLines,
  type AuthAdminCommand,
} from './cli'

/** Run `command` with `argv`; resolves to the process exit code. */
export async function runAuthAdmin(
  command: AuthAdminCommand,
  argv: string[],
  now: Date = new Date()
): Promise<number> {
  try {
    const args = parseAuthAdminArgs(command, argv)
    writeLines([`database: ${describeDatabase(process.env.DATABASE_URL)}`])
    const userId = await authUserAdminService.resolveUserId(args.target)
    if (!args.confirm) {
      const plan = await authUserAdminService.plan(userId)
      writeLines([
        ...formatPlan(command, plan, args),
        'Nothing was written. Re-run with --confirm to apply.',
      ])
      return 0
    }
    if (command === 'ban') {
      const result = await authUserAdminService.ban(userId, {
        reason: args.reason,
        expiresAt: banExpiresAt(args.expiresInDays, now),
      })
      writeLines(formatBanResult(result))
    } else if (command === 'unban') {
      writeLines(formatUnbanResult(await authUserAdminService.unban(userId)))
    } else {
      writeLines(formatRemoveResult(await authUserAdminService.remove(userId)))
    }
    return 0
  } catch (err) {
    process.stderr.write(`error: ${(err as Error).message}\n`)
    return 1
  }
}

/** Script main: run, disconnect, exit with the code. */
export async function main(command: AuthAdminCommand): Promise<void> {
  const code = await runAuthAdmin(command, process.argv.slice(2))
  await prisma.$disconnect()
  process.exit(code)
}
