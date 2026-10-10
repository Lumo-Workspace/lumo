/**
 * LUM-1072 — argument parsing and report formatting for
 * scripts/auth-migration/*.ts. Reports carry counts, column labels and
 * id-prefix stats only: never an email, a name, a password hash, a full id
 * or a credential.
 */
import { parseArgs } from 'node:util'
import type { PlanSummary } from '@/lib/auth-migration/import-plan'
import type {
  AvatarReport,
  ImportResult,
  RekeyPlan,
  VerifyReport,
} from '@/lib/services/auth-migration.service'

export type MigrationCommand =
  | 'seal'
  | 'unseal'
  | 'export'
  | 'import'
  | 'verify'
  | 'rekey'
  | 'avatars'

export interface MigrationArgs {
  in: string | null
  out: string | null
  csv: string | null
  map: string | null
  detailsOut: string | null
  closing: boolean
  since: Date | null
  windowSince: Date | null
  windowOut: string | null
  confirm: boolean
}

const USAGE: Record<MigrationCommand, string> = {
  seal: '--in <plaintext file> --out <sealed file>',
  unseal: '--in <sealed file> --out <plaintext file>',
  export: '--out <sealed bundle> [--csv <sealed Clerk CSV>]',
  import:
    '--in <sealed bundle> [--closing --since <T_import ISO>] [--details-out <sealed file>] [--confirm]',
  verify: '--in <sealed bundle>',
  rekey:
    '(--map <sealed JSON {"old":"new"}> [--confirm]) | (--window-since <ISO> --window-out <sealed file>)',
  avatars: '[--confirm]',
}

export function usage(command: MigrationCommand): string {
  return `Usage: npx tsx scripts/auth-migration/${command}.ts ${USAGE[command]}`
}

function usageError(command: MigrationCommand, message: string): Error {
  return Object.assign(new Error(`${message}\n${usage(command)}`), {
    status: 400,
  })
}

function parseInstant(
  command: MigrationCommand,
  flag: string,
  raw: string | undefined
): Date | null {
  if (raw === undefined) return null
  const d = new Date(raw)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(d.getTime())) {
    throw usageError(
      command,
      `${flag} must be an ISO timestamp (e.g. 2026-10-20T08:00:00.000Z).`
    )
  }
  return d
}

export function parseMigrationArgs(
  command: MigrationCommand,
  argv: string[]
): MigrationArgs {
  let v: Record<string, string | boolean | undefined>
  try {
    v = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        in: { type: 'string' },
        out: { type: 'string' },
        csv: { type: 'string' },
        map: { type: 'string' },
        'details-out': { type: 'string' },
        closing: { type: 'boolean', default: false },
        since: { type: 'string' },
        'window-since': { type: 'string' },
        'window-out': { type: 'string' },
        confirm: { type: 'boolean', default: false },
      },
    }).values
  } catch (err) {
    throw usageError(command, (err as Error).message)
  }
  const str = (k: string) => (v[k] as string | undefined) ?? null
  const args: MigrationArgs = {
    in: str('in'),
    out: str('out'),
    csv: str('csv'),
    map: str('map'),
    detailsOut: str('details-out'),
    closing: v.closing === true,
    since: parseInstant(command, '--since', v.since as string | undefined),
    windowSince: parseInstant(
      command,
      '--window-since',
      v['window-since'] as string | undefined
    ),
    windowOut: str('window-out'),
    confirm: v.confirm === true,
  }
  const allowed: Record<MigrationCommand, string[]> = {
    seal: ['in', 'out'],
    unseal: ['in', 'out'],
    export: ['out', 'csv'],
    import: ['in', 'closing', 'since', 'details-out', 'confirm'],
    verify: ['in'],
    rekey: ['map', 'confirm', 'window-since', 'window-out'],
    avatars: ['confirm'],
  }
  for (const k of Object.keys(v)) {
    const set = v[k] !== undefined && v[k] !== false
    if (set && !allowed[command].includes(k)) {
      throw usageError(command, `--${k} is not valid for ${command}.`)
    }
  }
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw usageError(command, msg)
  }
  if (command === 'seal' || command === 'unseal') {
    need(!!args.in && !!args.out, '--in and --out are required.')
  }
  if (command === 'export') need(!!args.out, '--out is required.')
  if (command === 'import' || command === 'verify') {
    need(!!args.in, '--in is required.')
  }
  if (command === 'import') {
    need(
      args.closing === (args.since !== null),
      '--closing and --since go together (since = T_import printed by the previous import).'
    )
  }
  if (command === 'rekey') {
    const window = args.windowSince !== null || args.windowOut !== null
    need(
      window
        ? !!args.windowSince && !!args.windowOut && !args.map && !args.confirm
        : !!args.map,
      'Pass either --map (rekey) or --window-since with --window-out (list window users).'
    )
  }
  return args
}

const kv = (rec: Record<string, number>): string => {
  const entries = Object.entries(rec).sort(([a], [b]) => a.localeCompare(b))
  return entries.length === 0
    ? '(none)'
    : entries.map(([k, n]) => `${k}=${n}`).join(', ')
}

export function formatImportSummary(
  s: PlanSummary & {
    clerkTotalCount: number
    csvProvided: boolean
    csvRowsWithoutApiUser: number
    pendingInvitesToSecondaryEmails: number
  }
): string[] {
  return [
    `mode: ${s.mode}`,
    `users in export: ${s.total} (Clerk count at export: ${s.clerkTotalCount})`,
    `CSV: ${s.csvProvided ? 'included' : 'NOT included (no passwords will be imported)'}; CSV rows without an API user: ${s.csvRowsWithoutApiUser}`,
    `plan: create=${s.actions.create}, update=${s.actions.update}, unchanged=${s.actions.unchanged}, keep=${s.actions.keep}, skip=${s.actions.skip}`,
    `skipped: ${kv(s.skipped)}; skipped id prefixes: ${kv(s.skippedIdPrefixes)}`,
    `primary email unverified: ${s.primaryEmailUnverified}`,
    `users with more than one verified email: ${s.multipleVerifiedEmails}; pending invites to a non-primary email: ${s.pendingInvitesToSecondaryEmails}`,
    `password hashers: ${kv(s.passwordHashers)}`,
    `password enabled but no importable bcrypt hash (use forgot password): ${s.passwordEnabledWithoutBcrypt}`,
    `social providers: ${kv(s.providers)}`,
    `banned: ${s.banned}; locked: ${s.locked}; MFA enabled: ${s.mfaEnabled}; username-only (no email): ${s.usernameOnly}`,
    `Clerk-hosted avatars: ${s.clerkAvatars}`,
    `account writes: credential=${s.credentialWrites}, social=${s.socialWrites}; social conflicts: ${s.socialConflicts}; credential changed in Better Auth after T_import (kept): ${s.credentialChangedInBetterAuth}`,
  ]
}

export function formatImportResult(
  r: ImportResult,
  confirmed: boolean
): string[] {
  const lines = formatImportSummary(r.report)
  if (!confirmed) {
    lines.push('[dry-run] Nothing was written. Re-run with --confirm to apply.')
    return lines
  }
  lines.push(`applied: ${r.applied}; failed: ${r.failed}`)
  lines.push(
    `T_import (pass to --closing --since): ${r.finishedAt.toISOString()}`
  )
  return lines
}

export function formatVerify(r: VerifyReport): string[] {
  const lines = [
    `Clerk total: ${r.clerkTotalCount}; exported: ${r.exported}; imported: ${r.imported}; skipped: ${r.skipped}`,
    `unexplained missing: ${r.unexplainedMissing}; expected accounts missing: ${r.accountsMissing}; banned mismatches (warning only): ${r.bannedMismatch}`,
    'id columns (distinct / missing in auth_users / missing with active membership):',
  ]
  for (const c of r.columns) {
    lines.push(
      `  ${c.kind === 'mention' ? '@' : ' '} ${c.column}: ${c.distinct} / ${c.missing} / ${c.missingActive}${c.missing ? ` (prefixes: ${kv(c.missingIdPrefixes)})` : ''}`
    )
  }
  if (r.ok) lines.push('OK')
  else for (const p of r.problems) lines.push(`PROBLEM: ${p}`)
  return lines
}

export function formatRekeyPlan(p: RekeyPlan): string[] {
  return [
    `entries: ${p.entries}`,
    `rows referencing the old ids: ${kv(p.references)}`,
    `rows already referencing a new id: ${p.targetCollisions}`,
  ]
}

export function formatAvatars(r: AvatarReport, confirmed: boolean): string[] {
  const lines = [`avatars still on Clerk hosts: ${r.candidates}`]
  if (!confirmed) {
    lines.push('[dry-run] Nothing was copied. Re-run with --confirm.')
    return lines
  }
  lines.push(
    `transferred: ${r.transferred}; failed: ${r.failed} (${kv(r.failedReasons)}); changed meanwhile (left alone): ${r.raced}`
  )
  if (r.failed) lines.push(`failed id prefixes: ${kv(r.failedIdPrefixes)}`)
  return lines
}
