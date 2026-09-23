/**
 * @jest-environment node
 */
/**
 * LUM-825: the worktree step of `lumo session attach`, against real git.
 * Reports existing worktrees (all of them), hints when there are none,
 * creates one only when opted in and only from the main checkout, and never
 * turns a creation failure into a failed attach.
 */
import * as fs from 'fs'
import * as path from 'path'
import { attachWorktreeStep, slugFromTitle } from '../src/lib/worktree-attach'
import { sessionAttach } from '../src/commands/session-attach'
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
jest.mock('../src/lib/resolve-project', () => ({
  resolveBoundProjectId: async () => ({ ok: false }),
}))
jest.mock('../src/lib/memory-auto', () => ({
  autoDownsyncOnAttach: async () => ({ skipped: true }),
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

function worktreePaths(root: string): string[] {
  return git(root, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => l.slice('worktree '.length))
    .filter(p => p !== root)
}

function step(create: boolean | undefined, cwd: string) {
  return captureOutput(async () =>
    attachWorktreeStep({
      taskId: 'LUM-5',
      taskTitle: 'Fix the flaky thing now please',
      create,
      cwd,
    })
  )
}

describe('session attach worktree step', () => {
  it('reports, auto-creates only when opted in from the main checkout, and never fails attach', async () => {
    // 1. No worktree, not opted in → hint only, nothing created.
    const hint = await step(undefined, sb.main)
    expect(hint.out).toContain('lumo worktree add LUM-5')
    expect(worktreePaths(sb.main)).toEqual([])

    // 2. --no-worktree beats autoWorktree in config.
    fs.mkdirSync(path.join(sb.main, '.lumo'))
    fs.writeFileSync(
      path.join(sb.main, '.lumo', 'worktree.json'),
      JSON.stringify({ autoWorktree: true })
    )
    await step(false, sb.main)
    expect(worktreePaths(sb.main)).toEqual([])

    // 3. autoWorktree: true → created from the main checkout, slug from title.
    const created = await step(undefined, sb.main)
    const expected = path.join(
      sb.main,
      '.worktrees',
      'LUM-5-fix-the-flaky-thing'
    )
    expect(worktreePaths(sb.main)).toEqual([expected])
    expect(created.out).toContain(`cd ${expected}`)

    // 4. Re-attach reuses: reported by path, nothing new created.
    const again = await step(true, sb.main)
    expect(again.out).toContain(expected)
    expect(worktreePaths(sb.main)).toEqual([expected])

    // 5. From inside that worktree: marked as "you are here".
    const inside = await step(true, expected)
    expect(inside.out).toMatch(/you are here/)

    // 6. Several worktrees for the task → every one is listed.
    git(
      sb.main,
      'worktree',
      'add',
      '-q',
      '-b',
      'lumo/LUM-5-second',
      path.join(sb.main, '.worktrees', 'LUM-5-second')
    )
    const many = await step(undefined, sb.main)
    expect(many.out).toMatch(/2 worktrees match LUM-5/)
    expect(many.out).toContain(expected)
    expect(many.out).toContain(path.join(sb.main, '.worktrees', 'LUM-5-second'))

    // 7. Outside the main checkout (another task's linked worktree) with
    //    --worktree → nothing created for LUM-6.
    const other = path.join(sb.tmp, 'elsewhere')
    git(sb.main, 'worktree', 'add', '-q', '-b', 'scratch', other)
    const before = worktreePaths(sb.main).length
    const outside = await captureOutput(async () =>
      attachWorktreeStep({
        taskId: 'LUM-6',
        taskTitle: 'x',
        create: true,
        cwd: other,
      })
    )
    expect(outside.out).toMatch(/already runs in a linked worktree/)
    expect(worktreePaths(sb.main).length).toBe(before)

    // 8. Not a git repo → silent.
    const plain = fs.mkdtempSync(path.join(sb.tmp, 'plain-'))
    const none = await step(true, plain)
    expect(none.out).toBe('')
    expect(none.err).toBe('')

    // 9. Full attach whose worktree creation fails still succeeds.
    fs.mkdirSync(path.join(sb.main, '.worktrees', 'LUM-7-broken'), {
      recursive: true,
    })
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'bound',
            taskId: 'id7',
            taskIdentifier: 'LUM-7',
            taskTitle: 'Broken',
            retaggedEventCount: 0,
            memorySection: '',
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    const prevSession = process.env.CLAUDE_CODE_SESSION_ID
    process.env.CLAUDE_CODE_SESSION_ID = 'S-825'
    try {
      const attach = await captureOutput(() =>
        inDir(sb.main, () => sessionAttach('LUM-7', { worktree: true }))
      )
      expect(attach.result).toBeUndefined() // success path returns void → exit 0
      expect(attach.out).toContain('Attached session S-825 to LUM-7')
      expect(attach.err).toMatch(/could not create a worktree/)
    } finally {
      if (prevSession === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
      else process.env.CLAUDE_CODE_SESSION_ID = prevSession
    }
  })

  it('slugFromTitle keeps the first four words', () => {
    expect(slugFromTitle('Fix the flaky thing now please')).toBe(
      'fix-the-flaky-thing'
    )
    expect(slugFromTitle('  !!  ')).toBe('')
  })
})
