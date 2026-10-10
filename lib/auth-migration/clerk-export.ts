/**
 * LUM-1072 — the Clerk export, normalised. Pure functions, no I/O.
 *
 * Two sources (RFC LUM-1069 §1.3):
 *   - the Backend API `GET /v1/users` objects (snake_case REST shape,
 *     `components/schemas/User` of operation GetUserList in
 *     https://github.com/clerk/openapi-specs/blob/main/bapi/2026-05-12.yml) —
 *     emails with verification status, external accounts, banned/locked,
 *     avatar, MFA flags. No password hashes.
 *   - the Dashboard "Export users" CSV
 *     (https://clerk.com/docs/guides/development/migrating/overview), whose
 *     header Better Auth's migration guide documents as
 *     `id, first_name, last_name, username, primary_email_address,
 *     primary_phone_number, verified_email_addresses,
 *     unverified_email_addresses, verified_phone_numbers,
 *     unverified_phone_numbers, totp_secret, password_digest, password_hasher`
 *     (https://better-auth.com/docs/guides/clerk-migration-guide).
 *
 * Only `id`, `password_digest`, `password_hasher` and whether `totp_secret`
 * is set are taken from the CSV. Everything else comes from the API, so the
 * (undocumented) separator of the CSV's multi-value columns never matters.
 */

/** A Clerk Backend API user, the fields this tool reads. */
export interface ClerkApiUser {
  id: string
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  image_url?: string | null
  has_image?: boolean | null
  created_at?: number | null
  primary_email_address_id?: string | null
  email_addresses?: Array<{
    id: string
    email_address: string
    verification?: { status?: string | null } | null
  }> | null
  external_accounts?: Array<{
    provider?: string | null
    provider_user_id?: string | null
    approved_scopes?: string | null
  }> | null
  banned?: boolean | null
  locked?: boolean | null
  password_enabled?: boolean | null
  two_factor_enabled?: boolean | null
  totp_enabled?: boolean | null
  backup_code_enabled?: boolean | null
}

export interface ClerkCsvPassword {
  hasher: string | null
  digest: string | null
  hasTotp: boolean
}

export interface MigrationExternalAccount {
  /** Better Auth provider id: Clerk's provider without `oauth_`. */
  providerId: string
  accountId: string
  scope: string | null
}

/** One Clerk user as the import needs it. Lives only in sealed files. */
export interface MigrationUser {
  id: string
  firstName: string | null
  lastName: string | null
  username: string | null
  /** Primary email as Clerk stores it (case kept; the import lowercases). */
  primaryEmail: string | null
  primaryEmailVerified: boolean
  /** Verified emails other than the primary, lowercased. */
  otherVerifiedEmails: string[]
  /** Uploaded avatar URL; null when Clerk only has its generated default. */
  imageUrl: string | null
  createdAt: number | null
  banned: boolean
  locked: boolean
  mfaEnabled: boolean
  passwordEnabled: boolean
  externalAccounts: MigrationExternalAccount[]
  /** From the CSV; null when the CSV has no row for this user. */
  password: { hasher: string | null; digest: string | null } | null
}

export const BUNDLE_FORMAT = 'lumo-clerk-export'
export const BUNDLE_VERSION = 1

export interface ExportBundle {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  exportedAt: string
  /** `GET /v1/users/count` at export time. */
  clerkTotalCount: number
  csvProvided: boolean
  /** CSV rows whose id the API did not return (deleted between the two). */
  csvRowsWithoutApiUser: number
  users: MigrationUser[]
}

function bundleError(message: string): Error {
  return Object.assign(new Error(message), { status: 400 })
}

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (quoted) throw bundleError('CSV has an unterminated quoted field.')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => !(r.length === 1 && r[0]!.trim() === ''))
}

const REQUIRED_CSV_COLUMNS = ['id', 'password_digest', 'password_hasher']

/** id → password fields of the Dashboard CSV. */
export function parseClerkCsv(text: string): Map<string, ClerkCsvPassword> {
  const rows = parseCsv(text)
  const header = (rows[0] ?? []).map(h => h.trim())
  for (const col of REQUIRED_CSV_COLUMNS) {
    if (!header.includes(col)) {
      throw bundleError(
        `CSV is missing the "${col}" column; is this the Clerk Dashboard user export?`
      )
    }
  }
  const at = (name: string) => header.indexOf(name)
  const out = new Map<string, ClerkCsvPassword>()
  for (const r of rows.slice(1)) {
    const cell = (name: string): string | null => {
      const i = at(name)
      const v = i >= 0 ? (r[i] ?? '').trim() : ''
      return v === '' ? null : v
    }
    const id = cell('id')
    if (!id) continue
    out.set(id, {
      hasher: cell('password_hasher'),
      digest: cell('password_digest'),
      hasTotp: cell('totp_secret') !== null,
    })
  }
  return out
}

const BCRYPT_PREFIX = /^\$2[aby]\$\d\d\$/

/** A digest the Better Auth `password.verify` (T1, bcryptjs) accepts. */
export function isImportableBcrypt(
  password: MigrationUser['password']
): password is { hasher: string | null; digest: string } {
  return (
    !!password?.digest &&
    (password.hasher ?? '').toLowerCase() === 'bcrypt' &&
    BCRYPT_PREFIX.test(password.digest)
  )
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

/** Clerk `oauth_github` → Better Auth `github`. */
export function toProviderId(clerkProvider: string): string {
  return clerkProvider.replace(/^oauth_/, '')
}

export function toMigrationUser(
  api: ClerkApiUser,
  csv: ClerkCsvPassword | undefined
): MigrationUser {
  const emails = api.email_addresses ?? []
  const primary = emails.find(e => e.id === api.primary_email_address_id)
  const isVerified = (e: (typeof emails)[number]) =>
    e.verification?.status === 'verified'
  const externalAccounts: MigrationExternalAccount[] = []
  for (const x of api.external_accounts ?? []) {
    const provider = clean(x.provider)
    const accountId = clean(x.provider_user_id)
    if (!provider || !accountId) continue
    externalAccounts.push({
      providerId: toProviderId(provider),
      accountId,
      scope: clean(x.approved_scopes),
    })
  }
  return {
    id: api.id,
    firstName: clean(api.first_name),
    lastName: clean(api.last_name),
    username: clean(api.username),
    primaryEmail: clean(primary?.email_address),
    primaryEmailVerified: primary ? isVerified(primary) : false,
    otherVerifiedEmails: emails
      .filter(e => e !== primary && isVerified(e))
      .map(e => e.email_address.trim().toLowerCase()),
    imageUrl: api.has_image ? clean(api.image_url) : null,
    createdAt: typeof api.created_at === 'number' ? api.created_at : null,
    banned: api.banned === true,
    locked: api.locked === true,
    mfaEnabled:
      api.two_factor_enabled === true ||
      api.totp_enabled === true ||
      api.backup_code_enabled === true ||
      csv?.hasTotp === true,
    passwordEnabled: api.password_enabled === true,
    externalAccounts,
    password: csv ? { hasher: csv.hasher, digest: csv.digest } : null,
  }
}

/** Join the API users with the CSV rows into the sealed bundle. */
export function buildBundle(input: {
  apiUsers: ClerkApiUser[]
  clerkTotalCount: number
  csv: Map<string, ClerkCsvPassword> | null
  exportedAt: Date
}): ExportBundle {
  const seen = new Set<string>()
  const users: MigrationUser[] = []
  for (const u of input.apiUsers) {
    if (seen.has(u.id)) continue // offset paging can repeat a row
    seen.add(u.id)
    users.push(toMigrationUser(u, input.csv?.get(u.id)))
  }
  let csvRowsWithoutApiUser = 0
  for (const id of input.csv?.keys() ?? []) {
    if (!seen.has(id)) csvRowsWithoutApiUser++
  }
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: input.exportedAt.toISOString(),
    clerkTotalCount: input.clerkTotalCount,
    csvProvided: input.csv !== null,
    csvRowsWithoutApiUser,
    users,
  }
}

/** Parse and shape-check a decrypted bundle. */
export function parseBundle(json: string): ExportBundle {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw bundleError('The export file is not valid JSON.')
  }
  const b = value as Partial<ExportBundle>
  if (
    b?.format !== BUNDLE_FORMAT ||
    b.version !== BUNDLE_VERSION ||
    !Array.isArray(b.users) ||
    typeof b.clerkTotalCount !== 'number'
  ) {
    throw bundleError(
      'Not a Lumo Clerk export bundle (wrong format or version).'
    )
  }
  for (const u of b.users) {
    if (typeof u?.id !== 'string' || !Array.isArray(u.externalAccounts)) {
      throw bundleError('The export bundle has a malformed user record.')
    }
  }
  return b as ExportBundle
}

/** Counts by id prefix (`user_`, other) — the only id detail ever printed. */
export function idPrefixStats(ids: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of ids) {
    const m = /^([a-z]+_)/.exec(id)
    const key = m ? m[1]! : '(no prefix)'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}
