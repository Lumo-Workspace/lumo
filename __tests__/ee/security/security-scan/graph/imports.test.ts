/** @jest-environment node */
import {
  resolveImportCandidates,
  isGraphSourcePath,
} from '@/ee/security/security-scan/graph/imports'

describe('LUM-739 graph imports', () => {
  it('expands an @/ alias to the four TS candidates', () => {
    expect(resolveImportCandidates('app/api/x/route.ts', '@/lib/x')).toEqual([
      'lib/x.ts',
      'lib/x.tsx',
      'lib/x/index.ts',
      'lib/x/index.tsx',
    ])
  })

  it('resolves relative specifiers against the importer directory', () => {
    expect(
      resolveImportCandidates('lib/integrations/github/auth.ts', './contents')
    ).toEqual([
      'lib/integrations/github/contents.ts',
      'lib/integrations/github/contents.tsx',
      'lib/integrations/github/contents/index.ts',
      'lib/integrations/github/contents/index.tsx',
    ])
    expect(
      resolveImportCandidates('lib/services/a.ts', '../db/prisma')[0]
    ).toBe('lib/db/prisma.ts')
  })

  it('keeps an explicit .ts extension and drops .js ones', () => {
    expect(resolveImportCandidates('lib/a.ts', './x.ts')).toEqual(['lib/x.ts'])
    expect(resolveImportCandidates('lib/a.ts', './x.js')).toEqual([])
  })

  it('never resolves bare packages or paths that escape the repo', () => {
    expect(resolveImportCandidates('lib/a.ts', 'zod')).toEqual([])
    expect(resolveImportCandidates('lib/a.ts', '../../../etc')).toEqual([])
  })

  it('isGraphSourcePath accepts .ts/.tsx and rejects .d.ts / .js', () => {
    expect(isGraphSourcePath('a.tsx')).toBe(true)
    expect(isGraphSourcePath('lib/a.ts')).toBe(true)
    expect(isGraphSourcePath('a.d.ts')).toBe(false)
    expect(isGraphSourcePath('a.js')).toBe(false)
  })
})
