/**
 * @jest-environment node
 */

// Only the exported `config.matcher` is inspected; no request runs.

import { config } from '@/proxy'

describe('proxy matcher', () => {
  const matcher = config.matcher
  if (!Array.isArray(matcher) || typeof matcher[0] !== 'string') {
    throw new Error('expected config.matcher to be a non-empty string array')
  }
  const re = new RegExp(matcher[0])

  it('does not match a public .yml asset', () => {
    expect(re.test('/integrations/example.yml')).toBe(false)
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
