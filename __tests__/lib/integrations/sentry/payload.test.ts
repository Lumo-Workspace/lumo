import {
  extractIssueFields,
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
} from '@/lib/integrations/sentry/payload'
import type { SentryIssueAlertPayload } from '@/lib/integrations/sentry/types'
import alertFixture from '@/__tests__/fixtures/sentry-issue-alert.json'

function makePayload(
  overrides: Partial<SentryIssueAlertPayload['data']['event']> = {}
): SentryIssueAlertPayload {
  return {
    action: 'triggered',
    data: {
      event: {
        project_slug: 'frontend',
        issue_id: '42',
        title: 't',
        level: 'error',
        web_url: 'https://example.com',
        ...overrides,
      },
    },
  }
}

describe('mapLevelToPriority', () => {
  it('maps fatal → URGENT', () => {
    expect(mapLevelToPriority('fatal')).toBe('URGENT')
  })
  it('maps error → HIGH', () => {
    expect(mapLevelToPriority('error')).toBe('HIGH')
  })
  it('maps warning → MEDIUM', () => {
    expect(mapLevelToPriority('warning')).toBe('MEDIUM')
  })
  it('maps info → LOW', () => {
    expect(mapLevelToPriority('info')).toBe('LOW')
  })
  it('maps debug → LOW', () => {
    expect(mapLevelToPriority('debug')).toBe('LOW')
  })
  it('maps unknown → LOW', () => {
    expect(mapLevelToPriority('something-new')).toBe('LOW')
  })
  it('maps undefined → LOW', () => {
    expect(mapLevelToPriority(undefined)).toBe('LOW')
  })
})

describe('pickSuggestedOwnerEmails', () => {
  it('returns user emails in order', () => {
    const payload = makePayload({
      suggestedOwners: [
        { owner: { type: 'user', email: 'a@example.com' } },
        { owner: { type: 'team', email: 'team@example.com' } },
        { owner: { type: 'user', email: 'b@example.com' } },
      ],
    })
    expect(pickSuggestedOwnerEmails(payload)).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('falls back to actor.email when suggestedOwners is missing', () => {
    const payload: SentryIssueAlertPayload = {
      action: 'triggered',
      actor: { type: 'user', email: 'fallback@example.com' },
      data: {
        event: {
          project_slug: 'frontend',
          issue_id: '42',
          title: 't',
          level: 'error',
          web_url: 'https://example.com',
        },
      },
    }
    expect(pickSuggestedOwnerEmails(payload)).toEqual(['fallback@example.com'])
  })

  it('returns empty array when no owners and no actor email', () => {
    expect(pickSuggestedOwnerEmails(makePayload())).toEqual([])
  })

  it('skips owners with no email', () => {
    const payload = makePayload({
      suggestedOwners: [
        { owner: { type: 'user' } },
        { owner: { type: 'user', email: 'c@example.com' } },
      ],
    })
    expect(pickSuggestedOwnerEmails(payload)).toEqual(['c@example.com'])
  })
})

describe('extractIssueFields', () => {
  const fixture = alertFixture as unknown as SentryIssueAlertPayload

  it('extracts fields from the happy-path fixture', () => {
    const fields = extractIssueFields(fixture)
    expect(fields).toMatchObject({
      sentryIssueId: '4555555555',
      sentryProjectSlug: 'frontend',
      title: "TypeError: Cannot read properties of undefined (reading 'map')",
      culprit: 'renderDashboard(app/dashboard/page.tsx)',
      level: 'error',
      webUrl: 'https://acme-inc.sentry.io/issues/4555555555/',
      triggeredRule: 'High-priority JS errors',
    })
    expect(fields.stackFrames.length).toBeGreaterThan(0)
  })

  it('returns null for missing optional fields', () => {
    const minimal: SentryIssueAlertPayload = {
      action: 'triggered',
      data: {
        event: {
          project_slug: 'x',
          issue_id: '1',
          title: 'Err',
          web_url: 'https://example.com/issues/1',
        },
      },
    }
    const fields = extractIssueFields(minimal)
    expect(fields.culprit).toBeNull()
    expect(fields.triggeredRule).toBeNull()
    expect(fields.stackFrames).toEqual([])
    expect(fields.level).toBe('info') // default
  })

  it('truncates title to 200 chars', () => {
    const long = 'x'.repeat(500)
    const fields = extractIssueFields({
      action: 't',
      data: {
        event: {
          project_slug: 'x',
          issue_id: '1',
          title: long,
          web_url: 'https://example.com',
        },
      },
    } as SentryIssueAlertPayload)
    expect(fields.title).toHaveLength(200)
  })

  it('throws when sentryIssueId is absent', () => {
    expect(() =>
      extractIssueFields({
        action: 't',
        data: {
          event: {
            project_slug: 'x',
            title: 't',
            web_url: 'https://example.com',
          },
        },
      } as SentryIssueAlertPayload)
    ).toThrow(/issue_id/)
  })

  it('throws when sentryProjectSlug is absent', () => {
    expect(() =>
      extractIssueFields({
        action: 't',
        data: {
          event: {
            issue_id: '1',
            title: 't',
            web_url: 'https://example.com',
          },
        },
      } as SentryIssueAlertPayload)
    ).toThrow(/project_slug/)
  })
})
