/**
 * LUM-1071 — shared argument parsing and output for scripts/auth-admin/*.ts.
 * The scripts only parse arguments and call lib/services/auth-user-admin;
 * every rule (ban, deprovision, last-OWNER protection) lives in the service.
 *
 * Output names users, workspaces and members by id only, never by email or
 * name. A dry run (the default) reads and prints the plan; --confirm writes.
 */
import { parseArgs } from 'node:util'
import type {
  AuthAdminPlan,
  AuthAdminTarget,
  BanResult,
  PlatformAdminRoleResult,
  RemoveResult,
  UnbanResult,
} from '@/lib/services/auth-user-admin.service'
import type { DeprovisionOutcome } from '@/lib/services/member-deprovision.service'

export type AuthAdminCommand =
  | 'ban'
  | 'unban'
  | 'remove'
  | 'grant-admin'
  | 'revoke-admin'

/** LUM-1344 — commands that only change the platform admin role. */
export function isRoleCommand(
  command: AuthAdminCommand
): command is 'grant-admin' | 'revoke-admin' {
  return command === 'grant-admin' || command === 'revoke-admin'
}

export interface AuthAdminArgs {
  target: AuthAdminTarget
  confirm: boolean
  reason: string | null
  expiresInDays: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000
export const REASON_MAX_CHARS = 500

export function usage(command: AuthAdminCommand): string {
  const extra =
    command === 'ban' ? ' [--reason <text>] [--expires-in-days <n>]' : ''
  return (
    `Usage: npx tsx scripts/auth-admin/${command}.ts ` +
    `(--user-id <id> | --email <email>)${extra} [--confirm]\n` +
    'Without --confirm this is a dry run: it prints what would change and writes nothing.'
  )
}

function usageError(command: AuthAdminCommand, message: string): Error {
  return Object.assign(new Error(`${message}\n${usage(command)}`), {
    status: 400,
  })
}

/** Parse argv (without node and the script path). Throws on bad input. */
export function parseAuthAdminArgs(
  command: AuthAdminCommand,
  argv: string[]
): AuthAdminArgs {
  let values: Record<string, string | boolean | undefined>
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        'user-id': { type: 'string' },
        email: { type: 'string' },
        confirm: { type: 'boolean', default: false },
        ...(command === 'ban'
          ? {
              reason: { type: 'string' as const },
              'expires-in-days': { type: 'string' as const },
            }
          : {}),
      },
    }).values
  } catch (err) {
    throw usageError(command, (err as Error).message)
  }
  const userId = values['user-id'] as string | undefined
  const email = values.email as string | undefined
  if (!userId === !email) {
    throw usageError(command, 'Pass exactly one of --user-id or --email.')
  }
  const reason = (values.reason as string | undefined)?.trim() || null
  if (reason && reason.length > REASON_MAX_CHARS) {
    throw usageError(
      command,
      `--reason is longer than ${REASON_MAX_CHARS} characters.`
    )
  }
  const rawDays = values['expires-in-days'] as string | undefined
  let expiresInDays: number | null = null
  if (rawDays !== undefined) {
    // Plain decimal digits only (Number() would accept '0x10', '1e1', ' 7 ').
    expiresInDays = /^[0-9]+$/.test(rawDays) ? Number(rawDays) : NaN
    if (!Number.isSafeInteger(expiresInDays) || expiresInDays <= 0) {
      throw usageError(command, '--expires-in-days must be a positive integer.')
    }
  }
  return {
    target: { userId, email },
    confirm: values.confirm === true,
    reason,
    expiresInDays,
  }
}

/** The ban's end, `days` after `now`; null = permanent. */
export function banExpiresAt(days: number | null, now: Date): Date | null {
  return days === null ? null : new Date(now.getTime() + days * DAY_MS)
}

/** `host/database` of a postgres URL (no credentials), for the banner. */
export function describeDatabase(url: string | undefined): string {
  if (!url) return '(DATABASE_URL not set)'
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

const PLAN_ACTION_TEXT = {
  deactivate: 'deactivate membership, revoke API keys, audit',
  keep_last_owner:
    'LAST OWNER: keep membership, revoke API keys (remove refuses)',
  none: 'already deactivated, nothing to do',
} as const

/** The dry-run report for `command`. */
export function formatPlan(
  command: AuthAdminCommand,
  plan: AuthAdminPlan,
  args: Pick<AuthAdminArgs, 'reason' | 'expiresInDays'>
): string[] {
  const lines = [`[dry-run] ${command} ${plan.userId}`]
  if (!plan.user) {
    lines.push('  auth user: not found')
  } else {
    const until = plan.user.banExpires
      ? ` until ${plan.user.banExpires.toISOString()}`
      : ''
    lines.push(
      `  auth user: found, role=${plan.user.role ?? '(none)'}, banned=${plan.user.banned}${plan.user.banned ? until : ''}`
    )
    lines.push(
      `  sessions: ${plan.sessions}, MCP OAuth tokens: ${plan.oauthTokens}`
    )
  }
  if (command === 'ban') {
    lines.push(
      `  would set: banned=true, reason=${args.reason ? 'given' : '(none)'}, expires=${args.expiresInDays === null ? 'never' : `in ${args.expiresInDays} day(s)`}`
    )
  }
  if (isRoleCommand(command)) {
    lines.push(
      command === 'grant-admin'
        ? plan.user?.banned
          ? '  would refuse: the user is banned (unban first)'
          : `  would set: role=admin (platform admin API access)${plan.user?.role === 'admin' ? '; already admin, nothing to do' : ''}`
        : `  would set: role=user${plan.user?.role === 'admin' ? '' : '; not admin, nothing to do'}`
    )
    return lines
  }
  if (command === 'unban') {
    lines.push(
      '  would clear the ban fields; memberships are NOT restored (re-invite to bring the person back)'
    )
    return lines
  }
  lines.push(`  memberships: ${plan.memberships.length}`)
  for (const m of plan.memberships) {
    lines.push(
      `    workspace ${m.workspaceId} member ${m.memberId} (${m.role}): ${PLAN_ACTION_TEXT[m.action]}`
    )
  }
  return lines
}

function formatOutcome(o: DeprovisionOutcome): string {
  const keys =
    'apiKeysRevoked' in o ? `, API keys revoked: ${o.apiKeysRevoked}` : ''
  return `    workspace ${o.workspaceId} member ${o.memberId}: ${o.outcome}${keys}`
}

export function formatBanResult(r: BanResult): string[] {
  return [
    `banned ${r.userId}${r.wasBanned ? ' (was already banned)' : ''}`,
    `  sessions revoked: ${r.sessionsRevoked}, MCP OAuth tokens revoked: ${r.oauthTokensRevoked}`,
    `  memberships: ${r.memberships.length}`,
    ...r.memberships.map(formatOutcome),
  ]
}

export function formatUnbanResult(r: UnbanResult): string[] {
  return [
    r.changed
      ? `unbanned ${r.userId}; memberships are NOT restored`
      : `${r.userId} was not banned; nothing changed`,
  ]
}

export function formatRoleResult(
  command: 'grant-admin' | 'revoke-admin',
  r: PlatformAdminRoleResult
): string[] {
  if (!r.changed)
    return [`${r.userId} already has role=${r.role}; nothing changed`]
  return [
    command === 'grant-admin'
      ? `granted platform admin to ${r.userId} (role=${r.role})`
      : `revoked platform admin from ${r.userId} (role=${r.role}); its admin tokens stop working on the next request`,
  ]
}

export function formatRemoveResult(r: RemoveResult): string[] {
  if (r.outcome === 'already_removed') {
    return [`${r.userId} was already removed; nothing changed`]
  }
  return [
    `removed ${r.userId}`,
    `  sessions revoked: ${r.sessionsRevoked}, MCP OAuth tokens revoked: ${r.oauthTokensRevoked}`,
    `  memberships: ${r.memberships.length}`,
    ...r.memberships.map(formatOutcome),
  ]
}

export function writeLines(lines: string[]): void {
  process.stdout.write(lines.join('\n') + '\n')
}
