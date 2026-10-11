/** @jest-environment node */
/**
 * LUM-1035 — the DCO checker the public repository's `DCO` workflow runs on
 * every pull request (.github/scripts/check-dco.mjs). In the private repo the
 * file lives in the export overlay (oss/overlay/.github/…); in the published
 * snapshot it sits at .github/…, so this test runs in both.
 */
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../..')
const SCRIPT = [
  join(ROOT, '.github/scripts/check-dco.mjs'),
  join(ROOT, 'oss/overlay/.github/scripts/check-dco.mjs'),
].find(p => existsSync(p))

interface Commit {
  sha: string
  message: string
  authorEmail: string
  parents?: number
}

function run(input: string) {
  const r = spawnSync(process.execPath, [SCRIPT as string], {
    input,
    encoding: 'utf8',
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

const check = (commits: Commit[]) =>
  run(commits.map(c => JSON.stringify(c)).join('\n') + '\n')

const signed = (email: string) =>
  `feat: add a thing\n\nBody.\n\nSigned-off-by: Ada Lovelace <${email}>\n`

describe('check-dco LUM-1035', () => {
  it('the checker exists in the overlay or the snapshot', () => {
    expect(SCRIPT).toBeDefined()
  })

  it('passes when every commit is signed off by its author (email case-insensitive)', () => {
    const r = check([
      {
        sha: 'a'.repeat(40),
        message: signed('ada@example.com'),
        authorEmail: 'Ada@Example.com',
      },
      {
        sha: 'b'.repeat(40),
        message: signed('ada@example.com'),
        authorEmail: 'ada@example.com',
      },
    ])
    expect(r).toEqual({ code: 0, out: '✓ all 2 commit(s) signed off\n' })
  })

  it('fails a commit without a Signed-off-by trailer and names it', () => {
    const r = check([
      {
        sha: 'a'.repeat(40),
        message: signed('ada@example.com'),
        authorEmail: 'ada@example.com',
      },
      {
        sha: 'c'.repeat(40),
        message: 'fix: no trailer\n',
        authorEmail: 'ada@example.com',
      },
    ])
    expect(r.code).toBe(1)
    expect(r.out).toContain(`✗ ${'c'.repeat(12)}: no Signed-off-by trailer`)
    expect(r.out).not.toContain('a'.repeat(12))
    expect(r.out).toContain('git commit -s')
  })

  it('fails when the sign-off is someone other than the author', () => {
    const r = check([
      {
        sha: 'd'.repeat(40),
        message: signed('someone@else.org'),
        authorEmail: 'ada@example.com',
      },
    ])
    expect(r.code).toBe(1)
    expect(r.out).toContain('matches the author email <ada@example.com>')
  })

  it('a sign-off mentioned mid-line does not count', () => {
    const r = check([
      {
        sha: 'e'.repeat(40),
        message:
          'docs: see Signed-off-by: Ada <ada@example.com> in the guide\n',
        authorEmail: 'ada@example.com',
      },
    ])
    expect(r.code).toBe(1)
  })

  it('skips merge commits and GitHub bot authors', () => {
    const r = check([
      {
        sha: 'f'.repeat(40),
        message: 'Merge branch main\n',
        authorEmail: 'ada@example.com',
        parents: 2,
      },
      {
        sha: '1'.repeat(40),
        message: 'chore(deps): bump x\n',
        authorEmail: '49699333+dependabot[bot]@users.noreply.github.com',
      },
    ])
    expect(r.code).toBe(0)
  })

  it('exits 2 on empty or malformed input instead of passing', () => {
    expect(run('').code).toBe(2)
    expect(run('not json\n').code).toBe(2)
  })
})
