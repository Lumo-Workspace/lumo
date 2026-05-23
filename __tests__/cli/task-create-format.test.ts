/**
 * @jest-environment node
 */
import {
  formatCreatedTaskLine,
  normalizePriority,
} from '@/cli/src/commands/task-create'

describe('formatCreatedTaskLine', () => {
  it('renders identifier, quoted title, and URL on one line', () => {
    const line = formatCreatedTaskLine({
      id: 'task-1',
      identifier: 'LUM-44',
      title: 'Add OAuth login',
      url: 'https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44',
    })
    expect(line).toBe(
      'Created LUM-44 "Add OAuth login"  https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44'
    )
  })

  it('escapes embedded double-quotes in the title', () => {
    const line = formatCreatedTaskLine({
      id: 'task-2',
      identifier: 'LUM-45',
      title: 'Add "OAuth" login',
      url: 'https://x/y',
    })
    expect(line).toContain('"Add \\"OAuth\\" login"')
  })
})

describe('formatCreatedTaskLine — tags', () => {
  it('includes Tags line when tags present', () => {
    const line = formatCreatedTaskLine({
      id: 'LUM-42',
      identifier: 'LUM-42',
      title: 't',
      url: 'https://x',
      tags: ['urgent', 'rfc'],
    })
    expect(line).toBe(`Created LUM-42 "t"  https://x\nTags: urgent, rfc`)
  })

  it('omits Tags line when tags is empty', () => {
    const line = formatCreatedTaskLine({
      id: 'LUM-42',
      identifier: 'LUM-42',
      title: 't',
      url: 'https://x',
      tags: [],
    })
    expect(line).toBe(`Created LUM-42 "t"  https://x`)
  })

  it('omits Tags line when tags is undefined', () => {
    const line = formatCreatedTaskLine({
      id: 'LUM-42',
      identifier: 'LUM-42',
      title: 't',
      url: 'https://x',
    })
    expect(line).toBe(`Created LUM-42 "t"  https://x`)
  })
})

describe('normalizePriority', () => {
  it('uppercases valid values', () => {
    expect(normalizePriority('low')).toBe('LOW')
    expect(normalizePriority('MEDIUM')).toBe('MEDIUM')
    expect(normalizePriority('High')).toBe('HIGH')
    expect(normalizePriority('urgent')).toBe('URGENT')
  })

  it('returns null on invalid input (caller formats the error)', () => {
    expect(normalizePriority('p1')).toBeNull()
    expect(normalizePriority('')).toBeNull()
  })
})
