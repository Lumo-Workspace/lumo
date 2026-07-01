jest.mock('react-intl', () => ({
  useIntl: () => ({
    locale: 'en',
    formatMessage: ({ id }: { id: string }) => id,
  }),
}))

jest.mock('@/app/workspace/[workspaceUrl]/hooks/useSprints', () => ({
  useSprint: () => ({ progress: undefined }),
}))

import { monthTicks } from '@/app/workspace/[workspaceUrl]/sprints/components/SprintTimeline'

describe('monthTicks', () => {
  it('honors the timeZone argument for the month label', () => {
    // Domain spans local-midnight Jun 1 – Jun 2, 2026. The first tick is
    // built from a local-midnight `Date` for the 1st; Pacific/Midway
    // (UTC-11) and Pacific/Kiritimati (UTC+14) are far enough apart (25h)
    // that local midnight on the 1st falls in different calendar months in
    // the two zones, regardless of which zone the test runner's process is
    // in.
    const domain = {
      min: new Date(2026, 5, 1).getTime(),
      max: new Date(2026, 5, 2).getTime(),
    }

    const midway = monthTicks(domain, 'en', 'Pacific/Midway')
    const kiritimati = monthTicks(domain, 'en', 'Pacific/Kiritimati')

    expect(midway[0]?.label).toBe('May')
    expect(kiritimati[0]?.label).toBe('Jun')
  })

  it('falls back to the runtime local zone when timeZone is omitted', () => {
    const domain = {
      min: new Date(2026, 5, 1).getTime(),
      max: new Date(2026, 5, 2).getTime(),
    }

    expect(monthTicks(domain, 'en')).toEqual(
      monthTicks(domain, 'en', undefined)
    )
  })
})
