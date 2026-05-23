/**
 * @jest-environment node
 */
import {
  formatCreatedDocLine,
  normalizeScope,
} from '@/cli/src/commands/doc-create'

describe('formatCreatedDocLine', () => {
  it('renders cuid, quoted title, and URL', () => {
    expect(
      formatCreatedDocLine({
        id: 'cmdxxxxxxxxxxxxxxxxxxxxx',
        title: 'RFC: doc CLI',
        url: 'https://www.uselumo.ai/workspace/lumo/documents/cmdxxxxxxxxxxxxxxxxxxxxx',
      })
    ).toBe(
      'Created cmdxxxxxxxxxxxxxxxxxxxxx "RFC: doc CLI"  https://www.uselumo.ai/workspace/lumo/documents/cmdxxxxxxxxxxxxxxxxxxxxx'
    )
  })

  it('escapes embedded double-quotes', () => {
    expect(
      formatCreatedDocLine({
        id: 'c1',
        title: 'has "quotes"',
        url: 'https://x',
      })
    ).toContain('"has \\"quotes\\""')
  })
})

describe('normalizeScope', () => {
  it('maps personal to PRIVATE', () => {
    expect(normalizeScope('personal')).toBe('PRIVATE')
    expect(normalizeScope('Personal')).toBe('PRIVATE')
  })
  it('maps workspace to WORKSPACE', () => {
    expect(normalizeScope('workspace')).toBe('WORKSPACE')
  })
  it('returns null for invalid', () => {
    expect(normalizeScope('shared')).toBeNull()
    expect(normalizeScope('xyz')).toBeNull()
    expect(normalizeScope('')).toBeNull()
  })
})

describe('formatCreatedDocLine — tags', () => {
  it('includes Tags line when tags present', () => {
    const line = formatCreatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
      tags: ['urgent', 'rfc'],
    })
    expect(line).toBe(`Created cmd_x "t"  https://x\nTags: urgent, rfc`)
  })

  it('omits Tags line when tags is empty', () => {
    const line = formatCreatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
      tags: [],
    })
    expect(line).toBe(`Created cmd_x "t"  https://x`)
  })

  it('omits Tags line when tags is undefined', () => {
    const line = formatCreatedDocLine({
      id: 'cmd_x',
      title: 't',
      url: 'https://x',
    })
    expect(line).toBe(`Created cmd_x "t"  https://x`)
  })
})
