import {
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
} from '@/lib/integrations/sentry/payload'
import type { SentryIssueAlertPayload } from '@/lib/integrations/sentry/types'

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
