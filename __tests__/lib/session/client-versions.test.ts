/**
 * @jest-environment node
 *
 * LUM-1136 — the CLI / skill version headers are untrusted client input:
 * only well-formed values survive.
 */
import {
  parseClientVersionHeaders,
  parseSkillVersion,
} from '@/lib/session/client-versions'

const h = (init: Record<string, string>) => new Headers(init)

describe('parseSkillVersion', () => {
  it.each(['1.120.0', '1.120.0 modified', 'modified', 'source', 'none'])(
    'accepts %s',
    v => expect(parseSkillVersion(v)).toBe(v)
  )

  it.each(['', 'latest', '1.2', '1.2.3-beta', '<script>', '1.2.3 modified x'])(
    'rejects %j',
    v => expect(parseSkillVersion(v)).toBeNull()
  )

  it('trims surrounding whitespace and handles null', () => {
    expect(parseSkillVersion(' source ')).toBe('source')
    expect(parseSkillVersion(null)).toBeNull()
  })
})

describe('parseClientVersionHeaders', () => {
  it('reads both headers when well-formed', () => {
    expect(
      parseClientVersionHeaders(
        h({
          'X-Lumo-Cli-Version': '1.121.0',
          'X-Lumo-Skill-Version': '1.120.0',
        })
      )
    ).toEqual({ cliVersion: '1.121.0', skillVersion: '1.120.0' })
  })

  it('omits absent and malformed headers', () => {
    expect(parseClientVersionHeaders(h({}))).toEqual({})
    expect(
      parseClientVersionHeaders(
        h({ 'X-Lumo-Cli-Version': 'v1', 'X-Lumo-Skill-Version': 'bogus' })
      )
    ).toEqual({})
  })
})
