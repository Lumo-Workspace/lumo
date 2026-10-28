/**
 * @jest-environment node
 */
// LUM-1077 — the proxy's route matcher, replacing Clerk's createRouteMatcher
// with the same rules (proxy.ts PUBLIC_ROUTES depend on them).
import { NextRequest } from 'next/server'
import {
  createPathMatcher,
  createRouteMatcher,
  normalizePathname,
  patternToRegExp,
} from '@/lib/auth/route-matcher'

describe('patternToRegExp', () => {
  it('turns (.*) into a wildcard and escapes everything else', () => {
    expect(patternToRegExp('/.well-known/(.*)').test('/.well-known/x')).toBe(
      true
    )
    // The dot is literal, not "any character".
    expect(patternToRegExp('/.well-known/(.*)').test('/Xwell-known/x')).toBe(
      false
    )
  })
})

describe('normalizePathname', () => {
  it('decodes and collapses repeated slashes', () => {
    expect(normalizePathname('//%61pi//x')).toBe('/api/x')
  })
  it('is null for malformed percent-encoding', () => {
    expect(normalizePathname('/api/%E0%A4%A')).toBeNull()
  })
})

describe('createPathMatcher (same answers as Clerk’s matcher)', () => {
  const matches = createPathMatcher(['/signin(.*)', '/api/(.*)', '/security'])
  it.each([
    ['/security', true],
    ['/security/', true],
    ['/Security', true],
    ['/securityx', false],
    ['/signin', true],
    ['/signin/factor-one', true],
    ['/signinx', true],
    ['/api', false],
    ['/api/', true],
    ['/API/x', true],
    ['//api/x', true],
    ['/%61pi/x', true],
    ['/workspace', false],
    ['/', false],
  ])('%s → %s', (path, expected) => {
    expect(matches(path)).toBe(expected)
  })

  it('matches nothing for a malformed path (so it stays protected)', () => {
    expect(matches('/api/%E0%A4%A')).toBe(false)
  })
})

describe('createRouteMatcher', () => {
  it('matches on the request pathname, ignoring the query', () => {
    const isConsent = createRouteMatcher(['/oauth/consent(.*)'])
    expect(
      isConsent(new NextRequest('http://localhost/oauth/consent?client_id=a'))
    ).toBe(true)
    expect(isConsent(new NextRequest('http://localhost/oauth/other'))).toBe(
      false
    )
  })
})
