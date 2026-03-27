import { createHmac } from 'crypto'
import { verifyGitHubSignature } from '@/lib/github/verify'

function sign(body: string, secret: string): string {
  return (
    'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  )
}

describe('verifyGitHubSignature', () => {
  const body = JSON.stringify({ action: 'opened' })
  const secret = 'my-super-secret'

  it('returns true for a valid signature', () => {
    expect(verifyGitHubSignature(body, sign(body, secret), secret)).toBe(true)
  })
  it('returns false when signed with wrong secret', () => {
    expect(
      verifyGitHubSignature(body, sign(body, 'wrong-secret'), secret)
    ).toBe(false)
  })
  it('returns false for null header', () => {
    expect(verifyGitHubSignature(body, null, secret)).toBe(false)
  })
  it('returns false for header without sha256= prefix', () => {
    expect(verifyGitHubSignature(body, 'notasig', secret)).toBe(false)
  })
  it('returns false for different body', () => {
    const sig = sign('other body', secret)
    expect(verifyGitHubSignature(body, sig, secret)).toBe(false)
  })
  it('handles length mismatch without throwing', () => {
    expect(verifyGitHubSignature(body, 'sha256=short', secret)).toBe(false)
  })
})
