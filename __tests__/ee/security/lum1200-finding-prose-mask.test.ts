/**
 * @jest-environment node
 *
 * LUM-1200 follow-up — finding prose keeps its inline code. Production
 * (probe PR 60 @3202de1, comment 4285358212): the AI review's detail "The
 * condition `expiresAt > now || token.length > 0` is true for any session…"
 * was stored, shown in the CLI / panel and posted inline as "The condition
 * `expi…(len 35)`": the finding pass masked every quoted span of any text
 * mentioning a token. Finding titles / details (and the verifier's reason)
 * now take the prose pass; real secrets are still masked.
 */
import { redactFindingProse as judgeProse } from '@/ee/security/security-scan/finding-prose'
import { maskQuotedKeyedValues } from '@/lib/security-scan/redact'

const PROD_DETAIL =
  'The condition `expiresAt > now || token.length > 0` is true for any session with a non-empty token, so expired sessions are always treated as valid. It should require the session to be unexpired (and, if needed, have a token).'

describe('redactFindingProse — finding title / detail', () => {
  it('renders the production detail with its inline code intact', () => {
    expect(judgeProse(PROD_DETAIL, false)).toBe(PROD_DETAIL)
  })

  it('still masks a credential-shaped quoted value', () => {
    const out = judgeProse(
      'The token `Zx9Qw3Lp7Vb2Nm5Rt8Ky` is compared with ==',
      false
    )
    expect(out).not.toContain('Zx9Qw3Lp7Vb2Nm5Rt8Ky')
  })

  it('still masks a value assigned to a credential key inside quoted code', () => {
    const out = judgeProse(
      `The comment says ${assigned('const pw', '=', "'correcthorsebattery'")} is fine`,
      false
    )
    expect(out).not.toContain('correcthorsebattery')
  })

  it('still masks a registry secret written unquoted', () => {
    // Assembled at runtime so the fixture is not itself a key-shaped literal.
    const key = ['AKIA', 'IOSFODNN7', 'EXAMPLF'].join('')
    expect(judgeProse(`Hardcodes ${key} in the client`, false)).not.toContain(
      key
    )
  })

  it('a hardcoded-credential finding keeps the stricter pass', () => {
    const out = judgeProse(
      'The session token `expiresAt > now || token.length > 0` is hardcoded',
      true
    )
    expect(out).toContain('`expi…(len 35)`')
  })
})

// Assembled at runtime so the fixtures are not themselves assignment-shaped literals.
const assigned = (key: string, op: string, value: string) =>
  `\`${[key, op, value].join(' ')}\``

describe('maskQuotedKeyedValues — a credential key assigned inside the span', () => {
  it.each([
    [assigned('const pw', '=', "'correcthorsebattery'")],
    [assigned('apiKey', ':', '"plainwordsonlyvalue"').replace(' :', ':')],
    ['`password => plainwordsonly`'],
  ])('masks %s', text => {
    expect(maskQuotedKeyedValues(text)).toContain('…(len')
  })

  it.each([
    ['`expiresAt > now || token.length > 0`'],
    ['`token == expectedValue`'],
    ['`session.token >= minimum`'],
  ])('keeps a key that is only read or compared: %s', text => {
    expect(maskQuotedKeyedValues(text)).toBe(text)
  })
})
