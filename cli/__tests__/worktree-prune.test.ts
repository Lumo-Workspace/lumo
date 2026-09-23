/**
 * @jest-environment node
 */
/**
 * LUM-825: `lumo worktree prune` — removes worktrees of DONE tasks (closed
 * anywhere, the local DONE cleanup never having run), keeps unsafe ones with
 * a reason, leaves non-DONE and unknown tasks alone, and is gated by the
 * confirmation envelope. Real git; the Lumo API is a fetch fake.
 */
import * as fs from 'fs'
import * as path from 'path'
import { worktreePrune } from '../src/commands/worktree-prune'
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

function addWorktree(name: string): string {
  const dir = path.join(sb.main, '.worktrees', name)
  git(
    sb.main,
    'worktree',
    'add',
    '-q',
    '-b',
    `lumo/${name}`,
    dir,
    'origin/master'
  )
  return dir
}

/** status per task id; a missing id answers 404. */
function fakeApi(statuses: Record<string, string>): void {
  global.fetch = jest.fn(async (url: string) => {
    const id = decodeURIComponent(String(url).split('/').pop() ?? '')
    const status = statuses[id]
    if (!status) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
      })
    }
    return new Response(
      JSON.stringify({ task: { identifier: id, status, pullRequests: [] } }),
      { status: 200 }
    )
  }) as unknown as typeof fetch
}

describe('worktree prune', () => {
  it('removes only safe worktrees of DONE tasks after confirmation', async () => {
    const doneClean = addWorktree('LUM-1-clean')
    const doneDirty = addWorktree('LUM-1-dirty')
    fs.writeFileSync(path.join(doneDirty, 'wip.txt'), 'wip\n')
    const doneOther = addWorktree('LUM-2')
    const inReview = addWorktree('LUM-3')
    const unknownTask = addWorktree('LUM-4')
    fakeApi({ 'LUM-1': 'DONE', 'LUM-2': 'DONE', 'LUM-3': 'IN_REVIEW' })

    // No --confirm → envelope, nothing removed.
    const env = await captureOutput(() =>
      inDir(sb.main, () => worktreePrune({}))
    )
    expect(env.result).toBe(EXIT_CONFIRMATION_REQUIRED)
    const { changes, confirmCommand } = JSON.parse(env.out) as {
      changes: string[]
      confirmCommand: string
    }
    const text = changes.join('\n')
    expect(text).toContain(`LUM-1 (DONE): Will remove worktree ${doneClean}`)
    expect(text).toContain(`LUM-2 (DONE): Will remove worktree ${doneOther}`)
    expect(text).toContain(
      `LUM-1 (DONE): Keeps worktree ${doneDirty}: it has uncommitted changes`
    )
    expect(text).not.toContain(inReview)
    expect(text).not.toContain(unknownTask)
    expect(text).toContain(
      '1 worktree(s) of tasks that are not DONE are left alone'
    )
    expect(text).toContain('1 worktree(s) whose task could not be looked up')
    expect(confirmCommand).toMatch(/--confirm$/)
    for (const d of [doneClean, doneDirty, doneOther, inReview, unknownTask]) {
      expect(fs.existsSync(d)).toBe(true)
    }

    // --confirm → only the removable ones go; branches stay.
    const run = await captureOutput(() =>
      inDir(sb.main, () => worktreePrune({ confirm: true }))
    )
    expect(run.result).toBe(0)
    expect(fs.existsSync(doneClean)).toBe(false)
    expect(fs.existsSync(doneOther)).toBe(false)
    for (const d of [doneDirty, inReview, unknownTask, sb.main]) {
      expect(fs.existsSync(d)).toBe(true)
    }
    expect(git(sb.main, 'branch', '--list', 'lumo/LUM-1-clean')).toContain(
      'lumo/LUM-1-clean'
    )
  })

  it('says there is nothing to prune without an envelope', async () => {
    addWorktree('LUM-3')
    fakeApi({ 'LUM-3': 'IN_PROGRESS' })
    const r = await captureOutput(() => inDir(sb.main, () => worktreePrune({})))
    expect(r.result).toBe(0)
    expect(r.out).toMatch(/Nothing to prune/)
  })
})
