/**
 * LUM-1072 — fake Clerk export for the migration tooling tests. The CSV
 * (header per the Better Auth Clerk migration guide) and the Backend API
 * user objects (OpenAPI `User` shape) live in __tests__/fixtures/auth-migration;
 * everything is invented, emails are @example.com. Password hashes are not
 * stored: the CSV holds `{{BCRYPT_<NAME>}}` placeholders that are filled here
 * with bcrypt hashes of throwaway passwords generated per run.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { hashSync } from 'bcryptjs'
import type { ClerkApiUser } from '@/lib/auth-migration/clerk-export'

const DIR = path.resolve(__dirname, '../__tests__/fixtures/auth-migration')

export const FIXTURE_IDS = {
  pwOnly: 'user_2pwOnly0001',
  ghOnly: 'user_2ghOnly0002',
  goOnly: 'user_2goOnly0003',
  pwAndGh: 'user_2pwAndGh0004',
  unverified: 'user_2unverif0005',
  banned: 'user_2banned00006',
  caseA: 'user_2caseA000007',
  caseB: 'user_2caseB000008',
  noEmail: 'user_2noEmail0009',
  argon: 'user_2argon00010',
  mfa: 'user_2mfa0000011',
} as const

const PLACEHOLDER_OWNER: Record<string, string> = {
  ADA: FIXTURE_IDS.pwOnly,
  MARY: FIXTURE_IDS.pwAndGh,
  KAT: FIXTURE_IDS.unverified,
  BANNED: FIXTURE_IDS.banned,
  MFA: FIXTURE_IDS.mfa,
}

export interface ClerkFixture {
  csvText: string
  /** user id → the plaintext password its bcrypt hash was made from. */
  passwords: Record<string, string>
  apiUsers: ClerkApiUser[]
}

export function loadClerkFixture(): ClerkFixture {
  const passwords: Record<string, string> = {}
  const csvText = readFileSync(
    path.join(DIR, 'clerk-users-export.csv'),
    'utf8'
  ).replace(/\{\{BCRYPT_([A-Z]+)\}\}/g, (_, name: string) => {
    const owner = PLACEHOLDER_OWNER[name]
    if (!owner) throw new Error(`unknown placeholder ${name}`)
    const pw = `pw-${randomBytes(9).toString('base64url')}`
    passwords[owner] = pw
    // Clerk exports $2a$ hashes; cost 4 keeps the tests fast.
    return hashSync(pw, 4).replace(/^\$2b\$/, '$2a$')
  })
  const apiUsers = JSON.parse(
    readFileSync(path.join(DIR, 'clerk-api-users.json'), 'utf8')
  ) as ClerkApiUser[]
  return { csvText, passwords, apiUsers }
}

type FakeResponse = {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): FakeResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: n => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  }
}

/**
 * A recorded-style Clerk Backend API: `/users/count` and cursor-paged
 * `/users` (ascending created_at), answering 429 (with Retry-After) to the
 * request numbers in `rateLimitOn`. Records every request URL and auth header.
 */
export function fakeClerkApi(
  users: ClerkApiUser[],
  opts: { rateLimitOn?: number[]; retryAfter?: string } = {}
) {
  const requests: Array<{ url: string; authorization: string }> = []
  const sorted = [...users].sort(
    (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
  )
  const fetchImpl = async (
    url: string,
    init: { headers: Record<string, string> }
  ): Promise<FakeResponse> => {
    requests.push({ url, authorization: init.headers.authorization ?? '' })
    if (opts.rateLimitOn?.includes(requests.length)) {
      return response(
        429,
        { errors: [{ code: 'too_many_requests' }] },
        opts.retryAfter !== undefined ? { 'retry-after': opts.retryAfter } : {}
      )
    }
    const u = new URL(url)
    if (u.pathname.endsWith('/users/count')) {
      return response(200, { object: 'total_count', total_count: users.length })
    }
    if (u.pathname.endsWith('/users')) {
      const limit = Number(u.searchParams.get('limit') ?? '10')
      const after = u.searchParams.get('starting_after')
      const start = after ? sorted.findIndex(x => x.id === after) + 1 : 0
      return response(200, sorted.slice(start, start + limit))
    }
    return response(404, { errors: [] })
  }
  return { fetchImpl, requests }
}
