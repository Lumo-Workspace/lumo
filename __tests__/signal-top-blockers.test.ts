import { collectTopBlockers, DEFAULT_RISK_CONFIG } from '@/lib/summaries/risk'

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
          dueDate: null,
          updatedAt: daysAgo(9),
        },
      ],
      agents: [],
      prs: [
        { number: 16, state: 'open', createdAt: daysAgo(6) },
        // Inside the stale window — must not appear.
        { number: 900, state: 'open', createdAt: daysAgo(1) },
      ],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })

    // The IDLE column is derived from this timestamp, so it has to survive the
    // trip out of collectTopBlockers rather than being dropped in the mapping.
    expect(result.stalledTaskIds).toEqual([
      {
        id: 't1',
        identifier: 'LUM-550',
        title: 'PR: project detail overview',
        updatedAt: daysAgo(9).toISOString(),
      },
    ])

    expect(result.staleOpenPrs).toEqual([
      { number: 16, openedAt: daysAgo(6).toISOString() },
    ])
  })

  it('keeps staleOpenPrNumbers as bare numbers for published CLI versions', () => {
    const result = collectTopBlockers({
      tasks: [],
      agents: [],
      prs: [
        { number: 16, state: 'open', createdAt: daysAgo(6) },
        { number: 111, state: 'open', createdAt: daysAgo(5) },
      ],
      now: NOW,
      config: DEFAULT_RISK_CONFIG,
    })

    // `lumo sprint show` renders this list directly as `#16, #111`; turning it
    // into objects would print `#[object Object]` on already-shipped CLIs.
    expect(result.staleOpenPrNumbers).toEqual([16, 111])
    expect(result.staleOpenPrs.map(p => p.number)).toEqual([16, 111])
  })
})
