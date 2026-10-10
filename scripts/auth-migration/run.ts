/**
 * LUM-1072 — shared entry of scripts/auth-migration/*.ts. Every command:
 * parse → check paths are outside git → unseal inputs in memory → call
 * lib/services/auth-migration → print counts → seal any output. Exit 0 on
 * success, 1 on error (the message is ours, never a stack or row data).
 *
 * Secrets come from the user's shell only (no dotenv): the Clerk key from
 * CLERK_MIGRATION_SECRET_KEY (deliberately not the app's CLERK_SECRET_KEY,
 * so a dev key in a .env can never be picked up), the file passphrase from
 * LUMO_MIGRATION_PASSPHRASE, the target database from DATABASE_URL.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  buildBundle,
  parseBundle,
  parseClerkCsv,
} from '@/lib/auth-migration/clerk-export'
import {
  clerkInstanceKind,
  fetchAllClerkUsers,
  fetchClerkUserCount,
  type FetchLike,
} from '@/lib/auth-migration/clerk-api'
import {
  assertOutsideGitRepo,
  passphraseFromEnv,
  readSealedFile,
  writeSealedFile,
} from '@/lib/auth-migration/sealed-file'
import {
  applyRekey,
  importClerkExport,
  parseRekeyMap,
  planRekey,
  transferClerkAvatars,
  verifyMigration,
  windowUsers,
  type AvatarFetch,
} from '@/lib/services/auth-migration.service'
import type { BlobStorage } from '@/lib/blob/types'
import { describeDatabase } from '../auth-admin/cli'
import {
  formatAvatars,
  formatImportResult,
  formatRekeyPlan,
  formatVerify,
  parseMigrationArgs,
  type MigrationCommand,
} from './cli'

export const CLERK_KEY_ENV = 'CLERK_MIGRATION_SECRET_KEY'

export interface MigrationDeps {
  env: Record<string, string | undefined>
  write: (line: string) => void
  writeError: (line: string) => void
  now: () => Date
  clerkFetch?: FetchLike
  sleep?: (ms: number) => Promise<void>
  avatarFetch?: AvatarFetch
  getStorage?: () => Promise<BlobStorage>
}

function fail(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

/** Only our own (status-tagged) messages are shown; anything else by name. */
function safeMessage(err: unknown): string {
  const e = err as {
    status?: number
    message?: string
    code?: string
    name?: string
  }
  if (typeof e?.status === 'number' && e.message) return e.message
  return `unexpected ${e?.code ?? e?.name ?? 'error'} (details withheld: they may contain row data)`
}

async function runCommand(
  command: MigrationCommand,
  argv: string[],
  deps: MigrationDeps
): Promise<number> {
  const args = parseMigrationArgs(command, argv)
  const out = (lines: string[]) => lines.forEach(l => deps.write(l))
  const dbBanner = () =>
    out([`database: ${describeDatabase(deps.env.DATABASE_URL)}`])

  if (command === 'seal') {
    assertOutsideGitRepo(args.in!, '--in')
    const plain = readFileSync(args.in!)
    writeSealedFile(args.out!, plain, passphraseFromEnv(deps.env), '--out')
    out([
      `sealed ${plain.length} bytes.`,
      'Now delete the plaintext file securely (e.g. rm -P on macOS).',
    ])
    return 0
  }
  if (command === 'unseal') {
    const plain = readSealedFile(args.in!, passphraseFromEnv(deps.env), '--in')
    assertOutsideGitRepo(args.out!, '--out')
    if (existsSync(args.out!))
      throw fail('--out already exists; choose a new path.')
    writeFileSync(args.out!, plain, { mode: 0o600, flag: 'wx' })
    out([
      `wrote ${plain.length} bytes (plaintext, mode 600). Delete it when done.`,
    ])
    return 0
  }

  if (command === 'export') {
    const passphrase = passphraseFromEnv(deps.env)
    assertOutsideGitRepo(args.out!, '--out')
    const secretKey = deps.env[CLERK_KEY_ENV]
    if (!secretKey) {
      throw fail(
        `${CLERK_KEY_ENV} is not set. Export the Clerk secret key in your own shell (it is never printed).`
      )
    }
    if (!deps.clerkFetch) throw fail('no HTTP client')
    const api = {
      secretKey,
      fetchImpl: deps.clerkFetch,
      sleep: deps.sleep,
      onPage: (n: number) => deps.write(`  fetched ${n} users…`),
    }
    out([`Clerk instance: ${clerkInstanceKind(secretKey)}`])
    const csv = args.csv
      ? parseClerkCsv(
          readSealedFile(args.csv, passphrase, '--csv').toString('utf8')
        )
      : null
    const clerkTotalCount = await fetchClerkUserCount(api)
    const apiUsers = await fetchAllClerkUsers(api)
    const bundle = buildBundle({
      apiUsers,
      clerkTotalCount,
      csv,
      exportedAt: deps.now(),
    })
    writeSealedFile(
      args.out!,
      Buffer.from(JSON.stringify(bundle), 'utf8'),
      passphrase,
      '--out'
    )
    out([
      `Clerk count: ${clerkTotalCount}; fetched: ${bundle.users.length}`,
      `CSV: ${csv ? `${csv.size} rows, ${bundle.csvRowsWithoutApiUser} without an API user` : 'not given (no passwords)'}`,
      'sealed export written.',
    ])
    if (bundle.users.length !== clerkTotalCount) {
      out([
        'WARNING: fetched count differs from the Clerk count (sign-ups during the export?). verify will flag it; re-export if it persists.',
      ])
    }
    return 0
  }

  const passphrase = () => passphraseFromEnv(deps.env)
  const loadBundle = () =>
    parseBundle(readSealedFile(args.in!, passphrase(), '--in').toString('utf8'))

  if (command === 'import') {
    const bundle = loadBundle()
    if (args.detailsOut) assertOutsideGitRepo(args.detailsOut, '--details-out')
    dbBanner()
    const result = await importClerkExport(bundle, {
      mode: args.closing ? 'closing' : 'full',
      since: args.since ?? undefined,
      confirm: args.confirm,
      clock: deps.now,
    })
    out(formatImportResult(result, args.confirm))
    if (args.detailsOut) {
      writeSealedFile(
        args.detailsOut,
        Buffer.from(
          JSON.stringify({
            skipped: result.skippedIds,
            failed: result.failedIds,
          }),
          'utf8'
        ),
        passphrase(),
        '--details-out'
      )
      out(['skipped / failed ids written to the sealed details file.'])
    }
    return result.failed > 0 ? 1 : 0
  }

  if (command === 'verify') {
    const bundle = loadBundle()
    dbBanner()
    const report = await verifyMigration(bundle)
    out(formatVerify(report))
    return report.ok ? 0 : 1
  }

  if (command === 'rekey') {
    if (args.windowSince) {
      assertOutsideGitRepo(args.windowOut!, '--window-out')
      const pass = passphrase()
      dbBanner()
      const users = await windowUsers(args.windowSince)
      writeSealedFile(
        args.windowOut!,
        Buffer.from(JSON.stringify(users), 'utf8'),
        pass,
        '--window-out'
      )
      out([
        `Better Auth users created after the window start: ${users.length} (ids and emails sealed).`,
      ])
      return 0
    }
    let raw: unknown
    try {
      raw = JSON.parse(
        readSealedFile(args.map!, passphrase(), '--map').toString('utf8')
      )
    } catch (err) {
      if ((err as { status?: number }).status) throw err
      throw fail('--map is not valid JSON.')
    }
    const map = parseRekeyMap(raw)
    dbBanner()
    if (!args.confirm) {
      out([
        ...formatRekeyPlan(await planRekey(map)),
        '[dry-run] Nothing was written. Re-run with --confirm to apply.',
      ])
      return 0
    }
    const { plan, changed } = await applyRekey(map)
    out([
      ...formatRekeyPlan(plan),
      `rewritten rows: ${Object.entries(changed)
        .map(([k, n]) => `${k}=${n}`)
        .join(', ')}`,
    ])
    return 0
  }

  // avatars
  dbBanner()
  const report = await transferClerkAvatars({
    confirm: args.confirm,
    storage: args.confirm ? await deps.getStorage?.() : undefined,
    fetchImpl: deps.avatarFetch,
  })
  out(formatAvatars(report, args.confirm))
  return report.failed > 0 ? 1 : 0
}

/** Run `command`; resolves to the process exit code. */
export async function runAuthMigration(
  command: MigrationCommand,
  argv: string[],
  deps: MigrationDeps
): Promise<number> {
  try {
    return await runCommand(command, argv, deps)
  } catch (err) {
    deps.writeError(`error: ${safeMessage(err)}`)
    return 1
  }
}

/** Script main: real fetch / storage / clock, then disconnect and exit. */
export async function main(command: MigrationCommand): Promise<void> {
  const deps: MigrationDeps = {
    env: process.env,
    write: l => process.stdout.write(`${l}\n`),
    writeError: l => process.stderr.write(`${l}\n`),
    now: () => new Date(),
    clerkFetch: (url, init) => fetch(url, init),
    avatarFetch: url => fetch(url, { redirect: 'follow' }),
    getStorage: async () => {
      const { getBlobStorage } = await import('@/lib/blob/storage')
      return getBlobStorage()
    },
  }
  const code = await runAuthMigration(command, process.argv.slice(2), deps)
  if (command !== 'seal' && command !== 'unseal' && command !== 'export') {
    const { prisma } = await import('@/lib/db/prisma')
    await prisma.$disconnect()
  }
  process.exit(code)
}
