/**
 * @jest-environment node
 */
import * as format from '@/cli/src/lib/format'
import { formatDuration } from '@/cli/src/lib/format'

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

describe('relative time is retired (LUM-1232, absolute time only)', () => {
  it('format.ts no longer exports relativeTime', () => {
    expect('relativeTime' in format).toBe(false)
  })
})
