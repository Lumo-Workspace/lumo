/**
 * @jest-environment node
 */
// LUM-1027 — the UserDirectory contract, run through the public
// @/lib/auth/users entry point against an in-memory fake of the auth_users
// repository Better Auth reads. (Clerk's side went with Clerk, LUM-1077.)
import type { UserDirectory } from '@/lib/auth/users'

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

function seed() {
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
}

describe('UserDirectory contract', () => {
  let dir: UserDirectory
  beforeEach(async () => {
    seed()
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
