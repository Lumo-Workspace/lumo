/** @jest-environment node */
import { shouldEscalateToChromium } from '@/lib/integrations/og-metadata/should-escalate'

describe('shouldEscalateToChromium', () => {
  it.each([
    ['http 403', true],
    ['non-html content', true],
    ['timeout', true],
    ['http 401', false],
    ['http 404', false],
    ['http 500', false],
    ['http 429', false],
    ['body too large', false],
    ['network error', false],
  ])('returns %j for %s', (error, expected) => {
    expect(shouldEscalateToChromium(error)).toBe(expected)
  })
})
