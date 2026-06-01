/** @jest-environment node */
import { matchSensitiveName, checkArtifactFilePath } from '@/cli/src/lib/path-guard'

describe('matchSensitiveName', () => {
  it('passes an ordinary spec file', () => {
    expect(matchSensitiveName('docs/spec.md')).toBeNull()
    expect(matchSensitiveName('plan.md')).toBeNull()
  })

  it('flags dotenv files', () => {
    expect(matchSensitiveName('.env')).not.toBeNull()
    expect(matchSensitiveName('config/.env.local')).not.toBeNull()
    expect(matchSensitiveName('.env.production')).not.toBeNull()
  })

  it('flags private keys by name and extension', () => {
    expect(matchSensitiveName('id_rsa')).not.toBeNull()
    expect(matchSensitiveName('keys/id_ed25519')).not.toBeNull()
    expect(matchSensitiveName('server.pem')).not.toBeNull()
    expect(matchSensitiveName('cert.key')).not.toBeNull()
  })

  it('flags credential-bearing files and segments', () => {
    expect(matchSensitiveName('.aws/credentials')).not.toBeNull()
    expect(matchSensitiveName('/Users/x/.ssh/known_hosts')).not.toBeNull()
    expect(matchSensitiveName('.npmrc')).not.toBeNull()
  })

  it('is case-insensitive on the basename', () => {
    expect(matchSensitiveName('Server.PEM')).not.toBeNull()
  })

  it('is case-insensitive on sensitive path segments', () => {
    expect(matchSensitiveName('.SSH/id_rsa')).not.toBeNull()
    expect(matchSensitiveName('config/.AWS/credentials')).not.toBeNull()
  })
})

describe('checkArtifactFilePath', () => {
  // Fake fs: cwd is /proj; realpath maps a few known paths and otherwise
  // echoes the input. Symlink + missing-file cases are modeled explicitly.
  const cwd = () => '/proj'
  const makeRealpath =
    (overrides: Record<string, string | Error> = {}) =>
    (p: string): string => {
      const hit = overrides[p]
      if (hit instanceof Error) throw hit
      if (typeof hit === 'string') return hit
      return p // identity for plain paths that "exist"
    }

  it('accepts an ordinary in-project file', () => {
    const r = checkArtifactFilePath('docs/spec.md', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r).toEqual({ ok: true, resolved: '/proj/docs/spec.md' })
  })

  it('rejects parent-traversal paths', () => {
    const r = checkArtifactFilePath('../../etc/passwd', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects absolute paths outside the project', () => {
    const r = checkArtifactFilePath('/Users/x/secret.txt', {
      cwd,
      realpath: makeRealpath(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects a symlink that escapes the project', () => {
    // notes.md lives in /proj but realpath resolves it outside
    const r = checkArtifactFilePath('notes.md', {
      cwd,
      realpath: makeRealpath({ '/proj/notes.md': '/Users/x/.ssh/id_rsa' }),
    })
    expect(r.ok).toBe(false)
    // caught by the sensitive denylist on the canonical path
    if (!r.ok) expect(r.reason).toBe('sensitive')
  })

  it('rejects a symlink escaping to a non-sensitive outside path', () => {
    // Exercises the confinement (step 4) branch for symlinks: the target is
    // outside the project but its name is NOT on the denylist, so it must be
    // caught by the outside-project check rather than the sensitive check.
    const r = checkArtifactFilePath('notes.md', {
      cwd,
      realpath: makeRealpath({ '/proj/notes.md': '/Users/x/ordinary-notes.txt' }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects a path that resolves to the project root itself', () => {
    const r = checkArtifactFilePath('.', { cwd, realpath: makeRealpath() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('outside-project')
  })

  it('rejects an in-project sensitive file', () => {
    const r = checkArtifactFilePath('.env', { cwd, realpath: makeRealpath() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('sensitive')
  })

  it('reports unreadable when realpath throws', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const r = checkArtifactFilePath('missing.md', {
      cwd,
      realpath: makeRealpath({ '/proj/missing.md': enoent }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unreadable')
  })
})
