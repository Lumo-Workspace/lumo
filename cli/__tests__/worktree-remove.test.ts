/**
 * @jest-environment node
 */
/**
 * LUM-971: removing a task worktree never leaves a half-deleted directory.
 *
 * Root cause (reproduced with real git): a dev server still running in the
 * worktree regenerates `app/.well-known/workflow/v1/**` while
 * `git worktree remove` deletes the tree; git's delete stops at the first
 * "Directory not empty" but still drops `.git/worktrees/<id>`, so the
 * worktree is unregistered while most files remain. `halfDeleteOnRemove`
 * reproduces exactly that end state around a real `git worktree remove`.
 *
 * Covered for both the DONE cleanup and `lumo worktree rm`:
 *   1. only ignored build output (node_modules, .next, workflow routes) → gone;
 *   2. real uncommitted changes → kept, with the reason;
 *   3. something that cannot be deleted → what is left + a cleanup command.
 */
import * as fs from 'fs'
import * as path from 'path'
import { spawn, spawnSync, execSync, type ChildProcess } from 'child_process'
import { taskUpdate } from '../src/commands/task-update'
import { worktreeRm } from '../src/commands/worktree-rm'
import { EXIT_CONFIRMATION_REQUIRED } from '../src/lib/confirmation'
import * as wt from '../src/lib/worktree'
import {
  parseLsofCwd,
  shellQuote,
  summarizeResidue,
} from '../src/lib/worktree-remove'
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
jest.mock('../src/lib/worktree', () => {
  const actual = jest.requireActual('../src/lib/worktree')
  return { ...actual, runGit: jest.fn(actual.runGit) }
})

const actualRunGit = jest.requireActual('../src/lib/worktree')
  .runGit as typeof wt.runGit
const runGit = wt.runGit as jest.Mock

// These tests drive real git plus the removal's own fixed waits (up to 3
// rounds of rmSync retries and a 300 ms settle, then a system-wide lsof scan),
// so a single case takes ~3-4 s on an idle machine — too close to jest's 5 s
// default once a full parallel run loads the machine (LUM-940).
jest.setTimeout(30_000)

let restoreEnv: () => void
let sb: Sandbox
const realFetch = global.fetch
/** Background processes a test started; all stopped before the sandbox is deleted. */
const children: ChildProcess[] = []

beforeAll(() => {
  restoreEnv = isolateGitEnv()
})
afterAll(() => {
  restoreEnv()
  global.fetch = realFetch
})
beforeEach(() => {
  sb = makeSandbox('master')
  fs.appendFileSync(
    path.join(sb.main, '.git', 'info', 'exclude'),
    '/.worktrees/\nnode_modules\n.next\n'
  )
  runGit.mockClear()
  runGit.mockImplementation(actualRunGit)
})
afterEach(async () => {
  jest.restoreAllMocks()
  // Even if a test timed out mid-way, no writer may still be running while the
  // sandbox is deleted (that raced into ENOTEMPTY).
  await Promise.all(children.splice(0).map(stop))
  sb.cleanup()
})

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

/** What `npm ci` + `next dev` leave in a worktree — all ignored by git. */
function addBuildOutput(dir: string): void {
  const write = (rel: string, body = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
  for (let i = 0; i < 20; i++) write(`node_modules/pkg${i}/index.js`)
  write('.next/cache/webpack/0.pack')
  // The workflow builder ignores its own output with a `*` .gitignore.
  write('app/.well-known/workflow/v1/.gitignore', '*')
  write('app/.well-known/workflow/v1/step/route.js')
  write('app/.well-known/workflow/v1/flow/route.js')
}

const WRITER_FILE = 'app/.well-known/workflow/v1/step/route.js'

/**
 * Make the next `git worktree remove` end like the real incident: git
 * unregisters the worktree, but a writer recreated files mid-delete so the
 * directory survives (tracked files included) and git exits non-zero.
 */
function halfDeleteOnRemove(): void {
  runGit.mockImplementation((args: string[], cwd?: string) => {
    if (args[0] !== 'worktree' || args[1] !== 'remove') {
      return actualRunGit(args, cwd)
    }
    const target = args[args.length - 1]!
    const snapshot = `${target}.snapshot`
    fs.cpSync(target, snapshot, { recursive: true })
    const r = actualRunGit(args, cwd)
    fs.cpSync(snapshot, target, { recursive: true })
    fs.rmSync(snapshot, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(path.join(target, WRITER_FILE)), {
      recursive: true,
    })
    fs.writeFileSync(path.join(target, WRITER_FILE), 'regenerated\n')
    return {
      ...r,
      status: 255,
      stderr: `error: failed to delete '${target}': Directory not empty\n`,
    }
  })
}

/** Track a background process so afterEach stops it before cleanup. */
function track(child: ChildProcess): ChildProcess {
  children.push(child)
  return child
}

/**
 * A writer that never stops (a dev server left running): a real background
 * process recreating the workflow route in a tight loop.
 *
 * It is one node process that never forks. A `sh` loop calling `mkdir -p`
 * left an in-flight `mkdir` running after the shell was killed, which
 * recreated the directory after `stop()` returned — racing the sandbox
 * cleanup into ENOTEMPTY or leaking the rebuilt tree in $TMPDIR (LUM-940).
 * Resolves only once the writer has written, so the removal really races a
 * live writer instead of one still starting up on a loaded machine.
 */
async function startWriter(dir: string): Promise<ChildProcess> {
  const file = path.join(dir, WRITER_FILE)
  const script =
    `const fs = require('fs'); const f = ${JSON.stringify(file)};` +
    ` const d = ${JSON.stringify(path.dirname(file))};` +
    ` for (;;) { try { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(f, 'r\\n') } catch {} }`
  const child = track(
    spawn(process.execPath, ['-e', script], { cwd: sb.tmp, stdio: 'ignore' })
  )
  const deadline = Date.now() + 20_000
  for (;;) {
    let body = ''
    try {
      body = fs.readFileSync(file, 'utf8')
    } catch {
      // not there yet, or mid-rewrite
    }
    if (body === 'r\n') return child
    if (Date.now() > deadline) throw new Error('writer did not start writing')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill()
  await exited
}

function registered(dir: string): boolean {
  return git(sb.main, 'worktree', 'list', '--porcelain')
    .split('\n')
    .includes(`worktree ${dir}`)
}

function fakeApi(): void {
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
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
          pullRequests: [],
        },
      }),
      { status: 200 }
    )
  }) as unknown as typeof fetch
}

function done() {
  fakeApi()
  return captureOutput(() =>
    inDir(sb.main, () => taskUpdate('LUM-3', { status: 'done', confirm: true }))
  )
}

function rm(opts: { force?: boolean } = {}) {
  return captureOutput(() =>
    inDir(sb.main, () => worktreeRm('LUM-3', { confirm: true, ...opts }))
  )
}

const lsofAvailable = !spawnSync('lsof', ['-v']).error

describe('DONE worktree cleanup (LUM-971)', () => {
  it('removes a worktree holding only ignored build output', async () => {
    const dir = addWorktree('LUM-3-built')
    addBuildOutput(dir)
    expect(git(dir, 'status', '--porcelain')).toBe('')

    const r = await done()
    expect(r.out).toContain(`✓ Removed worktree ${dir}`)
    expect(fs.existsSync(dir)).toBe(false)
    expect(registered(dir)).toBe(false)
  })

  it('finishes the delete when a dev server rewrites files mid-remove', async () => {
    const dir = addWorktree('LUM-3-devserver')
    addBuildOutput(dir)
    halfDeleteOnRemove()

    const r = await done()
    expect(r.out).toContain(`✓ Removed worktree ${dir}`)
    expect(r.err).not.toContain('Directory not empty')
    expect(fs.existsSync(dir)).toBe(false)
    expect(registered(dir)).toBe(false)
  })

  it('keeps a worktree with real uncommitted changes and says why', async () => {
    const dir = addWorktree('LUM-3-wip')
    addBuildOutput(dir)
    fs.writeFileSync(path.join(dir, 'wip.txt'), 'wip\n')
    fs.appendFileSync(path.join(dir, 'README.md'), 'edit\n')

    const r = await done()
    expect(r.out).toContain(`Keeps worktree ${dir}: it has uncommitted changes`)
    expect(runGit).not.toHaveBeenCalledWith(
      expect.arrayContaining(['worktree', 'remove']),
      expect.anything()
    )
    expect(registered(dir)).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'wip.txt'), 'utf8')).toBe('wip\n')
  })

  it('reports what is left and a runnable cleanup command when it cannot finish', async () => {
    const dir = addWorktree('LUM-3-stuck')
    addBuildOutput(dir)
    halfDeleteOnRemove()
    const sleeper = track(spawn('sleep', ['30'], { cwd: dir, stdio: 'ignore' }))
    const writer = await startWriter(dir)
    try {
      const r = await done()
      expect(r.out).not.toContain(`✓ Removed worktree ${dir}`)
      expect(r.err).toContain(`⚠ worktree ${dir} is unregistered`)
      expect(r.err).toContain('Left behind: app/ (1 file)')
      if (lsofAvailable) {
        expect(r.err).toContain(`Still running inside it: pid ${sleeper.pid}`)
      }
      const cmd = `rm -rf ${shellQuote(dir)}`
      expect(r.err).toContain(`Clean up with: ${cmd}`)
      expect(registered(dir)).toBe(false)

      // Once the writer is stopped, the printed command finishes the job.
      await stop(writer)
      execSync(cmd, { shell: '/bin/sh' })
      expect(fs.existsSync(dir)).toBe(false)
    } finally {
      await stop(writer)
      await stop(sleeper)
    }
  })
})

describe('lumo worktree rm (LUM-971)', () => {
  it('removes a worktree holding only ignored build output, even mid-write', async () => {
    const dir = addWorktree('LUM-3-built')
    addBuildOutput(dir)
    halfDeleteOnRemove()

    const r = await rm()
    expect(r.result).toBe(0)
    expect(r.out).toContain(`✓ Removed worktree ${dir}`)
    expect(fs.existsSync(dir)).toBe(false)
    expect(registered(dir)).toBe(false)
  })

  it('keeps a worktree with real uncommitted changes without --force', async () => {
    const dir = addWorktree('LUM-3-wip')
    addBuildOutput(dir)
    fs.writeFileSync(path.join(dir, 'wip.txt'), 'wip\n')

    const r = await rm()
    expect(r.result).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(r.out).toContain('uncommitted changes')
    expect(registered(dir)).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'wip.txt'), 'utf8')).toBe('wip\n')
  })

  it('reports what is left and a cleanup command, exiting 1', async () => {
    const dir = addWorktree('LUM-3-stuck')
    addBuildOutput(dir)
    halfDeleteOnRemove()
    const writer = await startWriter(dir)
    try {
      const r = await rm()
      expect(r.result).toBe(1)
      expect(r.out).not.toContain(`✓ Removed worktree ${dir}`)
      expect(r.err).toContain('Left behind: app/ (1 file)')
      expect(r.err).toContain(`Clean up with: rm -rf ${shellQuote(dir)}`)
      expect(registered(dir)).toBe(false)
    } finally {
      await stop(writer)
    }
  })
})

describe('worktree-remove helpers (LUM-971)', () => {
  it('shellQuote survives spaces and single quotes', () => {
    expect(shellQuote("/a b/it's")).toBe(`'/a b/it'\\''s'`)
  })

  it('summarizeResidue lists top-level entries with file counts', () => {
    const dir = path.join(sb.tmp, 'residue')
    fs.mkdirSync(path.join(dir, 'app', 'x'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app', 'x', 'a.js'), '')
    fs.writeFileSync(path.join(dir, 'app', 'b.js'), '')
    fs.writeFileSync(path.join(dir, '.env.local'), '')
    expect(summarizeResidue(dir)).toEqual(['.env.local', 'app/ (2 files)'])
  })

  it('parseLsofCwd keeps only processes whose cwd is inside the dir', () => {
    const out = [
      'p10',
      'cnode',
      'fcwd',
      'n/repo/.worktrees/LUM-3-x',
      'p11',
      'cesbuild',
      'fcwd',
      'n/repo/.worktrees/LUM-3-x/app',
      'p12',
      'czsh',
      'fcwd',
      'n/repo/.worktrees/LUM-3-xy',
    ].join('\n')
    expect(parseLsofCwd(out, '/repo/.worktrees/LUM-3-x')).toEqual([
      'pid 10 (node)',
      'pid 11 (esbuild)',
    ])
  })
})
