/**
 * @jest-environment node
 *
 * LUM-1082 — the pure transport resolver (moved out of ./client so the
 * Better Auth public config can ask "can we email?" without nodemailer).
 */
import { resolveEmailTransport } from '@/lib/integrations/email/transport'
import { resolveEmailTransport as fromClient } from '@/lib/integrations/email/client'

describe('resolveEmailTransport (pure module)', () => {
  it('SMTP wins, then the Resend relay, else none', () => {
    expect(
      resolveEmailTransport({ SMTP_URL: 'smtp://m', RESEND_API_KEY: 'k' })
    ).toBe('smtp')
    expect(resolveEmailTransport({ SMTP_HOST: 'm' })).toBe('smtp')
    expect(resolveEmailTransport({ RESEND_API_KEY: 'k' })).toBe('resend_relay')
    expect(resolveEmailTransport({})).toBe('none')
  })

  it('is the same function the email client exports', () => {
    expect(fromClient).toBe(resolveEmailTransport)
  })
})
