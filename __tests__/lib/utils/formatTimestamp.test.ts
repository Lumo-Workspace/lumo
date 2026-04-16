import { formatTimestamp } from '@/lib/utils/formatTimestamp'

describe('formatTimestamp', () => {
  const NOW = new Date('2026-04-16T14:00:00.000Z')

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
    const d = new Date(NOW.getTime() - 6 * 60 * 60 * 1000) // 6h ago
    const result = formatTimestamp(d, 'en-US')
    expect(result.startsWith('Today ')).toBe(true)
  })

  it('returns "Yesterday" for the prior day', () => {
    const d = new Date(NOW.getTime() - 30 * 60 * 60 * 1000) // 30h ago
    expect(formatTimestamp(d)).toBe('Yesterday')
  })

  it('returns "Mon DD" for older dates in the same year', () => {
    const d = new Date('2026-02-01T12:00:00.000Z')
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+$/)
  })

  it('returns "Mon DD, YYYY" for older dates in prior years', () => {
    const d = new Date('2024-02-01T12:00:00.000Z')
    expect(formatTimestamp(d, 'en-US')).toMatch(/^\w{3} \d+, 2024$/)
  })

  it('accepts custom i18n messages', () => {
    const d = new Date(NOW.getTime() - 10_000)
    expect(formatTimestamp(d, 'en-US', { justNow: '刚刚' })).toBe('刚刚')
  })
})
