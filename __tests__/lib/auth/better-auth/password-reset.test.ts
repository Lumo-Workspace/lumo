/**
 * @jest-environment node
 *
 * LUM-1070 — sendResetPassword: email in the requester's language through
 * Lumo's mail layer; a mail failure is logged, never thrown.
 */
const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))
const mockWarn = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { warn: (...a: unknown[]) => mockWarn(...a) },
}))

import { sendResetPasswordEmail } from '@/lib/auth/better-auth/password-reset'

const url =
  'https://lumo.test/api/auth/reset-password/tok?callbackURL=%2Freset-password'

beforeEach(() => {
  mockSendEmail.mockReset()
  mockWarn.mockReset()
})

describe('sendResetPasswordEmail (LUM-1070)', () => {
  it("sends in the browser's language", async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'm1' })
    const request = new Request(
      'https://lumo.test/api/auth/request-password-reset',
      {
        headers: { 'accept-language': 'ja,en;q=0.5' },
      }
    )
    await sendResetPasswordEmail(
      { user: { email: 'a@example.test' }, url },
      request
    )
    const message = mockSendEmail.mock.calls[0]![0]
    expect(message.to).toEqual(['a@example.test'])
    expect(message.subject).toBe('Lumo のパスワードを再設定')
    expect(message.text).toContain(url)
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('defaults to English without a request', async () => {
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'm1' })
    await sendResetPasswordEmail({ user: { email: 'a@example.test' }, url })
    expect(mockSendEmail.mock.calls[0]![0].subject).toBe(
      'Reset your Lumo password'
    )
  })

  it('logs (without the address) when the mail is not sent', async () => {
    mockSendEmail.mockResolvedValue({
      status: 'skipped',
      reason: 'not_configured',
    })
    await expect(
      sendResetPasswordEmail({ user: { email: 'a@example.test' }, url })
    ).resolves.toBeUndefined()
    expect(mockWarn).toHaveBeenCalledWith(
      '[auth] password reset email not sent',
      {
        status: 'skipped',
      }
    )
  })
})
