/**
 * @jest-environment node
 */
import { sanitizeField } from '@/cli/src/lib/sanitize'

describe('sanitizeField', () => {
  it('strips the ESC character (ANSI injection vector)', () => {
    expect(sanitizeField('hi\x1b[31mRED\x1b[0m')).toBe('hi[31mRED[0m')
  })

  it('strips NUL, BEL, backspace, and DEL', () => {
    expect(sanitizeField('a\x00b\x07c\x08d\x7fe')).toBe('abcde')
  })

  it('keeps tab and newline so tables and multi-line bodies survive', () => {
    expect(sanitizeField('a\tb\nc')).toBe('a\tb\nc')
  })

  it('returns ordinary text unchanged', () => {
    expect(sanitizeField('Fix Slack OAuth redirect — 修复')).toBe(
      'Fix Slack OAuth redirect — 修复'
    )
  })

  it('returns an empty string unchanged', () => {
    expect(sanitizeField('')).toBe('')
  })
})
