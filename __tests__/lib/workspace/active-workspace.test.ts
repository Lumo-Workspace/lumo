import {
  normalizeActiveSlug,
  workspaceSlugFromPathname,
} from '@/lib/workspace/active-workspace'

describe('workspaceSlugFromPathname (LUM-987)', () => {
  it.each([
    ['/workspace/acme', 'acme'],
    ['/workspace/acme/', 'acme'],
    ['/workspace/acme/my-tasks/LUM-1', 'acme'],
    ['/workspace/caf%C3%A9/x', 'café'],
  ])('%s → %s', (path, slug) => {
    expect(workspaceSlugFromPathname(path)).toBe(slug)
  })

  it.each([
    '/',
    '/workspace',
    '/workspace/',
    '/sessions/s1',
    '/x/workspace/acme',
    '/workspace/%E0%A4%A',
  ])('%s → null', path => {
    expect(workspaceSlugFromPathname(path)).toBeNull()
  })
})

describe('normalizeActiveSlug (LUM-987)', () => {
  it('trims, and maps empty / missing to null', () => {
    expect(normalizeActiveSlug(' acme ')).toBe('acme')
    expect(normalizeActiveSlug('')).toBeNull()
    expect(normalizeActiveSlug('   ')).toBeNull()
    expect(normalizeActiveSlug(null)).toBeNull()
    expect(normalizeActiveSlug(undefined)).toBeNull()
  })
})
