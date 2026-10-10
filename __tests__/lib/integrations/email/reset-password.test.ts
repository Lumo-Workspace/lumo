/**
 * @jest-environment node
 *
 * LUM-1070 — the localized "reset your password" email.
 */
import { buildResetPasswordEmail } from '@/lib/integrations/email/templates/reset-password'
import { MESSAGES } from '@/lib/i18n/messages'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'

const URL_ =
  'https://lumo.test/api/auth/reset-password/tok?callbackURL=%2Freset-password'

describe('buildResetPasswordEmail (LUM-1070)', () => {
  it('renders English copy with the link in html and text', () => {
    const email = buildResetPasswordEmail(URL_, 'en')
    expect(email.subject).toBe('Reset your Lumo password')
    expect(email.text).toContain(URL_)
    expect(email.html).toContain(
      'href="https://lumo.test/api/auth/reset-password/tok?callbackURL=%2Freset-password"'
    )
    expect(email.html).toContain('<html lang="en">')
  })

  it.each(PUBLIC_LOCALES)('uses the %s catalogue for every string', locale => {
    const email = buildResetPasswordEmail(URL_, locale)
    const m = MESSAGES[locale]!
    expect(email.subject).toBe(m['email.resetPassword.subject'])
    expect(email.text).toContain(m['email.resetPassword.body'])
    expect(email.text).toContain(m['email.resetPassword.ignore'])
  })

  it('translates rather than falling back to English', () => {
    expect(buildResetPasswordEmail(URL_, 'zh-CN').subject).toBe(
      '重置你的 Lumo 密码'
    )
    expect(buildResetPasswordEmail(URL_, 'de').subject).not.toBe(
      buildResetPasswordEmail(URL_, 'en').subject
    )
  })

  it('escapes the link in the html part', () => {
    const email = buildResetPasswordEmail('https://x.test/?a=1&b="2"', 'en')
    expect(email.html).toContain(
      'href="https://x.test/?a=1&amp;b=&quot;2&quot;"'
    )
  })
})
