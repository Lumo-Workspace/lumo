import { collectTopBlockers } from '@/lib/summaries/top-blockers'

const NOW = new Date('2026-07-24T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

describe('top blockers — Signal tab timestamps', () => {
  it('carries updatedAt on stalled tasks and openedAt on stale PRs', () => {
    const result = collectTopBlockers({
      tasks: [
        {
          id: 't1',
          identifier: 'LUM-550',
          title: 'PR: project detail overview',
          status: 'IN_PROGRESS',
          priority: 'MEDIUM',
          dueDate: null,
          updatedAt: daysAgo(9),
        },
      ],
      agents: [],
      prs: [
        {
          number: 16,
          state: 'open',
          createdAt: daysAgo(6),
          url: 'https://github.com/o/r/pull/16',
        },
        // Inside the stale window — must not appear.
        {
          number: 900,
          state: 'open',
          createdAt: daysAgo(1),
          url: 'https://github.com/o/r/pull/900',
        },
      ],
      now: NOW,
    })

    // The IDLE column is derived from this timestamp, so it has to survive the
    // trip out of collectTopBlockers rather than being dropped in the mapping.
    expect(result.stalledTaskIds).toEqual([
      {
        id: 't1',
        identifier: 'LUM-550',
        title: 'PR: project detail overview',
        priority: 'MEDIUM',
        updatedAt: daysAgo(9).toISOString(),
      },
    ])

    expect(result.staleOpenPrs).toEqual([
      {
        number: 16,
        openedAt: daysAgo(6).toISOString(),
        url: 'https://github.com/o/r/pull/16',
      },
    ])
  })

  it('keeps staleOpenPrNumbers as bare numbers for published CLI versions', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [
        {
          number: 16,
          state: 'open',
          createdAt: daysAgo(6),
          url: 'https://github.com/o/r/pull/16',
        },
        {
          number: 111,
          state: 'open',
          createdAt: daysAgo(5),
          url: 'https://github.com/o/r/pull/111',
        },
      ],
      now: NOW,
    })

    // `lumo sprint show` renders this list directly as `#16, #111`; turning it
    // into objects would print `#[object Object]` on already-shipped CLIs.
    expect(result.staleOpenPrNumbers).toEqual([16, 111])
    expect(result.staleOpenPrs.map(p => p.number)).toEqual([16, 111])
  })
})
