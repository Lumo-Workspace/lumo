/**
 * @jest-environment node
 */
// LUM-1027 — one UserDirectory contract, run against BOTH implementations
// through the public @/lib/auth/users entry point (AUTH_PROVIDER switches
// them). Each provider's backend is an in-memory fake of what it really
// talks to: Clerk's Backend API users resource, and the auth_users
// repository for Better Auth.
import type { AuthUser, UserDirectory } from '@/lib/auth/users'

interface Seed {
  id: string
  firstName: string
  lastName: string
  email: string
}
const SEED: Seed[] = [
  { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.io' },
  { id: 'u2', firstName: 'Grace', lastName: 'Hopper', email: 'grace@x.io' },
]

// ── Clerk fake (Backend API `users` resource) ───────────────────────────────
const clerkStore = new Map<string, AuthUser>()
function clerkUser(s: Seed): AuthUser {
  const email = {
    id: `idn_${s.id}`,
    emailAddress: s.email,
    verification: { status: 'verified' },
  }
  return {
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    username: null,
    imageUrl: 'https://img.clerk/x',
    primaryEmailAddressId: email.id,
    primaryEmailAddress: email,
    emailAddresses: [email],
  }
}
const fakeClerkUsers = {
  getUser: async (id: string) => {
    const u = clerkStore.get(id)
    if (!u) throw Object.assign(new Error('not found'), { status: 404 })
    return u
  },
  getUserList: async (q: {
    userId?: string[]
    emailAddress?: string[]
    limit?: number
  }) => ({
    data: [...clerkStore.values()]
      .filter(
        u =>
          q.userId?.includes(u.id) ||
          q.emailAddress?.some(
            e => e.toLowerCase() === u.emailAddresses[0]?.emailAddress
          )
      )
      .slice(0, q.limit ?? 10),
  }),
  updateUser: async (
    id: string,
    upd: { firstName?: string; lastName?: string }
  ) => {
    const u = await fakeClerkUsers.getUser(id)
    const next = { ...u, ...upd }
    clerkStore.set(id, next)
    return next
  },
  updateUserProfileImage: async () => ({}),
}
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: fakeClerkUsers }),
  createClerkClient: () => ({ users: fakeClerkUsers }),
}))

// ── Better Auth fake (auth_users repository) ────────────────────────────────
type Row = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  firstName: string | null
  lastName: string | null
}
const baStore = new Map<string, Row>()
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: {
    findById: async (id: string) => baStore.get(id) ?? null,
    findMany: async (f: { ids?: string[]; emails?: string[]; limit: number }) =>
      [...baStore.values()]
        .filter(
          r =>
            f.ids?.includes(r.id) ||
            f.emails?.some(e => e.toLowerCase() === r.email)
        )
        .slice(0, f.limit),
    update: async (id: string, data: Partial<Row>) => {
      const next = { ...baStore.get(id)!, ...data }
      baStore.set(id, next)
      return next
    },
  },
}))

import { getUserDirectory } from '@/lib/auth/users'

const savedProvider = process.env.AUTH_PROVIDER
afterAll(() => {
  if (savedProvider === undefined) delete process.env.AUTH_PROVIDER
  else process.env.AUTH_PROVIDER = savedProvider
})

const PROVIDERS = [
  {
    name: 'clerk',
    setup: () => {
      delete process.env.AUTH_PROVIDER
      clerkStore.clear()
      for (const s of SEED) clerkStore.set(s.id, clerkUser(s))
    },
  },
  {
    name: 'better-auth',
    setup: () => {
      process.env.AUTH_PROVIDER = 'better-auth'
      baStore.clear()
      for (const s of SEED) {
        baStore.set(s.id, {
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          email: s.email,
          emailVerified: true,
          image: null,
          firstName: s.firstName,
          lastName: s.lastName,
        })
      }
    },
  },
]

describe.each(PROVIDERS)('UserDirectory contract — $name', ({ setup }) => {
  let dir: UserDirectory
  beforeEach(async () => {
    setup()
    dir = await getUserDirectory()
  })

  it('getUser returns names and a verified primary email', async () => {
    const u = await dir.getUser('u1')
    expect(u).toMatchObject({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
    })
    const primary = u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)
    expect(primary).toMatchObject({
      emailAddress: 'ada@x.io',
      verification: { status: 'verified' },
    })
    expect(typeof u.imageUrl).toBe('string')
  })

  it('getUser rejects for an unknown user', async () => {
    await expect(dir.getUser('nope')).rejects.toBeTruthy()
  })

  it('getUserList omits unknown ids and matches emails case-insensitively', async () => {
    const byId = await dir.getUserList({ userId: ['u1', 'nope'], limit: 10 })
    expect(byId.data.map(u => u.id)).toEqual(['u1'])
    const byEmail = await dir.getUserList({ emailAddress: ['GRACE@x.io'] })
    expect(byEmail.data.map(u => u.id)).toEqual(['u2'])
  })

  it('getUserList honours limit', async () => {
    const page = await dir.getUserList({ userId: ['u1', 'u2'], limit: 1 })
    expect(page.data).toHaveLength(1)
  })

  it('updateUser changes the name seen by getUser', async () => {
    await dir.updateUser('u2', { firstName: 'Rear Admiral' })
    await expect(dir.getUser('u2')).resolves.toMatchObject({
      firstName: 'Rear Admiral',
      lastName: 'Hopper',
    })
  })
})
