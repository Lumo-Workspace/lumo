/** @jest-environment node */
/**
 * LUM-1134 — the workspace learnings scope (CodeRabbit's
 * `knowledge_base.learnings.scope`): which repositories' learnings a review
 * reads, and how `auto` follows the reviewed repository's visibility.
 */
import {
  DEFAULT_LEARNINGS_SCOPE,
  LEARNINGS_SCOPES,
  parseLearningsScope,
  readsOtherRepositories,
} from '@/ee/security/security-scan/learnings-scope'

describe('parseLearningsScope', () => {
  it('keeps the three stored values', () => {
    expect(LEARNINGS_SCOPES).toEqual(['local', 'global', 'auto'])
    for (const s of LEARNINGS_SCOPES) expect(parseLearningsScope(s)).toBe(s)
  })
  it('reads anything else as the default (auto)', () => {
    expect(DEFAULT_LEARNINGS_SCOPE).toBe('auto')
    for (const v of [undefined, null, '', 'GLOBAL', 'org', 1, true])
      expect(parseLearningsScope(v)).toBe('auto')
  })
})

describe('readsOtherRepositories', () => {
  it('local never reads other repositories, whatever the visibility', () => {
    for (const v of ['public', 'private', 'unknown'] as const)
      expect(readsOtherRepositories('local', v)).toBe(false)
  })
  it('global always reads them (same workspace only — the caller pins it)', () => {
    for (const v of ['public', 'private', 'unknown'] as const)
      expect(readsOtherRepositories('global', v)).toBe(true)
  })
  it('auto: private ⇒ global, public ⇒ local, unknown ⇒ local (fail toward local)', () => {
    expect(readsOtherRepositories('auto', 'private')).toBe(true)
    expect(readsOtherRepositories('auto', 'public')).toBe(false)
    expect(readsOtherRepositories('auto', 'unknown')).toBe(false)
  })
})
