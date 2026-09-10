/**
 * @jest-environment node
 */

// clerkMiddleware() validates that Clerk keys are present at call time, so we
// set fake keys before importing `@/proxy` (which builds the middleware at
// module scope). No real Clerk calls happen in this test — we only inspect
// the exported `config.matcher`.
process.env.CLERK_SECRET_KEY = 'sk_test_dummy'
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_dummy'

import { config } from '@/proxy'

describe('proxy matcher', () => {
  const matcher = config.matcher
  if (!Array.isArray(matcher) || typeof matcher[0] !== 'string') {
    throw new Error('expected config.matcher to be a non-empty string array')
  }
  const re = new RegExp(matcher[0])

  it('does not match the public workflow template asset', () => {
    expect(re.test('/integrations/lumo-security.yml')).toBe(false)
  })

  it('does not match other public static assets', () => {
    expect(re.test('/logo.svg')).toBe(false)
  })

  it('matches app routes that should stay behind auth', () => {
    expect(re.test('/workspace/acme/tasks')).toBe(true)
  })

  it('matches API routes (they are public via isPublicRoute, not the matcher)', () => {
    expect(re.test('/api/integrations/security/sarif/upload')).toBe(true)
  })
})
