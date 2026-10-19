/**
 * @jest-environment node
 */
/**
 * LUM-1258 — the opt-in scan hooks `lumo init --scan-hooks` installs, on real
 * git repos: init / dry-run / doctor / uninstall, coexistence with an existing
 * hook and husky, and what each hook does with each `lumo security scan` exit
 * code. `lumo` is a stub on PATH that logs its arguments and exits as told, so
 * these tests pin the hook's shell logic; the scan's own `--fail-on done`
 * verdict is covered in lum1258-security-scan-hook-flags.test.ts.
 */
import { execFileSync, spawnSync } from 'child_process'
import {
  appendFileSync,
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
import { readRegistry } from '@/cli/src/lib/install-registry'
import {
  PRE_COMMIT_SCAN_BLOCK,
  PRE_COMMIT_SCAN_HOOK,
  PRE_PUSH_SCAN_BLOCK,
  PRE_PUSH_SCAN_HOOK,
  SCAN_HOOK_TIMEOUT_SECONDS,
} from '@/cli/src/lib/scan-hook-template'
import {
  git,
  isolateGitEnv,
  makeSandbox,
  type Sandbox,
} from '@/cli/test-support/real-git'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))
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
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-scan-hooks-')))
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

/** A bundled skill + fake home, the way init's deps take them. */
function initDeps(project: string) {
  const bundled = join(tmp(), 'skill')
  mkdirSync(join(bundled, 'references'), { recursive: true })
  writeFileSync(join(bundled, 'SKILL.md'), 'body')
  writeFileSync(join(bundled, 'references', 'a.md'), 'ref')
  return {
    cliVersion: '2.0.0',
    homeDir: tmp(),
    cwd: project,
    bundledSkillDir: bundled,
    isGlobalInstall: () => false,
  }
}

function plainRepo(): string {
  const dir = tmp()
  git(dir, 'init', '-q', '-b', 'main')
  return dir
}

const hooksDir = (repo: string): string => join(repo, '.git', 'hooks')

// ── the hook scripts against a stub `lumo` ─────────────────────────────────

/**
 * A PATH with git and a stub `lumo` that appends its arguments to $LUMO_LOG,
 * prints $LUMO_OUT and exits $LUMO_RC. `withLumo: false` leaves `lumo` out.
 */
function hookPath(withLumo = true): string {
  const tools = tmp()
  const gitBin = execFileSync('sh', ['-c', 'command -v git'], {
    encoding: 'utf8',
  }).trim()
  symlinkSync(gitBin, join(tools, 'git'))
  if (withLumo) {
    writeFileSync(
      join(tools, 'lumo'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$LUMO_LOG"\n[ -n "$LUMO_OUT" ] && printf \'%s\\n\' "$LUMO_OUT"\nexit "${LUMO_RC:-0}"\n'
    )
    chmodSync(join(tools, 'lumo'), 0o755)
  }
  return `${tools}:/usr/bin:/bin`
}

interface Run {
  status: number | null
  stderr: string
  /** The `lumo` invocations, one line of arguments each. */
  calls: string[]
}

function runGit(
  cwd: string,
  args: string[],
  opts: { rc?: number; out?: string; withLumo?: boolean } = {}
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
      LUMO_OUT: opts.out ?? 'scan: 0 findings (0 high, 0 medium, 0 low)',
    },
  })
  return {
    status: res.status,
    stderr: res.stderr,
    calls: existsSync(log)
      ? readFileSync(log, 'utf8').split('\n').filter(Boolean)
      : [],
  }
}

const SCAN_ARGS = `security scan --fail-on done --timeout ${SCAN_HOOK_TIMEOUT_SECONDS}`
const ONE_LOW = 'scan: 1 finding (0 high, 0 medium, 1 low)\n  • [LOW] …'
const ONE_HIGH = 'scan: 1 finding (1 high, 0 medium, 0 low)\n  • [HIGH] …'

function stage(repo: string, file: string, text = 'x\n'): void {
  writeFileSync(join(repo, file), text)
  git(repo, 'add', file)
}
const head = (repo: string): string => git(repo, 'log', '-1', '--format=%s')

describe('pre-commit scan hook', () => {
  function repoWithHook(): string {
    const repo = plainRepo()
    stage(repo, 'README.md')
    git(repo, 'commit', '-q', '-m', 'init')
    expect(installGitHook(repo, PRE_COMMIT_SCAN_HOOK)).toBe(
      join(hooksDir(repo), 'pre-commit')
    )
    return repo
  }

  it('scans the staged changes and stays silent on a clean scan', () => {
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'clean'])
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([`${SCAN_ARGS} --staged`])
    expect(r.stderr).toBe('')
    expect(head(repo)).toBe('clean')
  })

  it('blocks on exit 3 (a finding that would block DONE) and names --no-verify', () => {
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'high'], {
      rc: 3,
      out: ONE_HIGH,
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('[HIGH]')
    expect(r.stderr).toContain('lumo: commit blocked')
    expect(r.stderr).toContain('git commit --no-verify')
    expect(head(repo)).toBe('init')
  })

  it('only warns on findings that would not block DONE (exit 0)', () => {
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'low'], { out: ONE_LOW })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('[LOW]')
    expect(r.stderr).toContain('lumo: warning only — not blocking the commit.')
    expect(head(repo)).toBe('low')
  })

  it.each([1, 2])('fails open on exit %i and says so', rc => {
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', `rc${rc}`], {
      rc,
      out: 'Error: something broke',
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('Error: something broke')
    expect(r.stderr).toContain(
      `lumo: security scan could not run (exit ${rc}) — not blocking the commit.`
    )
    expect(head(repo)).toBe(`rc${rc}`)
  })

  it('fails open when lumo is not on PATH, and says so', () => {
    if (existsSync('/usr/bin/lumo') || existsSync('/bin/lumo')) return
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '-m', 'no lumo'], {
      withLumo: false,
    })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('lumo: not on PATH — pre-commit security scan')
    expect(head(repo)).toBe('no lumo')
  })

  it('is skipped by git commit --no-verify', () => {
    const repo = repoWithHook()
    stage(repo, 'a.txt')
    const r = runGit(repo, ['commit', '-q', '--no-verify', '-m', 'skip'], {
      rc: 3,
    })
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([])
    expect(head(repo)).toBe('skip')
  })

  it('runs after an existing hook, keeps it, and never exit-0s past what follows', () => {
    const repo = plainRepo()
    const hook = join(hooksDir(repo), 'pre-commit')
    const marks = join(tmp(), 'marks')
    const mine = `#!/bin/sh\necho before >> "${marks}"\n`
    writeFileSync(hook, mine)
    chmodSync(hook, 0o755)
    installGitHook(repo, PRE_COMMIT_SCAN_HOOK)
    expect(stdout).toContain('appended to pre-commit hook')
    const text = readFileSync(hook, 'utf8')
    expect(text.startsWith(mine)).toBe(true)
    expect(text).toContain(PRE_COMMIT_SCAN_BLOCK)
    // Something the user adds after the block still runs on a pass.
    appendFileSync(hook, `echo after >> "${marks}"\n`)
    stage(repo, 'a.txt')
    expect(runGit(repo, ['commit', '-q', '-m', 'ok']).status).toBe(0)
    expect(readFileSync(marks, 'utf8')).toBe('before\nafter\n')
  })

  it('is idempotent: a second install leaves the file byte-identical', () => {
    const repo = repoWithHook()
    const before = readFileSync(join(hooksDir(repo), 'pre-commit'), 'utf8')
    installGitHook(repo, PRE_COMMIT_SCAN_HOOK)
    expect(stdout).toContain('pre-commit hook already up to date')
    expect(readFileSync(join(hooksDir(repo), 'pre-commit'), 'utf8')).toBe(
      before
    )
  })

  it('under core.hooksPath (husky) prints the block instead of writing', () => {
    const repo = plainRepo()
    git(repo, 'config', 'core.hooksPath', '.husky/_')
    expect(installGitHook(repo, PRE_COMMIT_SCAN_HOOK)).toBeNull()
    expect(existsSync(join(repo, '.husky', '_', 'pre-commit'))).toBe(false)
    expect(existsSync(join(hooksDir(repo), 'pre-commit'))).toBe(false)
    expect(stdout).toContain('.husky/pre-commit')
    expect(stdout).toContain(PRE_COMMIT_SCAN_BLOCK)
  })
})

describe('pre-push scan hook', () => {
  let sb: Sandbox
  beforeEach(() => {
    sb = makeSandbox('main')
    roots.push(sb.tmp)
    installGitHook(sb.main, PRE_PUSH_SCAN_HOOK)
    git(sb.main, 'checkout', '-q', '-b', 'feature')
    stage(sb.main, 'a.txt')
    git(sb.main, 'commit', '-q', '-m', 'one')
  })
  const remoteHas = (ref: string): boolean =>
    spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: sb.remote,
    }).status === 0

  it('scans a new branch from the merge-base (--until alone)', () => {
    const sha = git(sb.main, 'rev-parse', 'HEAD')
    const r = runGit(sb.main, ['push', '-q', 'origin', 'feature'])
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([`${SCAN_ARGS} --until ${sha}`])
    expect(remoteHas('refs/heads/feature')).toBe(true)
  })

  it('scans only the new commits of a branch the remote has', () => {
    git(sb.main, 'push', '-q', '--no-verify', 'origin', 'feature')
    const old = git(sb.main, 'rev-parse', 'HEAD')
    stage(sb.main, 'b.txt')
    git(sb.main, 'commit', '-q', '-m', 'two')
    const sha = git(sb.main, 'rev-parse', 'HEAD')
    const r = runGit(sb.main, ['push', '-q', 'origin', 'feature'])
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([`${SCAN_ARGS} --since ${old} --until ${sha}`])
  })

  it('blocks on exit 3: the remote is not updated', () => {
    const r = runGit(sb.main, ['push', '-q', 'origin', 'feature'], {
      rc: 3,
      out: ONE_HIGH,
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('lumo: push blocked')
    expect(r.stderr).toContain('git push --no-verify')
    expect(remoteHas('refs/heads/feature')).toBe(false)
  })

  it('warns but pushes on exit 0 with findings, and on exit 1', () => {
    const low = runGit(sb.main, ['push', '-q', 'origin', 'feature'], {
      out: ONE_LOW,
    })
    expect(low.status).toBe(0)
    expect(low.stderr).toContain('lumo: warning only — not blocking the push.')
    stage(sb.main, 'b.txt')
    git(sb.main, 'commit', '-q', '-m', 'two')
    const failed = runGit(sb.main, ['push', '-q', 'origin', 'feature'], {
      rc: 1,
    })
    expect(failed.status).toBe(0)
    expect(failed.stderr).toContain(
      'lumo: security scan could not run (exit 1) — not blocking the push.'
    )
    expect(git(sb.remote, 'log', '-1', '--format=%s', 'feature')).toBe('two')
  })

  it('is skipped by git push --no-verify', () => {
    const r = runGit(
      sb.main,
      ['push', '-q', '--no-verify', 'origin', 'feature'],
      {
        rc: 3,
      }
    )
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([])
    expect(remoteHas('refs/heads/feature')).toBe(true)
  })

  it('does not scan a branch deletion or a tag', () => {
    git(sb.main, 'push', '-q', '--no-verify', 'origin', 'feature')
    git(sb.main, 'tag', 'v1')
    const tag = runGit(sb.main, ['push', '-q', 'origin', 'v1'], { rc: 3 })
    expect(tag.status).toBe(0)
    expect(tag.calls).toEqual([])
    const del = runGit(sb.main, ['push', '-q', 'origin', ':feature'], {
      rc: 3,
    })
    expect(del.status).toBe(0)
    expect(del.calls).toEqual([])
    expect(remoteHas('refs/heads/feature')).toBe(false)
  })

  it('without stdin (an earlier hook read it) scans the upstream → HEAD', () => {
    git(sb.main, 'push', '-q', '--no-verify', '-u', 'origin', 'feature')
    const hook = join(hooksDir(sb.main), 'pre-push')
    // An earlier part of the hook that swallows stdin.
    writeFileSync(
      hook,
      readFileSync(hook, 'utf8').replace(
        '#!/bin/sh\n',
        '#!/bin/sh\ncat > /dev/null\n'
      )
    )
    stage(sb.main, 'b.txt')
    git(sb.main, 'commit', '-q', '-m', 'two')
    const r = runGit(sb.main, ['push', '-q', 'origin', 'feature'])
    expect(r.status).toBe(0)
    expect(r.calls).toEqual([`${SCAN_ARGS} --since @{upstream} --until HEAD`])
  })
})

// ── init / dry-run / doctor / uninstall ────────────────────────────────────

describe('lumo init --scan-hooks', () => {
  it('installs pre-commit and pre-push, records them, and keeps prepare-commit-msg', async () => {
    const repo = plainRepo()
    const deps = initDeps(repo)
    expect(
      await init(
        { scope: 'project', agent: 'claude-code', scanHooks: true },
        deps
      )
    ).toBe(0)
    expect(readFileSync(join(hooksDir(repo), 'pre-commit'), 'utf8')).toContain(
      PRE_COMMIT_SCAN_BLOCK
    )
    expect(readFileSync(join(hooksDir(repo), 'pre-push'), 'utf8')).toContain(
      PRE_PUSH_SCAN_BLOCK
    )
    expect(existsSync(join(hooksDir(repo), 'prepare-commit-msg'))).toBe(true)
    const scanRecords = readRegistry()
      .installs.filter(r => r.kind === 'scan-hook')
      .map(r => `${r.path}:${r.agent}:${r.scope}`)
      .sort()
    expect(scanRecords).toEqual([
      `${join(hooksDir(repo), 'pre-commit')}:git:project`,
      `${join(hooksDir(repo), 'pre-push')}:git:project`,
    ])
    expect(stdout).toContain('block only on a finding that would block DONE')
  })

  it('is opt-in: plain init writes no scan hook', async () => {
    const repo = plainRepo()
    await init({ scope: 'project', agent: 'claude-code' }, initDeps(repo))
    expect(existsSync(join(hooksDir(repo), 'pre-commit'))).toBe(false)
    expect(existsSync(join(hooksDir(repo), 'pre-push'))).toBe(false)
    expect(readRegistry().installs.some(r => r.kind === 'scan-hook')).toBe(
      false
    )
  })

  it('exits 2 with --scope user and writes nothing', async () => {
    const repo = plainRepo()
    const deps = initDeps(repo)
    expect(await init({ scope: 'user', scanHooks: true }, deps)).toBe(2)
    expect(stderr).toContain('--scan-hooks installs git hooks into this repo')
    expect(existsSync(join(deps.homeDir, '.claude'))).toBe(false)
    expect(readRegistry().installs).toEqual([])
  })

  it('--dry-run previews both hooks and the apply command carries the flag', async () => {
    const repo = plainRepo()
    expect(
      await init(
        {
          scope: 'project',
          agent: 'claude-code',
          scanHooks: true,
          dryRun: true,
        },
        initDeps(repo)
      )
    ).toBe(0)
    expect(stdout).toMatch(/would install \S+pre-commit — pre-commit scan hook/)
    expect(stdout).toMatch(/would install \S+pre-push — pre-push scan hook/)
    expect(stdout).toContain(
      'lumo init --scope project --agent claude-code --scan-hooks'
    )
    expect(existsSync(join(hooksDir(repo), 'pre-commit'))).toBe(false)
  })
})

describe('doctor and uninstall cover the scan hooks', () => {
  async function installed() {
    const repo = plainRepo()
    const hook = join(hooksDir(repo), 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho mine\n')
    chmodSync(hook, 0o755)
    const deps = initDeps(repo)
    await init(
      { scope: 'project', agent: 'claude-code', scanHooks: true },
      deps
    )
    const doctorDeps = {
      homeDir: deps.homeDir,
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    return { repo, hook, doctorDeps }
  }

  it('doctor lists both as scan-hook rows, up to date', async () => {
    const { repo, doctorDeps } = await installed()
    const rows = collectDoctor(doctorDeps).rows.filter(
      r => r.kind === 'scan-hook'
    )
    expect(rows.map(r => [r.path, r.agent, r.state, r.group])).toEqual([
      [join(hooksDir(repo), 'pre-commit'), 'git', 'up to date', 'machine'],
      [join(hooksDir(repo), 'pre-push'), 'git', 'up to date', 'machine'],
    ])
    expect(rows[0]!.detail).toContain('skip once with --no-verify')
  })

  it('doctor flags a stale block with the --scan-hooks refresh command', async () => {
    const { hook, doctorDeps } = await installed()
    writeFileSync(
      hook,
      readFileSync(hook, 'utf8').replace('--timeout 2', '--timeout 9')
    )
    const row = collectDoctor(doctorDeps).rows.find(r => r.path === hook)!
    expect(row.state).toBe('behind CLI 2.0.0')
    expect(row.suggestion).toBe('lumo init --scope project --scan-hooks')
  })

  it('uninstall --agent git strips only the Lumo blocks and drops the records', async () => {
    const { repo, hook, doctorDeps } = await installed()
    const plan = planUninstall({ scope: 'project', agent: 'git' }, doctorDeps)
    expect(
      plan.actions
        .filter(a => a.action === 'strip-scan-hook')
        .map(a => a.row.path)
    ).toEqual([hook, join(hooksDir(repo), 'pre-push')])
    expect(
      await uninstall(
        { scope: 'project', agent: 'git', confirm: true },
        doctorDeps
      )
    ).toBe(0)
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\necho mine\n')
    expect(existsSync(join(hooksDir(repo), 'pre-push'))).toBe(false)
    expect(readRegistry().installs.some(r => r.kind === 'scan-hook')).toBe(
      false
    )
    expect(
      collectDoctor(doctorDeps).rows.some(r => r.kind === 'scan-hook')
    ).toBe(false)
  })
})
