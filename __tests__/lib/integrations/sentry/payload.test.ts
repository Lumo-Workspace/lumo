import {
  buildTaskDescription,
  extractIssueFields,
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
} from '@/lib/integrations/sentry/payload'
import type {
  ExtractedIssueFields,
  SentryIssueAlertPayload,
} from '@/lib/integrations/sentry/types'
import alertFixture from '@/__tests__/fixtures/sentry-issue-alert.json'

function fields(
  overrides: Partial<ExtractedIssueFields> = {}
): ExtractedIssueFields {
  return {
    sentryIssueId: '1',
    sentryProjectSlug: 'frontend',
    title: 'Boom',
    culprit: 'renderThing',
    level: 'error',
    reportedLevel: 'error',
    webUrl: 'https://example.com/issues/1',
    eventCount: 42,
    firstSeen: '2026-04-16T00:00:00.000Z',
    lastSeen: '2026-04-16T09:15:30.000Z',
    stackFrames: [
      { function: 'a', filename: 'a.ts', lineno: 1 },
      { function: 'b', filename: 'b.ts', lineno: 2 },
      { function: 'c', filename: 'c.ts', lineno: 3 },
    ],
    triggeredRule: null,
    ...overrides,
  }
}

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
  it('maps unknown → NONE', () => {
    expect(mapLevelToPriority('something-new')).toBe('NONE')
  })
  it('maps undefined / null / empty → NONE', () => {
    expect(mapLevelToPriority(undefined)).toBe('NONE')
    expect(mapLevelToPriority(null)).toBe('NONE')
    expect(mapLevelToPriority('')).toBe('NONE')
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
      reportedLevel: 'error',
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
    expect(fields.level).toBe('info') // display default
    expect(fields.reportedLevel).toBeNull()
    expect(mapLevelToPriority(fields.reportedLevel)).toBe('NONE')
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

describe('buildTaskDescription', () => {
  it('produces markdown with all sections', () => {
    const md = buildTaskDescription(fields())
    expect(md).toMatch(
      /\*\*Sentry issue:\*\* \[Boom\]\(https:\/\/example\.com\/issues\/1\)/
    )
    expect(md).toMatch(/\*\*Culprit:\*\* `renderThing`/)
    expect(md).toMatch(/\*\*Level:\*\* `error`/)
    expect(md).toMatch(/\*\*Events:\*\* 42/)
    expect(md).toContain('First seen: 2026-04-16T00:00:00.000Z')
    expect(md).toContain('Last seen: 2026-04-16T09:15:30.000Z')
    expect(md).toContain('at a (a.ts:1)')
    expect(md).toContain('at c (c.ts:3)')
    expect(md).toContain('_Created automatically from Sentry alert._')
  })

  it('omits stack block when there are no frames', () => {
    const md = buildTaskDescription(fields({ stackFrames: [] }))
    expect(md).not.toContain('**Stack')
    expect(md).not.toContain('```')
  })

  it('truncates to 5 frames, innermost first', () => {
    const manyFrames = Array.from({ length: 10 }, (_, i) => ({
      function: `fn${i}`,
      filename: 'x.ts',
      lineno: i,
    }))
    const md = buildTaskDescription(fields({ stackFrames: manyFrames }))
    // Sentry sends outermost-first; we reverse and take first 5.
    expect(md).toContain('at fn9 (x.ts:9)')
    expect(md).toContain('at fn5 (x.ts:5)')
    expect(md).not.toContain('at fn4 (x.ts:4)')
  })

  it('truncates stack lines longer than 200 chars', () => {
    const longFn = 'f'.repeat(500)
    const md = buildTaskDescription(
      fields({
        stackFrames: [{ function: longFn, filename: 'x.ts', lineno: 1 }],
      })
    )
    const stackLine = md.split('\n').find(l => l.includes('at '))!
    expect(stackLine.length).toBeLessThanOrEqual(200)
  })

  it('gracefully handles missing optional fields', () => {
    const md = buildTaskDescription(
      fields({
        culprit: null,
        eventCount: null,
        firstSeen: null,
        lastSeen: null,
      })
    )
    expect(md).not.toContain('**Culprit:**')
    expect(md).not.toContain('**Events:**')
    expect(md).not.toContain('First seen:')
  })
})
