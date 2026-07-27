import {
  formatCalendarDate,
  formatCalendarDayShort,
} from '@/lib/datetime/format'

test('renders the UTC calendar day regardless of machine timezone', () => {
  // 2026-07-06T05:00:00Z is Jul 6 in UTC (and Jul 5 in America/Los_Angeles) —
  // pinned to UTC it must always be Jul 6.
  const d = '2026-07-06T05:00:00Z'
  expect(formatCalendarDate(d, 'en')).toBe('Jul 6, 2026')
})

test('a UTC-midnight instant shows that same UTC day', () => {
  expect(formatCalendarDate('2026-06-01T00:00:00Z', 'en')).toBe('Jun 1, 2026')
})

// The year-less variant carries the same UTC pin. Two instants, one on each
// side of UTC midnight, so the assertion bites whichever way the machine
// running the suite is offset: T16:00Z is already the next day for a machine
// east of UTC, T04:00Z is still the previous day for one west of it. Drop the
// `timeZone: 'UTC'` and at least one of these fails on any non-UTC machine.
test('formatCalendarDayShort pins the UTC day, east and west', () => {
  expect(formatCalendarDayShort('2026-07-25T16:00:00Z', 'en')).toBe('Jul 25')
  expect(formatCalendarDayShort('2026-07-25T04:00:00Z', 'en')).toBe('Jul 25')
})

test('formatCalendarDayShort omits the year', () => {
  expect(formatCalendarDayShort('2026-06-01T00:00:00Z', 'en')).toBe('Jun 1')
})
