/**
 * @jest-environment node
 */
/**
 * LUM-1259 — the local scan log hooks `lumo init --scan-hooks --scan-log`
 * installs, on throwaway git repos (never this repo's own .git): post-commit
 * records the new commit with its real sha, pre-push each commit being
 * pushed, both only while `git config lumo.scanLog` is true, in the
 * background, and never blocking or failing the commit or push. `lumo` is a
 * stub on PATH that logs its arguments and exits as told.
 */
import { execFileSync, spawnSync } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { init, installGitHook } from '@/cli/src/commands/init'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { planUninstall, uninstall } from '@/cli/src/commands/uninstall'
import { initApplyCommand, planInit } from '@/cli/src/lib/init-dry-run'
import {
  POST_COMMIT_LOG_BLOCK,
  POST_COMMIT_LOG_HOOK,
  PRE_PUSH_SCAN_HOOK,
  SCAN_HOOK_TIMEOUT_SECONDS,
  scanHookFor,
} from '@/cli/src/lib/scan-hook-template'
import { git, isolateGitEnv } from '@/cli/test-support/real-git'

jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: jest.fn(() => '2.0.0'),
  findCliPackageRoot: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let roots: string[]
let restoreGit: () => void
let prevConfigDir: string | undefined
let stdout: string
let stderr: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-scan-log-')))
  roots.push(d)
  return d
}

beforeAll(() => {
  restoreGit = isolateGitEnv()
})
afterAll(() => restoreGit())
beforeEach(() => {
  roots = []
  stdout = ''
  stderr = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(c => {
    stderr += String(c)
    return true
  })
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

/** init's deps for a repo (CLI 2.0.0: no bundled skill, no scope). */
function initDeps(project: string) {
  return {
    cliVersion: '2.0.0',
    cwd: project,
    isGlobalInstall: () => false,
  }
}

function repoWithCommit(): string {
  const dir = tmp()
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

const hooksDir = (repo: string): string => join(repo, '.git', 'hooks')

/** git + a stub `lumo` that appends its arguments to $LUMO_LOG and exits $LUMO_RC. */
function hookPath(withLumo = true): string {
  const tools = tmp()
  const gitBin = execFileSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
  }).trim()
  symlinkSync(gitBin, join(tools, 'git'))
  if (withLumo) {
    writeFileSync(
      join(tools, 'lumo'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$LUMO_LOG"\nprintf \'%s\\n\' "${LUMO_OUT:-scan: 0 findings (0 high, 0 medium, 0 low)}"\nexit "${LUMO_RC:-0}"\n'
    )
    chmodSync(join(tools, 'lumo'), 0o755)
  }
  return `${tools}:/usr/bin:/bin`
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
  calls: () => string[]
}

function runGit(
  cwd: string,
  args: string[],
  opts: { rc?: number; withLumo?: boolean; foreground?: boolean } = {}
): Run {
  const log = join(tmp(), 'lumo.log')
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: hookPath(opts.withLumo !== false),
      LUMO_LOG: log,
      LUMO_RC: String(opts.rc ?? 0),
      ...(opts.foreground === false ? {} : { LUMO_SCAN_LOG_FOREGROUND: '1' }),
    },
  })
  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8').split('\n').filter(Boolean)
        : [],
  }
}

function commitFile(repo: string, file: string, msg: string): Run {
  writeFileSync(join(repo, file), `${file}\n`)
  git(repo, 'add', file)
  return runGit(repo, ['commit', '-q', '-m', msg])
}

const SCAN = `security scan --fail-on done --timeout ${SCAN_HOOK_TIMEOUT_SECONDS}`

describe('post-commit log hook', () => {
  function repoWithHook(on = true): string {
    const repo = repoWithCommit()
    expect(installGitHook(repo, POST_COMMIT_LOG_HOOK)).toBe(
      join(hooksDir(repo), 'post-commit')
    )
    if (on) git(repo, 'config', 'lumo.scanLog', 'true')
    return repo
  }

  it('records the new commit with its real sha, in the hook trigger', () => {
    const repo = repoWithHook()
    const r = commitFile(repo, 'a.txt', 'a')
    const sha = git(repo, 'rev-parse', 'HEAD')
    expect(r.status).toBe(0)
    expect(r.calls()).toEqual([
      `security scan --commit ${sha} --hook post-commit --log`,
    ])
    // Output is discarded: the commit prints nothing of the scan.
    expect(r.stderr).toBe('')
  })

  it('does nothing while lumo.scanLog is unset or false', () => {
    const repo = repoWithHook(false)
    expect(commitFile(repo, 'a.txt', 'a').calls()).toEqual([])
    git(repo, 'config', 'lumo.scanLog', 'false')
    expect(commitFile(repo, 'b.txt', 'b').calls()).toEqual([])
  })

  it('records an amend as its new sha (the patch-id ties it to the old one)', () => {
    const repo = repoWithHook()
    commitFile(repo, 'a.txt', 'a')
    const r = runGit(repo, ['commit', '-q', '--amend', '-m', 'a, reworded'])
    const sha = git(repo, 'rev-parse', 'HEAD')
    expect(r.calls()).toEqual([
      `security scan --commit ${sha} --hook post-commit --log`,
    ])
  })

  it.each([1, 2, 3])('never fails the commit, whatever lumo exits (%i)', rc => {
    const repo = repoWithHook()
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', `rc${rc}`], { rc })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(git(repo, 'log', '-1', '--format=%s')).toBe(`rc${rc}`)
  })

  it('a failing log run cannot stop the rest of the hook under set -e', () => {
    const repo = repoWithCommit()
    mkdirSync(hooksDir(repo), { recursive: true })
    writeFileSync(
      join(hooksDir(repo), 'post-commit'),
      `#!/bin/sh\nset -e\n${POST_COMMIT_LOG_BLOCK}\necho after >> "$LUMO_LOG"\n`
    )
    chmodSync(join(hooksDir(repo), 'post-commit'), 0o755)
    git(repo, 'config', 'lumo.scanLog', 'true')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'x'], { rc: 1 })
    expect(r.status).toBe(0)
    expect(r.calls()).toHaveLength(2)
    expect(r.calls()[1]).toBe('after')
  })

  it('is silent when lumo is not on PATH', () => {
    if (existsSync('/usr/bin/lumo') || existsSync('/bin/lumo')) return
    const repo = repoWithHook()
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'x'], { withLumo: false })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
  })

  it('runs in the background by default: the commit does not wait for it', async () => {
    const repo = repoWithHook()
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'bg'], { foreground: false })
    expect(r.status).toBe(0)
    const sha = git(repo, 'rev-parse', 'HEAD')
    const deadline = Date.now() + 5000
    while (r.calls().length === 0 && Date.now() < deadline)
      await new Promise(res => setTimeout(res, 50))
    expect(r.calls()).toEqual([
      `security scan --commit ${sha} --hook post-commit --log`,
    ])
  })

  it('keeps a foreign post-commit hook and runs after it', () => {
    const repo = repoWithCommit()
    mkdirSync(hooksDir(repo), { recursive: true })
    writeFileSync(
      join(hooksDir(repo), 'post-commit'),
      '#!/bin/sh\necho foreign >> "$LUMO_LOG"\n'
    )
    chmodSync(join(hooksDir(repo), 'post-commit'), 0o755)
    installGitHook(repo, POST_COMMIT_LOG_HOOK)
    git(repo, 'config', 'lumo.scanLog', 'true')
    const r = commitFile(repo, 'a.txt', 'a')
    const sha = git(repo, 'rev-parse', 'HEAD')
    expect(r.calls()).toEqual([
      'foreign',
      `security scan --commit ${sha} --hook post-commit --log`,
    ])
  })
})

describe('pre-push hook with the log on', () => {
  function pushRepo(on: boolean): { repo: string; remote: string } {
    const remote = tmp()
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    const repo = repoWithCommit()
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')
    installGitHook(repo, PRE_PUSH_SCAN_HOOK)
    if (on) git(repo, 'config', 'lumo.scanLog', 'true')
    return { repo, remote }
  }

  it('records each pushed range next to the blocking scan', () => {
    const { repo } = pushRepo(true)
    const before = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '-m', 'a')
    const sha = git(repo, 'rev-parse', 'HEAD')
    const r = runGit(repo, ['push', '-q', 'origin', 'main'])
    expect(r.status).toBe(0)
    expect(r.calls()).toEqual([
      `${SCAN} --since ${before} --until ${sha}`,
      `security scan --since ${before} --until ${sha} --hook pre-push --log`,
    ])
  })

  it('records a new branch from the merge-base (no --since)', () => {
    const { repo } = pushRepo(true)
    git(repo, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(repo, 'f.txt'), 'f\n')
    git(repo, 'add', 'f.txt')
    git(repo, 'commit', '-q', '-m', 'f')
    const sha = git(repo, 'rev-parse', 'HEAD')
    const r = runGit(repo, ['push', '-q', 'origin', 'feature'])
    expect(r.calls()).toEqual([
      `${SCAN} --until ${sha}`,
      `security scan --until ${sha} --hook pre-push --log`,
    ])
  })

  it('records nothing while the log is off (the LUM-1258 hook as before)', () => {
    const { repo } = pushRepo(false)
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '-m', 'a')
    const r = runGit(repo, ['push', '-q', 'origin', 'main'])
    expect(r.calls()).toHaveLength(1)
    expect(r.calls()[0]).toContain(SCAN)
  })

  it('a failing log run never fails the push (only the scan verdict counts)', () => {
    const { repo } = pushRepo(true)
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', 'a.txt')
    git(repo, 'commit', '-q', '-m', 'a')
    // rc 1: the scan "could not run" (fails open), the log run fails too.
    const r = runGit(repo, ['push', '-q', 'origin', 'main'], { rc: 1 })
    expect(r.status).toBe(0)
    expect(r.calls()).toHaveLength(2)
  })
})

describe('lumo init --scan-log', () => {
  it('with --scan-hooks: installs post-commit and turns lumo.scanLog on', async () => {
    const repo = repoWithCommit()
    const code = await init(
      { agent: 'claude-code', scanHooks: true, scanLog: true },
      initDeps(repo)
    )
    expect(code ?? 0).toBe(0)
    expect(readFileSync(join(hooksDir(repo), 'post-commit'), 'utf8')).toContain(
      POST_COMMIT_LOG_BLOCK
    )
    expect(git(repo, 'config', '--bool', 'lumo.scanLog')).toBe('true')
    expect(stdout).toContain('local scan log on for this repo')
    expect(stdout).toContain('--local-scan-log on')
  })

  it('leaves lumo.scanLog off when the post-commit hook could not be installed (core.hooksPath)', async () => {
    const repo = repoWithCommit()
    git(repo, 'config', 'core.hooksPath', tmp())
    await init(
      { agent: 'claude-code', scanHooks: true, scanLog: true },
      initDeps(repo)
    )
    expect(
      spawnSync('git', ['config', '--bool', 'lumo.scanLog'], {
        cwd: repo,
        encoding: 'utf8',
      }).stdout.trim()
    ).toBe('')
    expect(stdout).toContain('local scan log not turned on')
    expect(stdout).toContain('git config lumo.scanLog true')
    expect(stdout).not.toContain('local scan log on for this repo')
  })

  it('uninstall turns lumo.scanLog off in the repo even when the hooks dir is outside it', async () => {
    const repo = repoWithCommit()
    const deps = initDeps(repo)
    await init({ agent: 'claude-code', scanHooks: true, scanLog: true }, deps)
    const outside = tmp()
    writeFileSync(
      join(outside, 'post-commit'),
      readFileSync(join(hooksDir(repo), 'post-commit'), 'utf8')
    )
    git(repo, 'config', 'core.hooksPath', outside)
    const doctorDeps = {
      homeDir: tmp(),
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    expect(await uninstall({ agent: 'git', confirm: true }, doctorDeps)).toBe(0)
    expect(existsSync(join(outside, 'post-commit'))).toBe(false)
    expect(
      spawnSync('git', ['config', '--bool', 'lumo.scanLog'], {
        cwd: repo,
        encoding: 'utf8',
      }).stdout.trim()
    ).toBe('')
  })

  it('without --scan-hooks is a usage error (exit 2) and writes nothing', async () => {
    const repo = repoWithCommit()
    const code = await init(
      { agent: 'claude-code', scanLog: true },
      initDeps(repo)
    )
    expect(code).toBe(2)
    expect(stderr).toContain('--scan-log extends the scan hooks')
    expect(existsSync(join(hooksDir(repo), 'post-commit'))).toBe(false)
  })

  it('--dry-run lists the post-commit hook and the apply command carries --scan-log', () => {
    const repo = repoWithCommit()
    const items = planInit({
      tokens: ['claude-code'],
      root: repo,
      scanHooks: true,
      scanLog: true,
    })
    expect(items.map(i => i.label).filter(Boolean)).toEqual([
      'pre-commit scan hook',
      'pre-push scan hook',
      'post-commit scan hook',
    ])
    expect(initApplyCommand({ scanHooks: true, scanLog: true })).toBe(
      'lumo init --scan-hooks --scan-log'
    )
  })

  it('doctor lists it; uninstall strips it and turns lumo.scanLog off', async () => {
    const repo = repoWithCommit()
    const deps = initDeps(repo)
    await init({ agent: 'claude-code', scanHooks: true, scanLog: true }, deps)
    const doctorDeps = {
      homeDir: tmp(),
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    const hook = join(hooksDir(repo), 'post-commit')
    const row = collectDoctor(doctorDeps).rows.find(r => r.path === hook)
    expect(row).toMatchObject({
      kind: 'scan-hook',
      agent: 'git',
      state: 'up to date',
    })
    expect(row?.detail).toContain('never blocks a commit')
    expect(scanHookFor(hook)).toBe(POST_COMMIT_LOG_HOOK)

    writeFileSync(hook, readFileSync(hook, 'utf8').replace('--log', '--logx'))
    expect(
      collectDoctor(doctorDeps).rows.find(r => r.path === hook)?.suggestion
    ).toBe('lumo init --scan-hooks --scan-log')

    const plan = planUninstall({ agent: 'git' }, doctorDeps)
    expect(
      plan.actions
        .filter(a => a.action === 'strip-scan-hook')
        .map(a => a.row.path)
    ).toContain(hook)
    expect(await uninstall({ agent: 'git', confirm: true }, doctorDeps)).toBe(0)
    expect(existsSync(hook)).toBe(false)
    expect(
      spawnSync('git', ['config', '--bool', 'lumo.scanLog'], {
        cwd: repo,
        encoding: 'utf8',
      }).stdout.trim()
    ).toBe('')
  })
})
