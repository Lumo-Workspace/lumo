/** @jest-environment node */
/**
 * LUM-1035 — the DCO checker the public repository's `DCO` workflow runs on
 * every pull request (.github/scripts/check-dco.mjs). In the private repo the
 * file lives in the export overlay (oss/overlay/.github/…); in the published
 * snapshot it sits at .github/…, so this test runs in both. LUM-1081: the bot
 * exemption reads GitHub accounts, never the author email, and a pull request
 * longer than the API's 250-commit list fails instead of passing half-checked.
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
  /** The GitHub account the API linked the commit to (LUM-1081). */
  authorLogin?: string | null
  authorType?: string | null
}

function run(input: string, args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT as string, ...args], {
    input,
    encoding: 'utf8',
  })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

const ndjson = (commits: Commit[]) =>
  commits.map(c => JSON.stringify(c)).join('\n') + '\n'

/** Runs the checker as the workflow does; `expected` defaults to the list size. */
const check = (
  commits: Commit[],
  opts: { expected?: number; prAuthor?: [string, string] } = {}
) =>
  run(ndjson(commits), [
    '--expected-commits',
    String(opts.expected ?? commits.length),
    ...(opts.prAuthor
      ? ['--pr-author', opts.prAuthor[0], '--pr-author-type', opts.prAuthor[1]]
      : []),
  ])

const DEPENDABOT_EMAIL = '49699333+dependabot[bot]@users.noreply.github.com'
const bump = (sha: string): Commit => ({
  sha: sha.repeat(40),
  message: 'chore(deps): bump x\n',
  authorEmail: DEPENDABOT_EMAIL,
})

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

  it('skips merge commits', () => {
    const r = check([
      {
        sha: 'f'.repeat(40),
        message: 'Merge branch main\n',
        authorEmail: 'ada@example.com',
        parents: 2,
      },
    ])
    expect(r.code).toBe(0)
  })

  // LUM-1081: the exemption used to trust the author email, which is free text.
  it('a forged bot author email is not exempt (no linked account)', () => {
    const r = check([bump('1')], { prAuthor: ['mallory', 'User'] })
    expect(r.code).toBe(1)
    expect(r.out).toContain(`✗ ${'1'.repeat(12)}: no Signed-off-by trailer`)
  })

  it('a forged bot email GitHub linked to the bot is still not exempt in a pull request a person opened', () => {
    // GitHub links commits to accounts by author email, so the linked account
    // alone can be forged too; only the pull request's opener cannot.
    const r = check(
      [{ ...bump('2'), authorLogin: 'dependabot[bot]', authorType: 'Bot' }],
      { prAuthor: ['mallory', 'User'] }
    )
    expect(r.code).toBe(1)
  })

  it('exempts an allowlisted bot commit in a pull request that bot opened', () => {
    const r = check(
      [{ ...bump('3'), authorLogin: 'dependabot[bot]', authorType: 'Bot' }],
      { prAuthor: ['dependabot[bot]', 'Bot'] }
    )
    expect(r).toEqual({ code: 0, out: '✓ all 1 commit(s) signed off\n' })
  })

  it('in a bot pull request, commits not linked to that bot still need a sign-off', () => {
    const r = check(
      [
        { ...bump('4'), authorLogin: 'dependabot[bot]', authorType: 'Bot' },
        // no linked account
        { ...bump('5') },
        // a different (non-allowlisted) bot, and a user account
        { ...bump('6'), authorLogin: 'evil-app[bot]', authorType: 'Bot' },
        { ...bump('7'), authorLogin: 'mallory', authorType: 'User' },
      ],
      { prAuthor: ['dependabot[bot]', 'Bot'] }
    )
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('4'.repeat(12))
    for (const c of ['5', '6', '7']) expect(r.out).toContain(c.repeat(12))
  })

  it('only allowlisted Bot-type accounts ending in [bot] count as bots', async () => {
    const mod = (await import(SCRIPT as string)) as {
      isAllowlistedBot: (login: unknown, type: unknown) => boolean
    }
    expect(mod.isAllowlistedBot('dependabot[bot]', 'Bot')).toBe(true)
    expect(mod.isAllowlistedBot('renovate[bot]', 'Bot')).toBe(true)
    expect(mod.isAllowlistedBot('github-actions[bot]', 'Bot')).toBe(true)
    expect(mod.isAllowlistedBot('dependabot[bot]', 'User')).toBe(false)
    expect(mod.isAllowlistedBot('dependabot', 'Bot')).toBe(false)
    expect(mod.isAllowlistedBot('other[bot]', 'Bot')).toBe(false)
    expect(mod.isAllowlistedBot(null, null)).toBe(false)
  })

  it('fails a pull request with more commits than GitHub lists instead of checking part of it', () => {
    const signedCommit = (i: number): Commit => ({
      sha: i.toString(16).padStart(40, '0'),
      message: signed('ada@example.com'),
      authorEmail: 'ada@example.com',
    })
    const listed = Array.from({ length: 250 }, (_, i) => signedCommit(i))
    const r = check(listed, { expected: 300 })
    expect(r.code).toBe(1)
    expect(r.out).toContain('has 300 commits; GitHub lists at most 250')
    expect(check(listed, { expected: 250 }).code).toBe(0)
  })

  it('fails when fewer commits are listed than the pull request has', () => {
    const r = check(
      [
        {
          sha: 'a'.repeat(40),
          message: signed('ada@example.com'),
          authorEmail: 'ada@example.com',
        },
      ],
      { expected: 2 }
    )
    expect(r.code).toBe(1)
    expect(r.out).toContain('only 1 of the pull request')
  })

  it('exits 2 on empty or malformed input instead of passing', () => {
    const args = ['--expected-commits', '1']
    expect(run('', args).code).toBe(2)
    expect(run('not json\n', args).code).toBe(2)
  })

  it('exits 2 without a valid --expected-commits', () => {
    const line = ndjson([bump('8')])
    expect(run(line, []).code).toBe(2)
    expect(run(line, ['--expected-commits', '0']).code).toBe(2)
    expect(run(line, ['--expected-commits', 'x']).code).toBe(2)
  })
})
