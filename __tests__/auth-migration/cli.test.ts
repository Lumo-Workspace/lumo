/**
 * @jest-environment node
 *
 * LUM-1072 — scripts/auth-migration argument rules and report formatting.
 */
import {
  formatAvatars,
  formatRekeyPlan,
  parseMigrationArgs,
  usage,
} from '../../scripts/auth-migration/cli'
import { parseRekeyMap } from '@/lib/services/auth-migration.service'

describe('LUM-1072 auth-migration CLI', () => {
  it('import is a dry run unless --confirm; --closing needs --since and vice versa', () => {
    expect(parseMigrationArgs('import', ['--in', '/x/b.enc'])).toMatchObject({
      in: '/x/b.enc',
      confirm: false,
      closing: false,
      since: null,
    })
    const closing = parseMigrationArgs('import', [
      '--in',
      '/x/b.enc',
      '--closing',
      '--since',
      '2026-10-20T08:00:00.000Z',
      '--confirm',
    ])
    expect(closing).toMatchObject({ closing: true, confirm: true })
    expect(closing.since!.toISOString()).toBe('2026-10-20T08:00:00.000Z')
    expect(() =>
      parseMigrationArgs('import', ['--in', 'b', '--closing'])
    ).toThrow(/go together/)
    expect(() =>
      parseMigrationArgs('import', [
        '--in',
        'b',
        '--since',
        '2026-10-20T08:00:00Z',
      ])
    ).toThrow(/go together/)
    expect(() =>
      parseMigrationArgs('import', [
        '--in',
        'b',
        '--closing',
        '--since',
        'yesterday',
      ])
    ).toThrow(/ISO timestamp/)
  })

  it('rejects missing and foreign flags per command', () => {
    expect(() => parseMigrationArgs('export', [])).toThrow(/--out is required/)
    expect(() =>
      parseMigrationArgs('verify', ['--in', 'b', '--confirm'])
    ).toThrow(/--confirm is not valid for verify/)
    expect(() => parseMigrationArgs('seal', ['--in', 'a'])).toThrow(
      /--in and --out/
    )
    expect(() => parseMigrationArgs('avatars', ['--bogus'])).toThrow(
      /Unknown option/
    )
    expect(() => parseMigrationArgs('rekey', [])).toThrow(/either --map/)
    expect(() =>
      parseMigrationArgs('rekey', [
        '--map',
        'm',
        '--window-since',
        '2026-10-20T08:00:00Z',
        '--window-out',
        'w',
      ])
    ).toThrow(/either --map/)
    expect(
      parseMigrationArgs('rekey', [
        '--window-since',
        '2026-10-20T08:00:00Z',
        '--window-out',
        'w',
      ]).windowOut
    ).toBe('w')
    expect(usage('rekey')).toContain('scripts/auth-migration/rekey.ts')
  })

  it('parseRekeyMap refuses non-user ids, self maps, duplicates and chains', () => {
    expect(parseRekeyMap({ user_a1: 'user_b1' })).toEqual(
      new Map([['user_a1', 'user_b1']])
    )
    expect(() => parseRekeyMap([])).toThrow(/JSON object/)
    expect(() => parseRekeyMap({})).toThrow(/empty/)
    expect(() => parseRekeyMap({ user_a: 'ws_1' })).toThrow(/user_… id/)
    expect(() => parseRekeyMap({ user_a: 'user_a' })).toThrow(/itself/)
    expect(() => parseRekeyMap({ user_a: 'user_c', user_b: 'user_c' })).toThrow(
      /same new id/
    )
    expect(() => parseRekeyMap({ user_a: 'user_b', user_b: 'user_c' })).toThrow(
      /chained/
    )
  })

  it('report formatters print counts only', () => {
    expect(
      formatRekeyPlan({
        entries: 1,
        references: { 'WorkspaceMember.clerkId': 2 },
        targetCollisions: 0,
      })
    ).toEqual([
      'entries: 1',
      'rows referencing the old ids: WorkspaceMember.clerkId=2',
      'rows already referencing a new id: 0',
    ])
    expect(
      formatAvatars(
        {
          candidates: 3,
          transferred: 1,
          failed: 2,
          raced: 0,
          failedReasons: { http_404: 2 },
          failedIdPrefixes: { user_: 2 },
        },
        true
      )
    ).toEqual([
      'avatars still on Clerk hosts: 3',
      'transferred: 1; failed: 2 (http_404=2); changed meanwhile (left alone): 0',
      'failed id prefixes: user_=2',
    ])
  })
})
