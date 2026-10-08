import { formatTimestamp } from '@/lib/utils/formatTimestamp'

describe('formatTimestamp', () => {
  // formatTimestamp buckets by the viewer's LOCAL calendar day, so every
  // fixture is built from local date parts. A fixed UTC instant made the
  // Today/Yesterday cases fail in far-off zones (UTC+14, UTC-11).
  const NOW = new Date(2026, 3, 16, 14, 0, 0) // 16 Apr 2026, 14:00 local

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('returns "just now" when less than 60 seconds ago', () => {
    const d = new Date(NOW.getTime() - 30_000)
    expect(formatTimestamp(d)).toBe('just now')
  })

  it('returns "Nm ago" between 1 and 59 minutes ago', () => {
    const d = new Date(NOW.getTime() - 23 * 60_000)
    expect(formatTimestamp(d)).toBe('23m ago')
  })

  it('returns "Today HH:MM AM/PM" earlier the same day', () => {
    const d = new Date(2026, 3, 16, 8, 0, 0) // 08:00 local, same day
    const result = formatTimestamp(d, 'en-US')
    expect(result.startsWith('Today ')).toBe(true)
  })

  it('returns "Yesterday" for the prior day', () => {
    const d = new Date(2026, 3, 15, 8, 0, 0) // 08:00 local, prior day
    expect(formatTimestamp(d)).toBe('Yesterday')
  })

  it('returns "Mon DD" for older dates in the same year', () => {
    const d = new Date(2026, 1, 1, 12, 0, 0)
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+$/)
  })

  it('returns "Mon DD, YYYY" for older dates in prior years', () => {
    const d = new Date(2024, 1, 1, 12, 0, 0)
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+, 2024$/)
  })

  it('accepts custom i18n messages', () => {
    const d = new Date(NOW.getTime() - 10_000)
    expect(formatTimestamp(d, 'en-US', { justNow: '刚刚' })).toBe('刚刚')
  })
})
