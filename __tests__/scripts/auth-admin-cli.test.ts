/**
 * @jest-environment node
 *
 * LUM-1071 — scripts/auth-admin argument parsing and report formatting.
 */
import {
  banExpiresAt,
  describeDatabase,
  formatBanResult,
  formatPlan,
  formatRemoveResult,
  formatUnbanResult,
  parseAuthAdminArgs,
  REASON_MAX_CHARS,
} from '../../scripts/auth-admin/cli'

describe('LUM-1071 auth admin CLI', () => {
  it('auth admin args: dry run unless --confirm; exactly one target', () => {
    expect(parseAuthAdminArgs('ban', ['--user-id', 'user_1'])).toEqual({
      target: { userId: 'user_1', email: undefined },
      confirm: false,
      reason: null,
      expiresInDays: null,
    })
    expect(
      parseAuthAdminArgs('remove', ['--email', 'a@b.test', '--confirm'])
    ).toMatchObject({ target: { email: 'a@b.test' }, confirm: true })
    for (const argv of [
      [],
      ['--user-id', 'u', '--email', 'a@b.test'],
      ['user_1'],
      ['--user-id', 'u', '--force'],
    ]) {
      expect(() => parseAuthAdminArgs('ban', argv)).toThrow(/Usage:/)
    }
  })

  it('auth admin args: --reason and --expires-in-days only for ban, validated', () => {
    expect(
      parseAuthAdminArgs('ban', [
        '--user-id',
        'u',
        '--reason',
        ' spam ',
        '--expires-in-days',
        '7',
      ])
    ).toMatchObject({ reason: 'spam', expiresInDays: 7 })
    expect(() =>
      parseAuthAdminArgs('unban', ['--user-id', 'u', '--reason', 'x'])
    ).toThrow(/Usage:/)
    for (const days of ['0', '1.5', 'week']) {
      expect(() =>
        parseAuthAdminArgs('ban', ['--user-id', 'u', '--expires-in-days', days])
      ).toThrow(/positive integer/)
    }
    expect(() =>
      parseAuthAdminArgs('ban', ['--user-id', 'u', '--expires-in-days=-1'])
    ).toThrow(/positive integer/)
    expect(() =>
      parseAuthAdminArgs('ban', [
        '--user-id',
        'u',
        '--reason',
        'x'.repeat(REASON_MAX_CHARS + 1),
      ])
    ).toThrow(/--reason/)
  })

  it('auth admin banExpiresAt: null is permanent, n days later otherwise', () => {
    const now = new Date('2026-10-10T00:00:00Z')
    expect(banExpiresAt(null, now)).toBeNull()
    expect(banExpiresAt(2, now)?.toISOString()).toBe('2026-10-12T00:00:00.000Z')
  })

  it('auth admin describeDatabase prints host/db, never credentials', () => {
    expect(
      describeDatabase('postgresql://admin:s3cret@db.example.test:5432/lumo')
    ).toBe('db.example.test/lumo')
    expect(describeDatabase(undefined)).toBe('(DATABASE_URL not set)')
    expect(describeDatabase('not a url')).toBe('(unparseable DATABASE_URL)')
  })

  it('auth admin formatPlan reports ids and counts', () => {
    const plan = {
      userId: 'user_1',
      user: { id: 'user_1', role: 'user', banned: false, banExpires: null },
      sessions: 2,
      oauthTokens: 1,
      memberships: [
        {
          workspaceId: 'ws_a',
          memberId: 'm1',
          role: 'OWNER',
          action: 'keep_last_owner' as const,
        },
      ],
    }
    const ban = formatPlan('ban', plan, {
      reason: 'secret note',
      expiresInDays: 3,
    })
    expect(ban.join('\n')).toContain('[dry-run] ban user_1')
    expect(ban.join('\n')).toContain('reason=given, expires=in 3 day(s)')
    // The free-text reason may name people: never echoed.
    expect(ban.join('\n')).not.toContain('secret note')
    expect(ban.join('\n')).toContain(
      'workspace ws_a member m1 (OWNER): LAST OWNER'
    )
    const unban = formatPlan('unban', plan, {
      reason: null,
      expiresInDays: null,
    })
    expect(unban.join('\n')).toContain('memberships are NOT restored')
    expect(
      formatPlan(
        'remove',
        { ...plan, user: null, memberships: [] },
        {
          reason: null,
          expiresInDays: null,
        }
      )
    ).toEqual([
      '[dry-run] remove user_1',
      '  auth user: not found',
      '  memberships: 0',
    ])
  })

  it('auth admin result formatting', () => {
    expect(
      formatBanResult({
        userId: 'user_1',
        wasBanned: false,
        sessionsRevoked: 1,
        oauthTokensRevoked: 2,
        memberships: [
          {
            workspaceId: 'ws_a',
            memberId: 'm1',
            outcome: 'deactivated',
            apiKeysRevoked: 1,
          },
        ],
      })
    ).toEqual([
      'banned user_1',
      '  sessions revoked: 1, MCP OAuth tokens revoked: 2',
      '  memberships: 1',
      '    workspace ws_a member m1: deactivated, API keys revoked: 1',
    ])
    expect(formatUnbanResult({ userId: 'u', changed: false })).toEqual([
      'u was not banned; nothing changed',
    ])
    expect(
      formatRemoveResult({ userId: 'u', outcome: 'already_removed' })
    ).toEqual(['u was already removed; nothing changed'])
  })
})
