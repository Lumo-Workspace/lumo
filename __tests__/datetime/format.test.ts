import { formatCalendarDate } from '@/lib/datetime/format'

test('renders the UTC calendar day regardless of machine timezone', () => {
  // 2026-07-06T05:00:00Z is Jul 6 in UTC (and Jul 5 in America/Los_Angeles) —
  // pinned to UTC it must always be Jul 6.
  const d = '2026-07-06T05:00:00Z'
  expect(formatCalendarDate(d, 'en')).toBe('Jul 6, 2026')
})

test('a UTC-midnight instant shows that same UTC day', () => {
  expect(formatCalendarDate('2026-06-01T00:00:00Z', 'en')).toBe('Jun 1, 2026')
})
