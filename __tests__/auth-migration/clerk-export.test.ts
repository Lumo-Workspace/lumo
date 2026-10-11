/**
 * @jest-environment node
 *
 * LUM-1072 — Clerk export normalisation: CSV parsing, API → MigrationUser,
 * bundle join and shape check.
 */
import {
  buildBundle,
  idPrefixStats,
  isImportableBcrypt,
  parseBundle,
  parseClerkCsv,
  parseCsv,
  toMigrationUser,
  toProviderId,
} from '@/lib/auth-migration/clerk-export'
import {
  FIXTURE_IDS,
  loadClerkFixture,
} from '@/test-utils/auth-migration-fixtures'

describe('LUM-1072 clerk export', () => {
  const fx = loadClerkFixture()

  it('parseCsv handles quotes, escaped quotes, embedded commas, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ])
    expect(() => parseCsv('a,"open')).toThrow(/unterminated/)
  })

  it('parseClerkCsv reads id, hasher, digest and totp presence from the Dashboard CSV', () => {
    const rows = parseClerkCsv(fx.csvText)
    expect(rows.size).toBe(11)
    const ada = rows.get(FIXTURE_IDS.pwOnly)!
    expect(ada.hasher).toBe('bcrypt')
    expect(ada.digest).toMatch(/^\$2a\$04\$/)
    expect(rows.get(FIXTURE_IDS.ghOnly)).toEqual({
      hasher: null,
      digest: null,
      hasTotp: false,
    })
    expect(rows.get(FIXTURE_IDS.mfa)!.hasTotp).toBe(true)
    // The quoted multi-value cell did not shift Mary's columns.
    expect(rows.get(FIXTURE_IDS.pwAndGh)!.hasher).toBe('bcrypt')
    expect(() => parseClerkCsv('id,first_name\nuser_1,A\n')).toThrow(
      /password_digest/
    )
  })

  it('isImportableBcrypt accepts only bcrypt-labelled $2a/$2b/$2y digests', () => {
    const d = '$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234'
    expect(isImportableBcrypt({ hasher: 'bcrypt', digest: d })).toBe(true)
    expect(
      isImportableBcrypt({ hasher: 'BCRYPT', digest: d.replace('2a', '2y') })
    ).toBe(true)
    expect(isImportableBcrypt({ hasher: 'argon2id', digest: d })).toBe(false)
    expect(
      isImportableBcrypt({ hasher: 'bcrypt', digest: '$argon2id$x' })
    ).toBe(false)
    expect(isImportableBcrypt({ hasher: 'bcrypt', digest: null })).toBe(false)
    expect(isImportableBcrypt(null)).toBe(false)
  })

  it('toMigrationUser maps primary email, verification, providers, avatar and flags', () => {
    const byId = new Map(fx.apiUsers.map(u => [u.id, u]))
    const csv = parseClerkCsv(fx.csvText)
    const mary = toMigrationUser(
      byId.get(FIXTURE_IDS.pwAndGh)!,
      csv.get(FIXTURE_IDS.pwAndGh)
    )
    expect(mary.primaryEmail).toBe('mary@example.com')
    expect(mary.primaryEmailVerified).toBe(true)
    expect(mary.otherVerifiedEmails).toEqual(['mary.work@example.com'])
    expect(mary.externalAccounts).toEqual([
      {
        providerId: 'github',
        accountId: '1000004',
        scope: 'read:user user:email',
      },
    ])
    expect(mary.imageUrl).toBeNull() // has_image false → Clerk default, not imported
    const ada = toMigrationUser(
      byId.get(FIXTURE_IDS.pwOnly)!,
      csv.get(FIXTURE_IDS.pwOnly)
    )
    expect(ada.imageUrl).toBe('https://img.clerk.com/fake-avatar-1')
    const kat = toMigrationUser(byId.get(FIXTURE_IDS.unverified)!, undefined)
    expect(kat.primaryEmailVerified).toBe(false)
    expect(kat.password).toBeNull()
    const mfa = toMigrationUser(
      byId.get(FIXTURE_IDS.mfa)!,
      csv.get(FIXTURE_IDS.mfa)
    )
    expect(mfa).toMatchObject({ mfaEnabled: true, locked: true })
    expect(
      toMigrationUser(byId.get(FIXTURE_IDS.noEmail)!, undefined).primaryEmail
    ).toBeNull()
    expect(toProviderId('oauth_google')).toBe('google')
  })

  it('buildBundle dedupes repeated API rows, counts CSV rows without an API user; parseBundle round-trips', () => {
    const csv = parseClerkCsv(
      fx.csvText + 'user_2goneFromApi,,,,x@example.com,,,,,,,,\n'
    )
    const bundle = buildBundle({
      apiUsers: [...fx.apiUsers, fx.apiUsers[0]!],
      clerkTotalCount: 11,
      csv,
      exportedAt: new Date('2026-10-20T00:00:00Z'),
    })
    expect(bundle.users).toHaveLength(11)
    expect(bundle.csvRowsWithoutApiUser).toBe(1)
    expect(parseBundle(JSON.stringify(bundle))).toEqual(bundle)
    expect(() => parseBundle('{"format":"other"}')).toThrow(/Not a Lumo/)
    expect(() => parseBundle('nope')).toThrow(/not valid JSON/)
  })

  it('idPrefixStats reports prefixes only', () => {
    expect(idPrefixStats(['user_a', 'user_b', 'oops', 'ws_1'])).toEqual({
      user_: 2,
      ws_: 1,
      '(no prefix)': 1,
    })
  })
})
