/**
 * LUM-1077 — `(request) => boolean` for path patterns like `/api/(.*)`, used
 * by proxy.ts. Same matching rules as the Clerk helper it replaces:
 *
 *   - a pattern is a literal path where `(.*)` matches anything (including
 *     nothing); `/api/(.*)` needs the slash, so `/api` alone does not match;
 *   - case-insensitive, and one trailing `/` is allowed;
 *   - the pathname is decoded with `decodeURI` (so `/%61pi/x` is `/api/x`)
 *     and repeated slashes are collapsed before matching, so neither trick
 *     dodges a pattern.
 *
 * A pathname with malformed percent-encoding matches nothing: for
 * `isPublicRoute` that means "protected", the safe side.
 *
 * Pure, no SDK: safe for the proxy bundle.
 */
import type { NextRequest } from 'next/server'

const WILDCARD = '(.*)'

/** Pure: the anchored regex for one pattern. */
export function patternToRegExp(pattern: string): RegExp {
  const body = pattern
    .split(WILDCARD)
    .map(part => part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}\\/?$`, 'i')
}

/** Pure: `pathname` as matched — decoded, repeated slashes collapsed. */
export function normalizePathname(pathname: string): string | null {
  try {
    return decodeURI(pathname).replace(/\/\/+/g, '/')
  } catch {
    return null
  }
}

/** Pure: whether `pathname` matches any of `patterns`. */
export function createPathMatcher(
  patterns: readonly string[]
): (pathname: string) => boolean {
  const regexps = patterns.map(patternToRegExp)
  return pathname => {
    const normalized = normalizePathname(pathname)
    if (normalized === null) return false
    return regexps.some(re => re.test(normalized))
  }
}

/** `(request) => boolean` over the request's pathname. */
export function createRouteMatcher(
  patterns: readonly string[]
): (request: NextRequest) => boolean {
  const matches = createPathMatcher(patterns)
  return request => matches(request.nextUrl.pathname)
}
