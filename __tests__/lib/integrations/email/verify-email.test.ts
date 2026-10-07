/**
 * @jest-environment node
 */
import { buildVerifyEmail } from '@/lib/integrations/email/templates/verify-email'

describe('buildVerifyEmail (LUM-1027)', () => {
  it('links the verification URL in text and (escaped) HTML', () => {
    const url =
      'https://lumo.example/api/auth/verify-email?token=a&callbackURL=/x'
    const email = buildVerifyEmail(url)
    expect(email.subject).toBe('Verify your email for Lumo')
    expect(email.text).toContain(url)
    expect(email.html).toContain(
      'href="https://lumo.example/api/auth/verify-email?token=a&amp;callbackURL=/x"'
    )
  })

  it('cannot break out of the href attribute', () => {
    const email = buildVerifyEmail('https://x/"><script>alert(1)</script>')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&quot;&gt;&lt;script&gt;')
  })
})
