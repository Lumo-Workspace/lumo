/**
 * @jest-environment node
 *
 * Barrel export verification for @/lib/integrations/email.
 * Ensures all public functions and types are accessible from the index.
 */

// Mock the Resend client to avoid requiring RESEND_API_KEY during tests
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn() },
  })),
}))

import * as emailModule from '@/lib/integrations/email'

describe('lib/integrations/email barrel exports', () => {
  it('exports sendEmail as a function', () => {
    expect(typeof emailModule.sendEmail).toBe('function')
  })

  it('exports buildInviteEmail as a function', () => {
    expect(typeof emailModule.buildInviteEmail).toBe('function')
  })

  it('exports all expected public names', () => {
    const expectedExports = ['sendEmail', 'buildInviteEmail']
    const actualExports = Object.keys(emailModule)
    for (const name of expectedExports) {
      expect(actualExports).toContain(name)
    }
  })

  describe('buildInviteEmail', () => {
    const options = {
      workspaceName: 'Acme Corp',
      inviterName: 'Jane Doe',
      inviterFirstName: 'Jane',
      inviterEmail: 'jane@acme.com',
      inviteUrl: 'https://app.uselumo.ai/invite/abc123',
    }

    it('returns an object with subject and html', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result).toHaveProperty('subject')
      expect(result).toHaveProperty('html')
    })

    it('includes the inviter first name in the subject', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result.subject).toContain('Jane')
    })

    it('includes the workspace name in the subject', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result.subject).toContain('Acme Corp')
    })

    it('includes the invite URL in the html', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result.html).toContain('https://app.uselumo.ai/invite/abc123')
    })

    it('includes the inviter name in the html', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result.html).toContain('Jane Doe')
    })

    it('includes the workspace name in the html', () => {
      const result = emailModule.buildInviteEmail(options)
      expect(result.html).toContain('Acme Corp')
    })
  })
})
