/**
 * @jest-environment node
 */
/**
 * LUM-825: `lumo task update <id> --status done` also cleans up the task's
 * local worktrees — listed in the DONE envelope first, removed only after
 * --confirm and a successful DONE, and only when nothing can be lost.
 * Real git; the Lumo API is a fetch fake.
 */
import * as fs from 'fs'
import * as path from 'path'
import { taskUpdate } from '../src/commands/task-update'
import { EXIT_CONFIRMATION_REQUIRED } from '../src/lib/confirmation'
import {
  captureOutput,
  git,
  inDir,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '../test-support/real-git'

jest.mock('../src/lib/config', () => ({
  readCredentials: () => ({ token: 't', apiUrl: 'https://lumo.test' }),
}))

let restoreEnv: () => void
let sb: Sandbox
const realFetch = global.fetch

beforeAll(() => {
  restoreEnv = isolateGitEnv()
})
afterAll(() => {
  restoreEnv()
  global.fetch = realFetch
})
beforeEach(() => {
  sb = makeSandbox('master')
})
afterEach(() => sb.cleanup())

function addWorktree(name: string, branch = `lumo/${name}`): string {
  const dir = path.join(sb.main, '.worktrees', name)
  git(sb.main, 'worktree', 'add', '-q', '-b', branch, dir, 'origin/master')
  return dir
}

function commit(dir: string, file: string): string {
  fs.writeFileSync(path.join(dir, file), `${file}\n`)
  git(dir, 'add', file)
  git(dir, 'commit', '-q', '-m', file)
  return git(dir, 'rev-parse', 'HEAD')
}

function exists(dir: string): boolean {
  return fs.existsSync(dir)
}

function fakeApi(mergedHeadShas: string[]): jest.Mock {
  const fn = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return new Response(
        JSON.stringify({
          task: { id: 'id3', identifier: 'LUM-3', title: 'T', url: 'u' },
          nextSteps: [],
        }),
        { status: 200 }
      )
    }
    return new Response(
      JSON.stringify({
        task: {
          identifier: 'LUM-3',
          title: 'T',
          status: 'IN_REVIEW',
          pullRequests: mergedHeadShas.map((sha, i) => ({
            number: i + 1,
            title: `pr ${i + 1}`,
            url: null,
            state: 'merged',
            headSha: sha,
          })),
        },
      }),
      { status: 200 }
    )
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('task update DONE', () => {
  it('cleans up only safe worktrees listed in the envelope', async () => {
    // Ignored-but-present files (a node_modules link) must not block removal.
    fs.appendFileSync(
      path.join(sb.main, '.git', 'info', 'exclude'),
      '/.worktrees/\nnode_modules\n'
    )
    const clean = addWorktree('LUM-3-clean')
    fs.symlinkSync(sb.main, path.join(clean, 'node_modules'))

    const dirty = addWorktree('LUM-3-dirty')
    fs.writeFileSync(path.join(dirty, 'wip.txt'), 'wip\n')

    const local = addWorktree('LUM-3-local')
    commit(local, 'local.txt')

    const squashed = addWorktree('LUM-3-squashed')
    const squashedHead = commit(squashed, 'squashed.txt')

    const after = addWorktree('LUM-3-after')
    const mergedHead = commit(after, 'merged.txt')
    commit(after, 'added-after-merge.txt')

    const here = addWorktree('LUM-3-here')
    const otherTask = addWorktree('LUM-4')

    fakeApi([squashedHead, mergedHead])

    // Step 1 — no --confirm: envelope lists every LUM-3 worktree, removes none.
    const env = await captureOutput(() =>
      inDir(here, () => taskUpdate('LUM-3', { status: 'done' }))
    )
    expect(env.result).toBe(EXIT_CONFIRMATION_REQUIRED)
    const { changes } = JSON.parse(env.out) as { changes: string[] }
    const text = changes.join('\n')
    expect(text).toContain(
      `Will remove worktree ${clean} (branch lumo/LUM-3-clean kept)`
    )
    expect(text).toContain(`Will remove worktree ${squashed}`)
    expect(text).toContain(
      `Keeps worktree ${dirty}: it has uncommitted changes`
    )
    expect(text).toMatch(
      new RegExp(`Keeps worktree ${local}: 1 commit not pushed`)
    )
    expect(text).toMatch(
      new RegExp(`Keeps worktree ${after}: 2 commits not pushed`)
    )
    expect(text).toContain(
      `Keeps worktree ${here}: the current directory is inside it`
    )
    expect(text).not.toContain(otherTask)
    expect(text).not.toContain(`worktree ${sb.main} `)
    for (const d of [clean, dirty, local, squashed, after, here]) {
      expect(exists(d)).toBe(true)
    }

    // Step 2 — the user confirmed: DONE lands, then only the safe ones go.
    const done = await captureOutput(() =>
      inDir(here, () => taskUpdate('LUM-3', { status: 'done', confirm: true }))
    )
    expect(done.result).toBeUndefined()
    expect(done.out).toContain(`✓ Removed worktree ${clean}`)
    expect(done.out).toContain(`✓ Removed worktree ${squashed}`)
    expect(exists(clean)).toBe(false)
    expect(exists(squashed)).toBe(false)
    for (const d of [dirty, local, after, here, otherTask, sb.main]) {
      expect(exists(d)).toBe(true)
    }
    // Uncommitted work survives — no --force anywhere.
    expect(fs.readFileSync(path.join(dirty, 'wip.txt'), 'utf8')).toBe('wip\n')
    // Branches are kept, including those of removed worktrees.
    const branches = git(sb.main, 'branch', '--list', 'lumo/*')
    for (const b of ['clean', 'squashed', 'dirty', 'local', 'after', 'here']) {
      expect(branches).toContain(`lumo/LUM-3-${b}`)
    }
  })

  it('a DONE refused by the server removes nothing', async () => {
    const clean = addWorktree('LUM-3-clean')
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: 'nope' }), { status: 400 })
    ) as unknown as typeof fetch
    const r = await captureOutput(() =>
      inDir(sb.main, () =>
        taskUpdate('LUM-3', { status: 'done', confirm: true })
      )
    )
    expect(r.result).toBe(1)
    expect(exists(clean)).toBe(true)
  })
})
