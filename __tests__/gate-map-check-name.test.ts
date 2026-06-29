import { classifyGateName } from '../shared/src/gate-map'

describe('classifyGateName (LUM-616)', () => {
  it('classifyGateName maps platform names to gates and returns null for unknown', () => {
    // build — Vercel deploy / generic build / deploy across platforms
    expect(classifyGateName('Vercel')).toBe('build')
    expect(classifyGateName('ci/circleci: build')).toBe('build')
    expect(classifyGateName('deploy preview')).toBe('build')
    expect(classifyGateName('npm run build')).toBe('build')

    // typecheck
    expect(classifyGateName('typecheck')).toBe('typecheck')
    expect(classifyGateName('tsc')).toBe('typecheck')
    expect(classifyGateName('type-check')).toBe('typecheck')

    // test
    expect(classifyGateName('test (18.x)')).toBe('test')
    expect(classifyGateName('jest')).toBe('test')
    expect(classifyGateName('unit tests')).toBe('test')

    // unrecognized → null (never a fabricated mapping)
    expect(classifyGateName('lint')).toBeNull()
    expect(classifyGateName('eslint')).toBeNull()
    expect(classifyGateName('codeql')).toBeNull()
    expect(classifyGateName('')).toBeNull()

    // Vercel "Preview Comments" is a bot comment, not a build check — must not
    // be mistaken for a build signal even though it contains "vercel".
    expect(classifyGateName('Vercel Preview Comments')).toBeNull()
  })
})
