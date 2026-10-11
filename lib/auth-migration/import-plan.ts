/**
 * LUM-1072 — what an import would write, decided from the Clerk export and
 * the current Better Auth rows. Pure: the service loads the rows, calls
 * `planImport`, prints `summarizePlan` (counts only) and, with --confirm,
 * hands each `UserPlan` to the repository.
 *
 * Mapping (RFC LUM-1069 §1.4): id kept as is; email = primary, lowercased;
 * emailVerified = the primary's status; name via nameFieldsForCreate; image
 * = uploaded Clerk avatar; credential account only for a bcrypt digest;
 * social accounts keyed by (providerId, accountId), no tokens; banned copied.
 *
 * Modes:
 *   - full: create missing users, update changed fields of existing ones.
 *     Idempotent: a second run plans nothing but `unchanged`.
 *   - closing (RFC §6.3 step 5): only INSERT users Better Auth does not
 *     have. For existing users the only write is the credential password,
 *     and only when the Better Auth account was not touched after
 *     `since` (= T_import), i.e. the person has not changed it in Better Auth.
 *     Missing social accounts are inserted; nothing else is overwritten.
 */
import {
  idPrefixStats,
  isImportableBcrypt,
  type MigrationUser,
} from './clerk-export'

export type ImportMode = 'full' | 'closing'

/**
 * Better Auth's name rule for a new user (nameFieldsForCreate in
 * lib/auth/better-auth/user-shape.ts), injected by the service because only
 * lib/auth and lib/services may import the auth implementation.
 */
export type NameFieldsFn = (input: {
  email: string
  firstName: string | null
  lastName: string | null
  name: null
}) => { name: string; firstName: string | null; lastName: string | null }

export type SkipReason = 'no_email' | 'email_case_conflict' | 'email_taken'

/** Better Auth's provider id for email + password accounts. */
export const CREDENTIAL_PROVIDER = 'credential'

/** Hosts that serve Clerk avatars (RFC §1.4 "头像"). */
export const CLERK_IMAGE_HOSTS = ['img.clerk.com', 'images.clerk.dev']

export function isClerkImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && CLERK_IMAGE_HOSTS.includes(u.hostname)
  } catch {
    return false
  }
}

export interface ExistingAuthUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
  firstName: string | null
  lastName: string | null
  image: string | null
  banned: boolean
}

export interface ExistingAuthAccount {
  id: string
  userId: string
  providerId: string
  accountId: string
  scope: string | null
  password: string | null
  updatedAt: Date
}

export interface AuthUserWrite {
  email: string
  emailVerified: boolean
  name: string
  firstName: string | null
  lastName: string | null
  image: string | null
  banned: boolean
  banReason: null
  banExpires: null
}

export interface AuthUserCreate extends AuthUserWrite {
  id: string
  role: 'user'
  createdAt: Date
}

export type AccountWrite =
  | {
      action: 'create'
      id: string
      userId: string
      providerId: string
      accountId: string
      scope: string | null
      password: string | null
    }
  | {
      action: 'update'
      id: string
      scope?: string | null
      password?: string
    }

export interface UserPlan {
  id: string
  action: 'create' | 'update' | 'unchanged' | 'keep' | 'skip'
  skipReason?: SkipReason
  create?: AuthUserCreate
  update?: Partial<AuthUserWrite>
  accounts: AccountWrite[]
}

export interface PlanCounters {
  /** closing: credential kept because Better Auth changed it after T_import */
  credentialChangedInBetterAuth: number
  /** social identity already linked to a different Better Auth user */
  socialConflicts: number
}

export interface ImportPlan {
  mode: ImportMode
  users: UserPlan[]
  counters: PlanCounters
}

/** Deterministic account row ids: re-runs never duplicate a row. */
export function credentialAccountId(userId: string): string {
  return `clerk-${userId}-${CREDENTIAL_PROVIDER}`
}
export function socialAccountRowId(
  userId: string,
  providerId: string,
  accountId: string
): string {
  return `clerk-${userId}-${providerId}-${accountId}`
}

function userWrite(
  u: MigrationUser,
  email: string,
  nameFields: NameFieldsFn
): AuthUserWrite {
  const names = nameFields({
    email,
    firstName: u.firstName,
    lastName: u.lastName,
    name: null,
  })
  return {
    email,
    emailVerified: u.primaryEmailVerified,
    ...names,
    image: u.imageUrl,
    banned: u.banned,
    banReason: null,
    banExpires: null,
  }
}

/** Only the fields that differ; image is never replaced once re-hosted. */
function userDiff(
  want: AuthUserWrite,
  have: ExistingAuthUser
): Partial<AuthUserWrite> {
  const diff: Partial<AuthUserWrite> = {}
  if (want.email !== have.email) diff.email = want.email
  if (want.emailVerified !== have.emailVerified)
    diff.emailVerified = want.emailVerified
  if (want.name !== have.name) diff.name = want.name
  if (want.firstName !== have.firstName) diff.firstName = want.firstName
  if (want.lastName !== have.lastName) diff.lastName = want.lastName
  const imageIsOurs = have.image !== null && !isClerkImageUrl(have.image)
  if (!imageIsOurs && want.image !== have.image) diff.image = want.image
  if (want.banned !== have.banned) {
    diff.banned = want.banned
    if (!want.banned) {
      diff.banReason = null
      diff.banExpires = null
    }
  }
  return diff
}

export function planImport(input: {
  users: MigrationUser[]
  existingUsers: ExistingAuthUser[]
  existingAccounts: ExistingAuthAccount[]
  mode: ImportMode
  /** closing only: T_import, the end of the last full/incremental import. */
  since?: Date | undefined
  now: Date
  nameFields: NameFieldsFn
}): ImportPlan {
  const { mode } = input
  if (mode === 'closing' && !input.since) {
    throw Object.assign(new Error('closing mode needs --since (T_import).'), {
      status: 400,
    })
  }
  const counters: PlanCounters = {
    credentialChangedInBetterAuth: 0,
    socialConflicts: 0,
  }
  const usersById = new Map(input.existingUsers.map(u => [u.id, u]))
  const idByEmail = new Map(
    input.existingUsers.map(u => [u.email.toLowerCase(), u.id])
  )
  const credentialByUser = new Map<string, ExistingAuthAccount>()
  const socialOwner = new Map<string, ExistingAuthAccount>()
  for (const a of input.existingAccounts) {
    if (a.providerId === CREDENTIAL_PROVIDER) credentialByUser.set(a.userId, a)
    else socialOwner.set(`${a.providerId}\u0000${a.accountId}`, a)
  }

  // Emails that differ only by case inside the export: none of them import.
  const exportEmailCount = new Map<string, number>()
  for (const u of input.users) {
    const e = u.primaryEmail?.toLowerCase()
    if (e) exportEmailCount.set(e, (exportEmailCount.get(e) ?? 0) + 1)
  }

  const plans: UserPlan[] = input.users.map(u => {
    const email = u.primaryEmail?.toLowerCase() ?? null
    const skip = (skipReason: SkipReason): UserPlan => ({
      id: u.id,
      action: 'skip',
      skipReason,
      accounts: [],
    })
    if (!email) return skip('no_email')
    if ((exportEmailCount.get(email) ?? 0) > 1)
      return skip('email_case_conflict')
    const owner = idByEmail.get(email)
    if (owner !== undefined && owner !== u.id) return skip('email_taken')

    const existing = usersById.get(u.id)
    const want = userWrite(u, email, input.nameFields)
    const plan: UserPlan = { id: u.id, action: 'create', accounts: [] }
    if (!existing) {
      plan.create = {
        id: u.id,
        role: 'user',
        createdAt: u.createdAt !== null ? new Date(u.createdAt) : input.now,
        ...want,
      }
    } else if (mode === 'closing') {
      plan.action = 'keep'
    } else {
      const diff = userDiff(want, existing)
      plan.action = Object.keys(diff).length > 0 ? 'update' : 'unchanged'
      if (plan.action === 'update') plan.update = diff
    }

    // Credential (email + password) account.
    if (isImportableBcrypt(u.password)) {
      const digest = u.password.digest
      const have = existing ? credentialByUser.get(u.id) : undefined
      if (!have) {
        plan.accounts.push({
          action: 'create',
          id: credentialAccountId(u.id),
          userId: u.id,
          providerId: CREDENTIAL_PROVIDER,
          accountId: u.id,
          scope: null,
          password: digest,
        })
      } else if (have.password !== digest) {
        if (mode === 'closing' && have.updatedAt > input.since!) {
          counters.credentialChangedInBetterAuth++
        } else {
          plan.accounts.push({
            action: 'update',
            id: have.id,
            password: digest,
          })
        }
      }
    }

    // Social accounts: Better Auth signs in by (providerId, accountId) first.
    for (const x of u.externalAccounts) {
      const have = socialOwner.get(`${x.providerId}\u0000${x.accountId}`)
      if (have && have.userId !== u.id) {
        counters.socialConflicts++
        continue
      }
      if (!have) {
        plan.accounts.push({
          action: 'create',
          id: socialAccountRowId(u.id, x.providerId, x.accountId),
          userId: u.id,
          providerId: x.providerId,
          accountId: x.accountId,
          scope: x.scope,
          password: null,
        })
      } else if (mode === 'full' && have.scope !== x.scope) {
        plan.accounts.push({ action: 'update', id: have.id, scope: x.scope })
      }
    }
    if (plan.action === 'unchanged' && plan.accounts.length > 0) {
      plan.action = 'update'
    }
    return plan
  })
  return { mode, users: plans, counters }
}

const inc = (rec: Record<string, number>, key: string) => {
  rec[key] = (rec[key] ?? 0) + 1
}

/** The dry-run / result report. Counts and id-prefix stats only. */
export interface PlanSummary {
  mode: ImportMode
  total: number
  actions: Record<UserPlan['action'], number>
  skipped: Record<SkipReason, number>
  skippedIdPrefixes: Record<string, number>
  primaryEmailUnverified: number
  multipleVerifiedEmails: number
  passwordHashers: Record<string, number>
  passwordEnabledWithoutBcrypt: number
  providers: Record<string, number>
  banned: number
  locked: number
  mfaEnabled: number
  usernameOnly: number
  clerkAvatars: number
  credentialWrites: number
  credentialChangedInBetterAuth: number
  socialWrites: number
  socialConflicts: number
}

export function summarizePlan(
  users: MigrationUser[],
  plan: ImportPlan
): PlanSummary {
  const s: PlanSummary = {
    mode: plan.mode,
    total: users.length,
    actions: { create: 0, update: 0, unchanged: 0, keep: 0, skip: 0 },
    skipped: { no_email: 0, email_case_conflict: 0, email_taken: 0 },
    skippedIdPrefixes: {},
    primaryEmailUnverified: 0,
    multipleVerifiedEmails: 0,
    passwordHashers: {},
    passwordEnabledWithoutBcrypt: 0,
    providers: {},
    banned: 0,
    locked: 0,
    mfaEnabled: 0,
    usernameOnly: 0,
    clerkAvatars: 0,
    credentialWrites: 0,
    credentialChangedInBetterAuth: plan.counters.credentialChangedInBetterAuth,
    socialWrites: 0,
    socialConflicts: plan.counters.socialConflicts,
  }
  for (const u of users) {
    if (u.primaryEmail && !u.primaryEmailVerified) s.primaryEmailUnverified++
    if (u.primaryEmailVerified && u.otherVerifiedEmails.length > 0)
      s.multipleVerifiedEmails++
    inc(
      s.passwordHashers,
      u.password === null
        ? '(no CSV row)'
        : u.password.digest
          ? (u.password.hasher ?? '(unknown)')
          : '(no password)'
    )
    if (u.passwordEnabled && !isImportableBcrypt(u.password))
      s.passwordEnabledWithoutBcrypt++
    for (const x of u.externalAccounts) inc(s.providers, x.providerId)
    if (u.banned) s.banned++
    if (u.locked) s.locked++
    if (u.mfaEnabled) s.mfaEnabled++
    if (!u.primaryEmail && u.username) s.usernameOnly++
    if (isClerkImageUrl(u.imageUrl)) s.clerkAvatars++
  }
  const skippedIds: string[] = []
  for (const p of plan.users) {
    s.actions[p.action]++
    if (p.skipReason) {
      s.skipped[p.skipReason]++
      skippedIds.push(p.id)
    }
    for (const a of p.accounts) {
      const isCredential =
        a.action === 'create'
          ? a.providerId === CREDENTIAL_PROVIDER
          : a.password !== undefined
      if (isCredential) s.credentialWrites++
      else s.socialWrites++
    }
  }
  s.skippedIdPrefixes = idPrefixStats(skippedIds)
  return s
}
