/**
 * @jest-environment node
 */
import { formatDuration, relativeTime } from '@/cli/src/lib/format'

describe('formatDuration', () => {
  it('floors sub-minute at 1s and rounds seconds', () => {
    expect(formatDuration(500)).toBe('1s')
    expect(formatDuration(45_000)).toBe('45s')
  })
  it('renders minutes under an hour', () => {
    expect(formatDuration(23 * 60_000)).toBe('23m')
  })
  it('renders hours and h+min', () => {
    expect(formatDuration(60 * 60_000)).toBe('1h')
    expect(formatDuration(90 * 60_000)).toBe('1h 30m')
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  it('just now under a minute', () => {
    expect(relativeTime(new Date('2026-06-01T11:59:30Z'), now)).toBe('just now')
  })
  it('minutes / hours / days', () => {
    expect(relativeTime(new Date('2026-06-01T11:30:00Z'), now)).toBe('30m ago')
    expect(relativeTime(new Date('2026-06-01T10:00:00Z'), now)).toBe('2h ago')
    expect(relativeTime(new Date('2026-05-30T12:00:00Z'), now)).toBe(
      '2 days ago'
    )
    expect(relativeTime(new Date('2026-05-31T12:00:00Z'), now)).toBe(
      'yesterday'
    )
  })
})
