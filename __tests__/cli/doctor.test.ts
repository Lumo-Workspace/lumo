/**
 * @jest-environment node
 */
// `lumo doctor` (LUM-1292): the current repo's hooks, Codex rule and git
// hooks, plus login and API reachability.
import { execFileSync } from 'child_process'
import { createServer, type Server } from 'http'
import type { Socket } from 'net'
import {
  chmodSync,
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
import {
  codexEventKey,
  collectDoctor,
  codexTrustedEvents,
  doctor,
  API_TIMEOUT_MS,
  lumoOnPath,
  probeAuth,
  type DoctorReport,
} from '@/cli/src/commands/doctor'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'
import {
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
} from '@/cli/src/lib/hooks-template'
import { resolveGitHooksDir } from '@/cli/src/lib/git-hooks-dir'

let roots: string[]
let prevConfigDir: string | undefined
let stdout: string
let outSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-doctor-')))
  roots.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}
function gitInit(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
}
function writeSettings(file: string, events: string[]): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const hooks: Record<string, unknown> = {}
  for (const [ev, slug] of LUMO_HOOK_EVENTS)
    if (events.includes(ev))
      hooks[ev] = [
        {
          hooks: [
            {
              type: 'command',
              command: `lumo hook ${slug} --agent claude-code`,
            },
          ],
        },
      ]
  writeFileSync(file, JSON.stringify({ hooks }))
}
const ALL = LUMO_HOOK_EVENTS.map(([e]) => e)

function fixture() {
  const home = tmp()
  const repo = tmp()
  gitInit(repo)
  const bin = tmp()
  writeFileSync(join(bin, 'lumo'), '#!/bin/sh\n')
  chmodSync(join(bin, 'lumo'), 0o755)
  return {
    home,
    repo,
    deps: {
      homeDir: home,
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: bin },
      isGlobalInstall: () => true,
      checkApi: async () => {
        throw new Error('no API call in these tests')
      },
    },
  }
}
const rowFor = (r: DoctorReport, p: string) => r.rows.find(x => x.path === p)
const warn = (r: DoctorReport, code: string) =>
  r.warnings.filter(w => w.code === code)

beforeEach(() => {
  roots = []
  stdout = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
})
afterEach(() => {
  outSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('scope: only the current repo', () => {
  it('ignores ~/.claude/settings.json and ~/.codex/hooks.json', () => {
    const f = fixture()
    writeSettings(join(f.home, '.claude', 'settings.json'), ALL)
    mkdirSync(join(f.home, '.codex'), { recursive: true })
    writeFileSync(
      join(f.home, '.codex', 'hooks.json'),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'lumo hook stop --agent codex' },
              ],
            },
          ],
        },
      })
    )
    const r = collectDoctor(f.deps)
    expect(r.repo).toBe(f.repo)
    expect(r.rows).toEqual([])
  })

  it('in $HOME: no rows, no root and a not-a-repo warning', () => {
    const f = fixture()
    const dir = tmp()
    const r = collectDoctor({ ...f.deps, cwd: dir, homeDir: dir })
    expect(r.repo).toBeNull()
    expect(r.rows).toEqual([])
    expect(warn(r, 'not-a-repo')).toHaveLength(1)
  })
})

describe('claude settings hooks', () => {
  it('complete repo settings are up to date', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ALL)
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      tracked: false,
      kind: 'claude-settings',
      agent: 'claude-code',
      state: 'up to date',
    })
    expect(warn(r, 'missing-hook-events')).toHaveLength(0)
  })

  it('reports missing events against LUMO_HOOK_EVENTS', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(
      p,
      ALL.filter(e => e !== 'Stop' && e !== 'SessionEnd')
    )
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      state: 'incomplete',
      suggestion: 'lumo init --agent claude-code',
    })
    const w = warn(r, 'missing-hook-events')
    expect(w).toHaveLength(1)
    expect(w[0]!.message).toContain('Stop')
    expect(w[0]!.message).toContain('SessionEnd')
  })

  it('flags retired Lumo WorktreeCreate / WorktreeRemove entries (LUM-1235)', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ALL)
    const data = JSON.parse(readFileSync(p, 'utf8'))
    data.hooks.WorktreeCreate = [
      {
        hooks: [
          {
            type: 'command',
            command: 'lumo hook worktree-create --agent claude-code',
          },
        ],
      },
    ]
    writeFileSync(p, JSON.stringify(data))
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      state: 'incomplete',
      suggestion: 'lumo init --agent claude-code',
    })
    const w = warn(r, 'retired-hook-events')
    expect(w).toHaveLength(1)
    expect(w[0]!.message).toContain('WorktreeCreate')
    expect(warn(r, 'missing-hook-events')).toHaveLength(0)
  })

  it('names the agent baked into the entries in the refresh command', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ['Stop'])
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replace('--agent claude-code', '--agent cursor')
    )
    expect(rowFor(collectDoctor(f.deps), p)).toMatchObject({
      agent: 'cursor',
      suggestion: 'lumo init --agent cursor',
    })
  })

  it('ignores settings without any Lumo hook and survives invalid JSON', () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.claude'), { recursive: true })
    writeFileSync(join(f.repo, '.claude', 'settings.json'), '{oops')
    expect(collectDoctor(f.deps).rows).toHaveLength(0)
    writeFileSync(
      join(f.repo, '.claude', 'settings.json'),
      JSON.stringify({ permissions: {} })
    )
    expect(collectDoctor(f.deps).rows).toHaveLength(0)
  })

  it('committed repo settings are tracked', () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ALL)
    git(f.repo, 'add', '.claude')
    git(f.repo, 'commit', '-qm', 'x')
    expect(rowFor(collectDoctor(f.deps), p)).toMatchObject({ tracked: true })
  })
})

describe('git hook', () => {
  it('default .git/hooks block is untracked; stale block is behind', () => {
    const f = fixture()
    const hook = join(f.repo, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      tracked: false,
      kind: 'git-hook',
      agent: 'git',
      state: 'up to date',
    })
    writeFileSync(
      hook,
      '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'
    )
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      state: 'behind CLI 2.0.0',
      suggestion: 'lumo init',
    })
  })

  it('a hook file without the Lumo block is not an install', () => {
    const f = fixture()
    const hook = join(f.repo, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\necho hi\n')
    expect(rowFor(collectDoctor(f.deps), hook)).toBeUndefined()
  })

  it('respects core.hooksPath: a tracked dir is committed', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const hook = join(f.repo, '.husky', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    git(f.repo, 'add', '.husky')
    git(f.repo, 'commit', '-qm', 'x')
    expect(rowFor(collectDoctor(f.deps), hook)).toMatchObject({
      tracked: true,
      state: 'up to date',
    })
  })

  it('resolveGitHooksDir returns the hooksPath dir when configured', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const r = resolveGitHooksDir(f.repo)
    expect(r.coreHooksPath).toBe('.husky')
    expect(r.dir).toBe(join(f.repo, '.husky'))
  })

  it('resolves a relative core.hooksPath via git rev-parse', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', 'hooks/custom')
    const r = resolveGitHooksDir(f.repo)
    expect(r.coreHooksPath).toBe('hooks/custom')
    expect(r.dir).toBe(join(f.repo, 'hooks', 'custom'))
  })

  it('stale core.hooksPath hook has no command, only a manual hint', () => {
    const f = fixture()
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const hook = join(f.repo, '.husky', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(
      hook,
      '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nold\n# <<< lumo <<<\n'
    )
    const row = rowFor(collectDoctor(f.deps), hook)!
    expect(row.state).toBe('behind CLI 2.0.0')
    expect(row.suggestion).toBeUndefined()
    expect(row.detail).toContain('by hand')
  })
})

describe('codex trust', () => {
  const writeCodex = (
    file: string,
    events: ReadonlyArray<readonly [string, string]> = CODEX_HOOK_EVENTS
  ) => {
    mkdirSync(join(file, '..'), { recursive: true })
    const hooks: Record<string, unknown> = {}
    for (const [ev, slug] of events)
      hooks[ev] = [
        {
          hooks: [
            { type: 'command', command: `lumo hook ${slug} --agent codex` },
          ],
        },
      ]
    hooks['Other'] = [{ hooks: [{ type: 'command', command: 'echo hi' }] }]
    writeFileSync(file, JSON.stringify({ hooks }))
  }
  const trustAll = (home: string, key: string) => {
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      CODEX_HOOK_EVENTS.map(
        ([ev]) =>
          `[hooks.state."${key}:${codexEventKey(ev)}:0:0"]\ntrusted_hash = "sha256:x"\n`
      ).join('\n')
    )
  }

  it('codexEventKey snake-cases CamelCase events', () => {
    expect(codexEventKey('PreToolUse')).toBe('pre_tool_use')
    expect(codexEventKey('Stop')).toBe('stop')
  })

  it('codexTrustedEvents reads only sections that have a trusted_hash', () => {
    const toml = [
      '[hooks.state."/h/.codex/hooks.json:pre_tool_use:0:0"]',
      'trusted_hash = "sha256:abc"',
      '',
      '[hooks.state."/h/.codex/hooks.json:stop:0:0"]',
      'other = 1',
      '',
      '[hooks.state."/other/hooks.json:session_start:0:0"]',
      'trusted_hash = "sha256:def"',
    ].join('\n')
    const t = codexTrustedEvents(toml, '/h/.codex/hooks.json')
    expect([...t]).toEqual(['pre_tool_use'])
  })

  it('codexTrustedEvents tolerates whitespace and a trailing comment on the header', () => {
    const toml = [
      '  [ hooks.state."/h/hooks.json:pre_tool_use:0:0" ]   # trusted via /hooks',
      'trusted_hash = "sha256:abc"',
    ].join('\n')
    expect([...codexTrustedEvents(toml, '/h/hooks.json')]).toEqual([
      'pre_tool_use',
    ])
  })

  it('lists the repo .codex/hooks.json with trust read from ~/.codex/config.toml', () => {
    const f = fixture()
    const p = join(f.repo, '.codex', 'hooks.json')
    writeCodex(p)
    trustAll(f.home, p)
    const r = collectDoctor(f.deps)
    expect(rowFor(r, p)).toMatchObject({
      kind: 'codex-hooks',
      agent: 'codex',
      tracked: false,
      state: 'trusted (hash not verified)',
    })
    expect(warn(r, 'codex-untrusted')).toHaveLength(0)
    expect(warn(r, 'missing-hook-events')).toHaveLength(0)
  })

  it('without a trust match it says unverified and warns', () => {
    const f = fixture()
    const p = join(f.repo, '.codex', 'hooks.json')
    writeCodex(p)
    const r = collectDoctor(f.deps)
    const row = rowFor(r, p)!
    expect(row.state).toBe('trust unverified')
    expect(row.detail).toContain(
      "open /hooks in Codex and Trust if Lumo hooks don't fire"
    )
    expect(warn(r, 'codex-untrusted')).toHaveLength(1)
  })

  it('flags missing Codex events with the init command for codex', () => {
    const f = fixture()
    const p = join(f.repo, '.codex', 'hooks.json')
    writeCodex(
      p,
      CODEX_HOOK_EVENTS.filter(([ev]) => ev !== 'SubagentStop')
    )
    const r = collectDoctor(f.deps)
    const row = rowFor(r, p)!
    expect(row.suggestion).toBe('lumo init --agent codex')
    expect(row.detail).toContain('missing 1 hook event(s)')
    expect(
      warn(r, 'missing-hook-events').some(w =>
        w.message.includes('SubagentStop')
      )
    ).toBe(true)
  })

  it('matches trust keyed by the realpath when the repo is reached through a symlink', () => {
    const f = fixture()
    const link = join(tmp(), 'link')
    symlinkSync(f.repo, link)
    const p = join(f.repo, '.codex', 'hooks.json')
    writeCodex(p)
    trustAll(f.home, p)
    const r = collectDoctor({ ...f.deps, cwd: link })
    expect(rowFor(r, p)!.state).toBe('trusted (hash not verified)')
  })

  it('a hooks.json with no lumo entries is not an install', () => {
    const f = fixture()
    const p = join(f.repo, '.codex', 'hooks.json')
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(
      p,
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] },
      })
    )
    expect(rowFor(collectDoctor(f.deps), p)).toBeUndefined()
  })
})

describe('PATH check', () => {
  it('lumoOnPath finds an executable in PATH', () => {
    const bin = tmp()
    expect(lumoOnPath(bin)).toBe(false)
    writeFileSync(join(bin, 'lumo'), '')
    chmodSync(join(bin, 'lumo'), 0o755)
    expect(lumoOnPath(bin)).toBe(true)
  })

  it('warns when lumo is not resolvable', () => {
    const f = fixture()
    const r = collectDoctor({ ...f.deps, env: { PATH: tmp() } })
    expect(warn(r, 'lumo-not-on-path')).toHaveLength(1)
    expect(warn(collectDoctor(f.deps), 'lumo-not-on-path')).toHaveLength(0)
  })
})

describe('login and API', () => {
  const creds = {
    token: 'tok',
    apiUrl: 'https://lumo.example',
    userId: 'u',
    email: 'a@b.c',
    workspaceId: 'w',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    apiKeyId: 'k',
    apiKeyName: 'k',
    apiKeyPrefix: 'lum_x',
  }

  it('not logged in: no API call', async () => {
    const checkApi = jest.fn(async () => {})
    expect(await probeAuth({ credentials: () => null, checkApi })).toEqual({
      loggedIn: false,
      api: 'not-checked',
    })
    expect(checkApi).not.toHaveBeenCalled()
  })

  it('checks the saved key against the saved API URL', async () => {
    const prev = process.env.LUMO_API_URL
    delete process.env.LUMO_API_URL
    try {
      const checkApi = jest.fn(async () => {})
      expect(await probeAuth({ credentials: () => creds, checkApi })).toEqual({
        loggedIn: true,
        email: 'a@b.c',
        workspace: 'acme',
        apiUrl: 'https://lumo.example',
        api: 'ok',
      })
      expect(checkApi).toHaveBeenCalledWith('https://lumo.example', 'tok')
    } finally {
      if (prev !== undefined) process.env.LUMO_API_URL = prev
    }
  })

  it('maps failures to unreachable / invalid-key / error', async () => {
    const fail = (msg: string) => async () => {
      throw new Error(msg)
    }
    const run = (msg: string) =>
      probeAuth({ credentials: () => creds, checkApi: fail(msg) })
    expect((await run('Could not reach Lumo API at x (y)')).api).toBe(
      'unreachable'
    )
    expect((await run('Invalid or revoked API key')).api).toBe('invalid-key')
    expect((await run('Verify failed: HTTP 500')).api).toBe('error')
  })

  it('the text report shows login and the fix command', async () => {
    const f = fixture()
    await doctor({}, { ...f.deps, credentials: () => null })
    expect(stdout).toContain('Login\n  not logged in\n  lumo auth login')
    stdout = ''
    await doctor(
      {},
      {
        ...f.deps,
        credentials: () => creds,
        checkApi: async () => {
          throw new Error('Invalid or revoked API key')
        },
      }
    )
    expect(stdout).toContain('API https://lumo.example: invalid-key')
  })
})

describe('API check timeout (a server that accepts and never answers)', () => {
  let server: Server
  let url: string
  let closed: Promise<void>
  let prevApiUrl: string | undefined

  beforeEach(async () => {
    prevApiUrl = process.env.LUMO_API_URL
    delete process.env.LUMO_API_URL
    let onClose!: () => void
    closed = new Promise(r => (onClose = r))
    // Never writes a response: the request hangs until the client gives up.
    server = createServer(() => {})
    server.on('connection', (sock: Socket) => sock.on('close', onClose))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const addr = server.address() as { port: number }
    url = `http://127.0.0.1:${addr.port}`
  })
  afterEach(async () => {
    if (prevApiUrl !== undefined) process.env.LUMO_API_URL = prevApiUrl
    server.closeAllConnections()
    await new Promise(r => server.close(r))
  })

  const creds = () => ({
    token: 'tok',
    apiUrl: url,
    userId: 'u',
    email: 'a@b.c',
    workspaceId: 'w',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    apiKeyId: 'k',
    apiKeyName: 'k',
    apiKeyPrefix: 'lum_x',
  })

  it('the default timeout is 5 s', () => {
    expect(API_TIMEOUT_MS).toBe(5_000)
  })

  it('doctor reports unreachable within the timeout and aborts the request (socket closed)', async () => {
    const f = fixture()
    const { checkApi: _noStub, ...deps } = f.deps
    const timeout = 300
    const t0 = Date.now()
    expect(
      await doctor(
        { json: true },
        { ...deps, credentials: creds, apiTimeoutMs: timeout }
      )
    ).toBe(0)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeGreaterThanOrEqual(timeout - 50)
    expect(elapsed).toBeLessThan(timeout + 2_000)
    const auth = (JSON.parse(stdout) as { auth: { api: string } }).auth
    expect(auth.api).toBe('unreachable')
    // The client closed its socket: nothing keeps the process alive.
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('socket still open')), 1_000)
      ),
    ])
  })
})

describe('doctor command', () => {
  it('prints grouped text, exits 0 even with warnings, and is read-only', async () => {
    const f = fixture()
    const p = join(f.repo, '.claude', 'settings.json')
    writeSettings(p, ['Stop'])
    const before = readFileSync(p, 'utf8')
    const code = await doctor({}, { ...f.deps, env: { PATH: tmp() } })
    expect(code).toBe(0)
    expect(stdout).toContain(`Repo ${f.repo}`)
    expect(stdout).toContain('Not committed (this checkout only)')
    expect(stdout).toContain(p)
    expect(stdout).toContain('    lumo init --agent claude-code')
    expect(stdout).not.toMatch(/--scope|--upgrade|-> lumo init/)
    expect(stdout).toContain('lumo-not-on-path')
    // LUM-1232 S-1: warnings use the one warning marker, never `!`.
    expect(stdout).toMatch(/^  ⚠ lumo-not-on-path: /m)
    expect(stdout).not.toMatch(/^  ! /m)
    expect(readFileSync(p, 'utf8')).toBe(before)
  })

  it('--json emits schema version 2 with the repo, rows and auth', async () => {
    const f = fixture()
    writeSettings(join(f.repo, '.claude', 'settings.json'), ALL)
    const code = await doctor({ json: true }, f.deps)
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout) as DoctorReport & {
      version: number
      auth: { loggedIn: boolean }
    }
    expect(parsed.version).toBe(2)
    expect(parsed.cliVersion).toBe('2.0.0')
    expect(parsed.repo).toBe(f.repo)
    expect(parsed.rows[0]).toMatchObject({
      kind: 'claude-settings',
      tracked: false,
    })
    expect(parsed.rows[0]).not.toHaveProperty('scope')
    expect(parsed.rows[0]).not.toHaveProperty('group')
    expect(parsed.auth.loggedIn).toBe(false)
    expect(Array.isArray(parsed.warnings)).toBe(true)
  })

  it('says so when the repo has no Lumo hooks', async () => {
    const f = fixture()
    await doctor({}, f.deps)
    expect(stdout).toContain('No Lumo hooks in this repo.')
  })
})

describe('registration', () => {
  it('registers doctor with a --json option', () => {
    const prev = process.env.LUMO_CLI_INTROSPECT
    process.env.LUMO_CLI_INTROSPECT = '1'
    const { program } = require('@/cli/src/index') as {
      program: {
        commands: Array<{ name(): string; options: Array<{ long?: string }> }>
      }
    }
    if (prev === undefined) delete process.env.LUMO_CLI_INTROSPECT
    else process.env.LUMO_CLI_INTROSPECT = prev
    const cmd = program.commands.find(c => c.name() === 'doctor')
    expect(cmd?.options.map(o => o.long)).toContain('--json')
  })
})

describe('doctor auto-update eligibility', () => {
  it('says plain "on" for a global npm install', async () => {
    const f = fixture()
    await doctor({}, { ...f.deps, isGlobalInstall: () => true })
    expect(stdout).toContain('Auto-update: on — the CLI updates itself')
    expect(stdout).not.toContain('skipped for this install')
  })

  it('says auto-update is skipped when this is not a global npm install', async () => {
    const f = fixture()
    await doctor({}, { ...f.deps, isGlobalInstall: () => false })
    expect(stdout).toContain(
      'Auto-update: on, but skipped for this install (not a global npm install — e.g. npm link or npx); update it yourself'
    )
  })

  it('carries eligibility in --json output', async () => {
    const f = fixture()
    await doctor({ json: true }, { ...f.deps, isGlobalInstall: () => false })
    expect(JSON.parse(stdout).autoUpdate).toEqual({
      enabled: true,
      source: 'default',
      eligible: false,
    })
  })

  it('probes with the injected package root and spawnSync', async () => {
    const f = fixture()
    const g = join(tmp(), 'lib', 'node_modules')
    const pkg = join(g, '@lumoai', 'cli')
    mkdirSync(pkg, { recursive: true })
    const spawnSync = jest.fn(() => ({ status: 0, stdout: g + '\n' }))
    const { isGlobalInstall: _probe, ...base } = f.deps
    await doctor({}, { ...base, pkgRoot: pkg, spawnSync })
    expect(spawnSync).toHaveBeenCalledTimes(1)
    expect(stdout).toContain('Auto-update: on — the CLI updates itself')

    stdout = ''
    const noSpawn = jest.fn()
    await doctor({}, { ...base, pkgRoot: null, spawnSync: noSpawn })
    expect(noSpawn).not.toHaveBeenCalled()
    expect(stdout).toContain('skipped for this install')
  })

  it('does not probe the install when auto-update is off', async () => {
    const f = fixture()
    const probe = jest.fn(() => false)
    await doctor(
      {},
      { ...f.deps, env: { ...f.deps.env, CI: 'true' }, isGlobalInstall: probe }
    )
    expect(probe).not.toHaveBeenCalled()
    expect(stdout).toContain('Auto-update: off (CI environment)')
  })
})
