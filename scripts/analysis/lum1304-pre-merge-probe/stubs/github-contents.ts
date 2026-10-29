// LUM-1304 capture: stands in for `@/lib/integrations/github/contents`
// (see capture.ts); every call is served by `globalThis.__lum1304Github`.
type Fns = Record<string, (...args: unknown[]) => Promise<unknown>>
const fns = () =>
  (globalThis as unknown as { __lum1304Github: Fns }).__lum1304Github
export const fetchPrDetails = (...a: unknown[]) => fns().fetchPrDetails!(...a)
export const fetchPrDiff = (...a: unknown[]) => fns().fetchPrDiff!(...a)
export const readPrTemplate = (...a: unknown[]) => fns().readPrTemplate!(...a)
export const fetchRepoVisibility = (...a: unknown[]) =>
  fns().fetchRepoVisibility!(...a)
export const fetchRepoIssues = (...a: unknown[]) => fns().fetchRepoIssues!(...a)
