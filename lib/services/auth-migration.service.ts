/**
 * LUM-1072 — Clerk → Better Auth migration (RFC LUM-1069 §1.4, §6.3, §7, T3):
 * import (full / closing), verify, rekey and avatar re-hosting. The scripts
 * in scripts/auth-migration only parse arguments, unseal files and print
 * what this returns — counts, column labels and id-prefix stats, never an
 * email, a name or a password hash.
 */
import {
  idPrefixStats,
  isImportableBcrypt,
  type ExportBundle,
} from '@/lib/auth-migration/clerk-export'
import {
  CLERK_IMAGE_HOSTS,
  planImport,
  summarizePlan,
  type ImportMode,
  type ImportPlan,
  type PlanSummary,
} from '@/lib/auth-migration/import-plan'
import {
  columnLabel,
  MENTION_COLUMNS,
  USER_ID_COLUMNS,
  type IdColumn,
} from '@/lib/auth-migration/identity-columns'
import { authMigrationRepository as repo } from '@/lib/repositories/auth-migration.repository'
import type { BlobStorage } from '@/lib/blob/types'
import { nameFieldsForCreate } from '@/lib/auth/users'

function serviceError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status })
}

// ── import ────────────────────────────────────────────────────────────────

export interface ImportReport extends PlanSummary {
  clerkTotalCount: number
  csvProvided: boolean
  csvRowsWithoutApiUser: number
  /** Pending invites addressed to a user's non-primary verified email. */
  pendingInvitesToSecondaryEmails: number
}

export interface ImportResult {
  report: ImportReport
  applied: number
  failed: number
  /** Ids only, for the sealed details file — never printed. */
  failedIds: string[]
  skippedIds: Array<{ id: string; reason: string }>
  /** T_import: pass to `--closing --since` (RFC §6.3). */
  finishedAt: Date
}

async function buildPlan(
  bundle: ExportBundle,
  mode: ImportMode,
  since: Date | undefined,
  now: Date
): Promise<{ plan: ImportPlan; report: ImportReport }> {
  const [existingUsers, existingAccounts] = await Promise.all([
    repo.listAuthUsers(),
    repo.listAuthAccounts(),
  ])
  const plan = planImport({
    users: bundle.users,
    existingUsers,
    existingAccounts,
    mode,
    since,
    now,
    nameFields: nameFieldsForCreate,
  })
  const secondary = [
    ...new Set(bundle.users.flatMap(u => u.otherVerifiedEmails)),
  ]
  const report: ImportReport = {
    ...summarizePlan(bundle.users, plan),
    clerkTotalCount: bundle.clerkTotalCount,
    csvProvided: bundle.csvProvided,
    csvRowsWithoutApiUser: bundle.csvRowsWithoutApiUser,
    pendingInvitesToSecondaryEmails: await repo.countPendingInvitesTo(
      secondary,
      now
    ),
  }
  return { plan, report }
}

export async function importClerkExport(
  bundle: ExportBundle,
  opts: {
    mode: ImportMode
    since?: Date | undefined
    confirm: boolean
    now?: Date
    clock?: () => Date
  }
): Promise<ImportResult> {
  const clock = opts.clock ?? (() => new Date())
  const { plan, report } = await buildPlan(
    bundle,
    opts.mode,
    opts.since,
    opts.now ?? clock()
  )
  const skippedIds = plan.users
    .filter(p => p.action === 'skip')
    .map(p => ({ id: p.id, reason: p.skipReason! }))
  let applied = 0
  const failedIds: string[] = []
  if (opts.confirm) {
    for (const p of plan.users) {
      if (p.action === 'skip' || p.action === 'unchanged') continue
      if (p.action === 'keep' && p.accounts.length === 0) continue
      try {
        await repo.applyUserPlan(p)
        applied++
      } catch {
        failedIds.push(p.id)
      }
    }
  }
  return {
    report,
    applied,
    failed: failedIds.length,
    failedIds,
    skippedIds,
    finishedAt: clock(),
  }
}

// ── verify ────────────────────────────────────────────────────────────────

export interface ColumnCheck {
  column: string
  kind: 'id' | 'mention'
  distinct: number
  missing: number
  /** Missing ids that still have an active membership — a hard failure. */
  missingActive: number
  missingIdPrefixes: Record<string, number>
}

export interface VerifyReport {
  clerkTotalCount: number
  exported: number
  imported: number
  skipped: number
  /** Exported users neither in auth_users nor explained by a skip reason. */
  unexplainedMissing: number
  accountsMissing: number
  /**
   * Imported users whose ban state differs from the export. A warning, not a
   * failure: after the cutover a ban or unban done in Better Auth
   * (scripts/auth-admin, T2) legitimately differs from the frozen Clerk export.
   */
  bannedMismatch: number
  columns: ColumnCheck[]
  ok: boolean
  problems: string[]
}

export async function verifyMigration(
  bundle: ExportBundle
): Promise<VerifyReport> {
  const authUsers = await repo.listAuthUsers()
  const byId = new Map(authUsers.map(u => [u.id, u]))
  const idByEmail = new Map(authUsers.map(u => [u.email.toLowerCase(), u.id]))
  const emailCount = new Map<string, number>()
  for (const u of bundle.users) {
    const e = u.primaryEmail?.toLowerCase()
    if (e) emailCount.set(e, (emailCount.get(e) ?? 0) + 1)
  }
  const accountKeys = await repo.accountKeysByUser()
  const socialOwners = new Map<string, string>()
  for (const [userId, keys] of accountKeys) {
    for (const k of keys) socialOwners.set(k, userId)
  }

  let imported = 0
  let skipped = 0
  let unexplainedMissing = 0
  let accountsMissing = 0
  let bannedMismatch = 0
  for (const u of bundle.users) {
    const have = byId.get(u.id)
    if (!have) {
      const e = u.primaryEmail?.toLowerCase()
      const explained =
        !e ||
        (emailCount.get(e) ?? 0) > 1 ||
        (idByEmail.has(e) && idByEmail.get(e) !== u.id)
      if (explained) skipped++
      else unexplainedMissing++
      continue
    }
    imported++
    if (have.banned !== u.banned) bannedMismatch++
    const keys = accountKeys.get(u.id) ?? new Set<string>()
    const wanted: string[] = []
    if (isImportableBcrypt(u.password)) wanted.push(`credential\u0000${u.id}`)
    for (const x of u.externalAccounts) {
      const k = `${x.providerId}\u0000${x.accountId}`
      const owner = socialOwners.get(k)
      if (owner === undefined || owner === u.id) wanted.push(k)
    }
    for (const k of wanted) {
      if (k.startsWith('credential\u0000')) {
        if (![...keys].some(x => x.startsWith('credential\u0000')))
          accountsMissing++
      } else if (!keys.has(k)) accountsMissing++
    }
  }

  const columns: ColumnCheck[] = []
  const check = async (c: IdColumn, kind: 'id' | 'mention') => {
    const ids =
      kind === 'id' ? await repo.distinctIds(c) : await repo.mentionedIds(c)
    const missing = ids.filter(id => !byId.has(id))
    const active = await repo.idsWithActiveMembership(missing)
    columns.push({
      column: columnLabel(c),
      kind,
      distinct: ids.length,
      missing: missing.length,
      missingActive: active.size,
      missingIdPrefixes: idPrefixStats(missing),
    })
  }
  for (const c of USER_ID_COLUMNS) await check(c, 'id')
  for (const c of MENTION_COLUMNS) await check(c, 'mention')

  const problems: string[] = []
  if (bundle.users.length !== bundle.clerkTotalCount) {
    problems.push(
      `export holds ${bundle.users.length} users but Clerk counted ${bundle.clerkTotalCount}`
    )
  }
  if (imported + skipped !== bundle.clerkTotalCount) {
    problems.push(
      `imported ${imported} + skipped ${skipped} != Clerk total ${bundle.clerkTotalCount}`
    )
  }
  if (unexplainedMissing > 0)
    problems.push(
      `${unexplainedMissing} exported user(s) missing without a skip reason`
    )
  if (accountsMissing > 0)
    problems.push(`${accountsMissing} expected auth account(s) missing`)
  const activeMissing = columns.reduce((n, c) => n + c.missingActive, 0)
  if (activeMissing > 0) {
    problems.push(
      `${activeMissing} id(s) with an active membership not found in auth_users`
    )
  }
  return {
    clerkTotalCount: bundle.clerkTotalCount,
    exported: bundle.users.length,
    imported,
    skipped,
    unexplainedMissing,
    accountsMissing,
    bannedMismatch,
    columns,
    ok: problems.length === 0,
    problems,
  }
}

// ── rekey (rollback, RFC §7 / Q8) ──────────────────────────────────────────

const USER_ID_SHAPE = /^user_[A-Za-z0-9]+$/

/** Validate an old → new id map; throws on anything ambiguous. */
export function parseRekeyMap(value: unknown): Map<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw serviceError(
      'The rekey map must be a JSON object {"<old id>": "<new Clerk id>"}.'
    )
  }
  const map = new Map<string, string>()
  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof to !== 'string' ||
      !USER_ID_SHAPE.test(to) ||
      !USER_ID_SHAPE.test(from)
    ) {
      throw serviceError(
        'Every rekey entry must map a user_… id to a user_… id.'
      )
    }
    if (from === to) throw serviceError('A rekey entry maps an id to itself.')
    map.set(from, to)
  }
  if (map.size === 0) throw serviceError('The rekey map is empty.')
  const targets = [...map.values()]
  if (new Set(targets).size !== targets.length) {
    throw serviceError('Two old ids map to the same new id.')
  }
  if (targets.some(t => map.has(t))) {
    throw serviceError(
      'A new id is also an old id (chained mapping); split it into two runs.'
    )
  }
  return map
}

export interface RekeyPlan {
  entries: number
  /** Rows referencing the OLD ids, per column. */
  references: Record<string, number>
  /** Rows already referencing a NEW id (must be 0). */
  targetCollisions: number
}

export async function planRekey(map: Map<string, string>): Promise<RekeyPlan> {
  const olds = [...map.keys()]
  const news = [...map.values()]
  const references: Record<string, number> = {}
  let targetCollisions = 0
  for (const c of USER_ID_COLUMNS) {
    references[columnLabel(c)] = await repo.countIdRefs(c, olds)
    targetCollisions += await repo.countIdRefs(c, news)
  }
  for (const c of MENTION_COLUMNS) {
    references[columnLabel(c)] = await repo.countMentionRefs(c, olds)
    targetCollisions += await repo.countMentionRefs(c, news)
  }
  return { entries: map.size, references, targetCollisions }
}

export async function applyRekey(
  map: Map<string, string>
): Promise<{ plan: RekeyPlan; changed: Record<string, number> }> {
  const plan = await planRekey(map)
  if (plan.targetCollisions > 0) {
    throw serviceError(
      `${plan.targetCollisions} row(s) already reference a new id; refusing to merge identities.`,
      409
    )
  }
  const changed = await repo.applyRekey(
    map,
    USER_ID_COLUMNS,
    MENTION_COLUMNS,
    columnLabel
  )
  return { plan, changed }
}

/** Better Auth users created after `since` (to build the rekey map). */
export async function windowUsers(since: Date) {
  return repo.authUsersCreatedSince(since)
}

// ── avatars (Q6) ──────────────────────────────────────────────────────────

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export type AvatarFetch = (url: string) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

export interface AvatarReport {
  candidates: number
  transferred: number
  failed: number
  /** Image changed while we copied it; left alone. */
  raced: number
  failedReasons: Record<string, number>
  failedIdPrefixes: Record<string, number>
}

export async function transferClerkAvatars(opts: {
  confirm: boolean
  storage?: BlobStorage | undefined
  fetchImpl?: AvatarFetch | undefined
}): Promise<AvatarReport> {
  const rows = await repo.usersWithImageOnHosts(CLERK_IMAGE_HOSTS)
  const report: AvatarReport = {
    candidates: rows.length,
    transferred: 0,
    failed: 0,
    raced: 0,
    failedReasons: {},
    failedIdPrefixes: {},
  }
  if (!opts.confirm) return report
  if (!opts.storage || !opts.fetchImpl) {
    throw serviceError('avatars --confirm needs a blob storage and fetch.')
  }
  const failedIds: string[] = []
  const fail = (id: string, reason: string) => {
    report.failed++
    report.failedReasons[reason] = (report.failedReasons[reason] ?? 0) + 1
    failedIds.push(id)
  }
  for (const row of rows) {
    let res: Awaited<ReturnType<AvatarFetch>>
    try {
      res = await opts.fetchImpl(row.image)
    } catch {
      fail(row.id, 'network')
      continue
    }
    if (!res.ok) {
      fail(row.id, `http_${res.status}`)
      continue
    }
    const type = (res.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    const ext = AVATAR_TYPES[type]
    if (!ext) {
      fail(row.id, 'not_an_image')
      continue
    }
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > AVATAR_MAX_BYTES) {
      fail(row.id, 'too_large')
      continue
    }
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length === 0 || body.length > AVATAR_MAX_BYTES) {
      fail(row.id, body.length === 0 ? 'empty' : 'too_large')
      continue
    }
    try {
      // Same path and options as a Better Auth profile upload
      // (lib/auth/better-auth/users.ts).
      const stored = await opts.storage.put(
        `avatars/${row.id}/avatar.${ext}`,
        body,
        { access: 'public', contentType: type, addRandomSuffix: true }
      )
      const swapped = await repo.replaceImageIfUnchanged(
        row.id,
        row.image,
        stored.url
      )
      if (swapped) report.transferred++
      else report.raced++
    } catch {
      fail(row.id, 'storage')
    }
  }
  report.failedIdPrefixes = idPrefixStats(failedIds)
  return report
}
