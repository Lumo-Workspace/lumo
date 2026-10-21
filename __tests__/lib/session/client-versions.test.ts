/**
 * @jest-environment node
 *
 * LUM-1136 — the CLI version header is untrusted client input:
 * only well-formed values survive.
 */
import { parseClientVersionHeaders } from '@/lib/session/client-versions'

const h = (init: Record<string, string>) => new Headers(init)

describe('parseClientVersionHeaders', () => {
  it('reads the CLI header when well-formed', () => {
    expect(
      parseClientVersionHeaders(h({ 'X-Lumo-Cli-Version': '1.121.0' }))
    ).toEqual({ cliVersion: '1.121.0' })
  })

  it('ignores a skill-version header (no longer recorded)', () => {
    expect(
      parseClientVersionHeaders(
        h({
          'X-Lumo-Cli-Version': '1.121.0',
          'X-Lumo-Skill-Version': '1.120.0',
        })
      )
    ).toEqual({ cliVersion: '1.121.0' })
  })

  it('omits absent and malformed headers', () => {
    expect(parseClientVersionHeaders(h({}))).toEqual({})
    expect(
      parseClientVersionHeaders(h({ 'X-Lumo-Cli-Version': 'v1' }))
    ).toEqual({})
  })
})
