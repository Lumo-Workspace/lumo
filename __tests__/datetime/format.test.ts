import { formatZonedDate } from '@/lib/datetime/format'

test('renders the wall-clock day in the given timezone', () => {
  // 2026-07-06T05:00:00Z is still 2026-07-05 in Los Angeles (22:00 PDT).
  const d = '2026-07-06T05:00:00Z'
  expect(
    formatZonedDate(d, { locale: 'en', timeZone: 'America/Los_Angeles' })
  ).toBe('Jul 5, 2026')
  expect(formatZonedDate(d, { locale: 'en', timeZone: 'Asia/Shanghai' })).toBe(
    'Jul 6, 2026'
  )
})

test('without timeZone, uses the runtime local zone (no crash)', () => {
  expect(typeof formatZonedDate('2026-07-06T12:00:00Z', { locale: 'en' })).toBe(
    'string'
  )
})
