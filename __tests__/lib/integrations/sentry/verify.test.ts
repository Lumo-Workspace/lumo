import { createHmac } from 'crypto'
import { verifySentrySignature } from '@/lib/integrations/sentry/verify'

const SECRET = 'test-client-secret'
const BODY = '{"hello":"world"}'
const VALID_SIG = createHmac('sha256', SECRET)
  .update(BODY, 'utf8')
  .digest('hex')

describe('verifySentrySignature', () => {
  it('returns true for a correctly signed body', () => {
    expect(verifySentrySignature(BODY, VALID_SIG, SECRET)).toBe(true)
  })

  it('returns false when signature header is missing', () => {
    expect(verifySentrySignature(BODY, null, SECRET)).toBe(false)
  })

  it('returns false when signature is wrong', () => {
    expect(verifySentrySignature(BODY, 'deadbeef', SECRET)).toBe(false)
  })

  it('returns false when body is tampered', () => {
    expect(verifySentrySignature(BODY + ' ', VALID_SIG, SECRET)).toBe(false)
  })

  it('returns false when secret is wrong', () => {
    expect(verifySentrySignature(BODY, VALID_SIG, 'other-secret')).toBe(false)
  })

  it('returns false when signature is malformed (non-hex)', () => {
    expect(verifySentrySignature(BODY, 'not-a-hex-string', SECRET)).toBe(false)
  })
})
