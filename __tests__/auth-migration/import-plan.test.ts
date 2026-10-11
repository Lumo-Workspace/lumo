/**
 * @jest-environment node
 *
 * LUM-1072 — what the import writes (pure planner): mapping, skip reasons,
 * idempotency, closing-mode rules and the counts-only summary.
 */
import { buildBundle, parseClerkCsv } from '@/lib/auth-migration/clerk-export'
import { nameFieldsForCreate } from '@/lib/auth/better-auth/user-shape'
import {
  credentialAccountId,
  isClerkImageUrl,
  planImport,
  socialAccountRowId,
  summarizePlan,
  type ExistingAuthAccount,
  type ExistingAuthUser,
  type UserPlan,
} from '@/lib/auth-migration/import-plan'
import {
  FIXTURE_IDS,
  loadClerkFixture,
} from '@/test-utils/auth-migration-fixtures'

const NOW = new Date('2026-10-20T08:00:00Z')

function bundle() {
  const fx = loadClerkFixture()
  return buildBundle({
    apiUsers: fx.apiUsers,
    clerkTotalCount: fx.apiUsers.length,
    csv: parseClerkCsv(fx.csvText),
    exportedAt: NOW,
  })
}

/** Apply a plan to in-memory "tables" the way the repository does. */
function applyInMemory(
  plans: UserPlan[],
  users: ExistingAuthUser[],
  accounts: ExistingAuthAccount[],
  at: Date
) {
  for (const p of plans) {
    if (p.create) {
      const {
        id,
        email,
        emailVerified,
        name,
        firstName,
        lastName,
        image,
        banned,
      } = p.create
      users.push({
        id,
        email,
        emailVerified,
        name,
        firstName,
        lastName,
        image,
        banned,
      })
    } else if (p.update) {
      const u = users.find(x => x.id === p.id)!
      Object.assign(u, p.update)
    }
    for (const a of p.accounts) {
      if (a.action === 'create') {
        accounts.push({ ...a, updatedAt: at })
      } else {
        const row = accounts.find(x => x.id === a.id)!
        if (a.scope !== undefined) row.scope = a.scope
        if (a.password !== undefined) row.password = a.password
        row.updatedAt = at
      }
    }
  }
}

const byId = (plans: UserPlan[], id: string) => plans.find(p => p.id === id)!

describe('LUM-1072 import plan', () => {
  it('full import: maps users and accounts, skips no-email and case-conflicting emails', () => {
    const b = bundle()
    const plan = planImport({
      users: b.users,
      existingUsers: [],
      existingAccounts: [],
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    const ada = byId(plan.users, FIXTURE_IDS.pwOnly)
    expect(ada.action).toBe('create')
    expect(ada.create).toMatchObject({
      id: FIXTURE_IDS.pwOnly,
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      image: 'https://img.clerk.com/fake-avatar-1',
      banned: false,
      role: 'user',
      createdAt: new Date(1760000001000),
    })
    expect(ada.accounts).toEqual([
      expect.objectContaining({
        action: 'create',
        id: credentialAccountId(FIXTURE_IDS.pwOnly),
        providerId: 'credential',
        accountId: FIXTURE_IDS.pwOnly,
        password: expect.stringMatching(/^\$2a\$/),
      }),
    ])
    const mary = byId(plan.users, FIXTURE_IDS.pwAndGh)
    expect(
      mary.accounts.map(a => a.action === 'create' && a.providerId)
    ).toEqual(['credential', 'github'])
    expect(mary.accounts[1]).toMatchObject({
      id: socialAccountRowId(FIXTURE_IDS.pwAndGh, 'github', '1000004'),
      accountId: '1000004',
      scope: 'read:user user:email',
      password: null,
    })
    expect(byId(plan.users, FIXTURE_IDS.unverified).create).toMatchObject({
      email: 'kat@example.com',
      emailVerified: false,
    })
    expect(byId(plan.users, FIXTURE_IDS.banned).create!.banned).toBe(true)
    // argon2 digest: user imported without a credential account.
    expect(byId(plan.users, FIXTURE_IDS.argon).accounts).toEqual([])
    expect(byId(plan.users, FIXTURE_IDS.noEmail)).toMatchObject({
      action: 'skip',
      skipReason: 'no_email',
    })
    expect(byId(plan.users, FIXTURE_IDS.caseA).skipReason).toBe(
      'email_case_conflict'
    )
    expect(byId(plan.users, FIXTURE_IDS.caseB).skipReason).toBe(
      'email_case_conflict'
    )
  })

  it('a second full run plans nothing but unchanged; a changed Clerk field becomes an update', () => {
    const b = bundle()
    const users: ExistingAuthUser[] = []
    const accounts: ExistingAuthAccount[] = []
    const first = planImport({
      users: b.users,
      existingUsers: users,
      existingAccounts: accounts,
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    applyInMemory(first.users, users, accounts, NOW)
    const second = planImport({
      users: b.users,
      existingUsers: users,
      existingAccounts: accounts,
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    expect(new Set(second.users.map(p => p.action))).toEqual(
      new Set(['unchanged', 'skip'])
    )

    // Re-hosted avatar is never overwritten by the Clerk URL.
    users.find(u => u.id === FIXTURE_IDS.pwOnly)!.image =
      'https://blob.example.com/avatars/a.png'
    const changed = b.users.map(u =>
      u.id === FIXTURE_IDS.ghOnly
        ? { ...u, lastName: 'Hopper-Murray', banned: true }
        : u
    )
    const third = planImport({
      users: changed,
      existingUsers: users,
      existingAccounts: accounts,
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    expect(byId(third.users, FIXTURE_IDS.pwOnly).action).toBe('unchanged')
    expect(byId(third.users, FIXTURE_IDS.ghOnly)).toMatchObject({
      action: 'update',
      update: {
        lastName: 'Hopper-Murray',
        name: 'Grace Hopper-Murray',
        banned: true,
      },
    })
  })

  it('an email already owned by another Better Auth user is skipped; a social identity linked elsewhere is a conflict', () => {
    const b = bundle()
    const plan = planImport({
      users: b.users,
      existingUsers: [
        {
          id: 'user_baNew',
          email: 'ada@example.com',
          emailVerified: true,
          name: 'X',
          firstName: null,
          lastName: null,
          image: null,
          banned: false,
        },
      ],
      existingAccounts: [
        {
          id: 'acc1',
          userId: 'user_baNew',
          providerId: 'github',
          accountId: '1000002',
          scope: null,
          password: null,
          updatedAt: NOW,
        },
      ],
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    expect(byId(plan.users, FIXTURE_IDS.pwOnly)).toMatchObject({
      action: 'skip',
      skipReason: 'email_taken',
    })
    expect(byId(plan.users, FIXTURE_IDS.ghOnly).accounts).toEqual([])
    expect(plan.counters.socialConflicts).toBe(1)
  })

  it('closing: inserts missing users only; overwrites a password only if Better Auth did not change it after T_import', () => {
    const b = bundle()
    const users: ExistingAuthUser[] = []
    const accounts: ExistingAuthAccount[] = []
    const tImport = new Date('2026-10-20T09:00:00Z')
    // Full import of everyone except Kat (who "signs up in the gap").
    const first = planImport({
      users: b.users.filter(u => u.id !== FIXTURE_IDS.unverified),
      existingUsers: users,
      existingAccounts: accounts,
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    applyInMemory(
      first.users,
      users,
      accounts,
      new Date('2026-10-20T08:30:00Z')
    )
    // After T_import: Ada changes her password in Better Auth.
    accounts.find(
      a => a.id === credentialAccountId(FIXTURE_IDS.pwOnly)
    )!.updatedAt = new Date('2026-10-20T10:00:00Z')

    // Closing export: everyone changed their Clerk password and Grace renamed.
    const closingUsers = b.users.map(u => ({
      ...u,
      lastName: u.id === FIXTURE_IDS.ghOnly ? 'Renamed' : u.lastName,
      password: u.password?.digest?.startsWith('$2a$')
        ? {
            hasher: 'bcrypt',
            digest: u.password.digest.replace(/.$/, c =>
              c === 'A' ? 'B' : 'A'
            ),
          }
        : u.password,
    }))
    const plan = planImport({
      users: closingUsers,
      existingUsers: users,
      existingAccounts: accounts,
      mode: 'closing',
      since: tImport,
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    expect(byId(plan.users, FIXTURE_IDS.unverified).action).toBe('create')
    // Ada: changed in BA after T_import → kept.
    expect(byId(plan.users, FIXTURE_IDS.pwOnly)).toMatchObject({
      action: 'keep',
      accounts: [],
    })
    expect(plan.counters.credentialChangedInBetterAuth).toBe(1)
    // Mary: untouched in BA → password overwritten, nothing else.
    const mary = byId(plan.users, FIXTURE_IDS.pwAndGh)
    expect(mary.action).toBe('keep')
    expect(mary.update).toBeUndefined()
    expect(mary.accounts).toEqual([
      {
        action: 'update',
        id: credentialAccountId(FIXTURE_IDS.pwAndGh),
        password: expect.any(String),
      },
    ])
    // Grace's rename is not applied in closing mode.
    expect(byId(plan.users, FIXTURE_IDS.ghOnly)).toMatchObject({
      action: 'keep',
      accounts: [],
    })
    expect(() =>
      planImport({
        users: [],
        existingUsers: [],
        existingAccounts: [],
        mode: 'closing',
        now: NOW,
        nameFields: nameFieldsForCreate,
      })
    ).toThrow(/--since/)
  })

  it('summarizePlan counts without any personal data', () => {
    const b = bundle()
    const plan = planImport({
      users: b.users,
      existingUsers: [],
      existingAccounts: [],
      mode: 'full',
      now: NOW,
      nameFields: nameFieldsForCreate,
    })
    const s = summarizePlan(b.users, plan)
    expect(s).toMatchObject({
      total: 11,
      actions: { create: 8, update: 0, unchanged: 0, keep: 0, skip: 3 },
      skipped: { no_email: 1, email_case_conflict: 2, email_taken: 0 },
      skippedIdPrefixes: { user_: 3 },
      primaryEmailUnverified: 1,
      multipleVerifiedEmails: 1,
      passwordHashers: { bcrypt: 5, argon2id: 1, '(no password)': 5 },
      passwordEnabledWithoutBcrypt: 1,
      providers: { github: 2, google: 1 },
      banned: 1,
      locked: 1,
      mfaEnabled: 1,
      usernameOnly: 1,
      clerkAvatars: 2,
      credentialWrites: 5,
      socialWrites: 3,
    })
    const text = JSON.stringify(s)
    expect(text).not.toMatch(/@|example\.com|\$2a\$|Ada|user_2/)
  })

  it('isClerkImageUrl only accepts https Clerk image hosts', () => {
    expect(isClerkImageUrl('https://img.clerk.com/abc')).toBe(true)
    expect(isClerkImageUrl('https://images.clerk.dev/x')).toBe(true)
    expect(isClerkImageUrl('http://img.clerk.com/abc')).toBe(false)
    expect(isClerkImageUrl('https://img.clerk.com.evil.test/abc')).toBe(false)
    expect(isClerkImageUrl(null)).toBe(false)
    expect(isClerkImageUrl('not a url')).toBe(false)
  })
})
