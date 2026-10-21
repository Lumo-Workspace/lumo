/**
 * @jest-environment node
 */
// LUM-1292 Task 6: `lumo init` / `uninstall` / `doctor` handle only the
// current git repo — hooks, Codex rules, the frozen skill stub and the git
// hook. No full skill copy, no install registry, no user scope.
import { execFileSync, spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  cpSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { init } from '@/cli/src/commands/init'
import { uninstall } from '@/cli/src/commands/uninstall'
import { doctor } from '@/cli/src/commands/doctor'
import {
  CODEX_HOOK_EVENTS,
  LUMO_HOOK_EVENTS,
} from '@/cli/src/lib/hooks-template'
import { planInit } from '@/cli/src/lib/init-dry-run'
import { LUMO_SKILL_STUB } from '@/cli/src/lib/skill-stub'

jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let dirs: string[]
let home: string
let repo: string
let stdout: string
let stderr: string
let spies: jest.SpyInstance[]
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['HOME', 'LUMO_CONFIG_DIR', 'LUMO_NO_AUTO_UPDATE']

const tmp = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })
const notGlobal = { isGlobalInstall: () => false }

/** Every file under `dir` (relative), skipping `.git/objects`. */
function tree(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const rel = relative(dir, p)
      if (rel === join('.git', 'objects')) continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(rel)
    }
  }
  walk(dir)
  return out.sort()
}
const snapshot = (dir: string): Record<string, string> =>
  Object.fromEntries(
    tree(dir).map(f => [f, readFileSync(join(dir, f), 'utf8')])
  )

/** Events of a hooks object that hold a `lumo hook …` command. */
function lumoEvents(file: string): string[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>
  }
  return Object.entries(parsed.hooks ?? {})
    .filter(([, groups]) =>
      groups.some(g =>
        (g.hooks ?? []).some(h => h.command?.startsWith('lumo hook '))
      )
    )
    .map(([e]) => e)
}

beforeEach(() => {
  dirs = []
  stdout = ''
  stderr = ''
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  home = tmp('lumo-t6-home-')
  repo = tmp('lumo-t6-repo-')
  // os.homedir() ignores HOME inside jest: pin the Lumo config dir too, so
  // nothing reads or writes the real ~/.lumo (credentials included).
  process.env.HOME = home
  process.env.LUMO_CONFIG_DIR = join(home, '.lumo')
  process.env.LUMO_NO_AUTO_UPDATE = '1'
  git(repo, 'init', '-q')
  spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
      stdout += s
      return true
    }) as never),
    jest.spyOn(process.stderr, 'write').mockImplementation(((s: string) => {
      stderr += s
      return true
    }) as never),
  ]
})

afterEach(() => {
  spies.forEach(s => s.mockRestore())
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('lumo init — current repo only', () => {
  it('writes hooks, the Codex rule, the skill stubs and the git hook, and no registry', async () => {
    expect(await init({}, { cwd: repo, ...notGlobal })).toBe(0)

    const all = [...tree(repo), ...tree(home)]
    // The skill dirs hold exactly the one stub file each, in the repo only.
    expect(all.filter(f => f.includes(join('skills', 'lumo'))).sort()).toEqual([
      join('.agents', 'skills', 'lumo', 'SKILL.md'),
      join('.claude', 'skills', 'lumo', 'SKILL.md'),
    ])
    // No install registry or anything else under the Lumo config dir / HOME.
    expect(existsSync(join(home, '.lumo'))).toBe(false)
    expect(tree(home)).toEqual([])

    const settings = join(repo, '.claude', 'settings.json')
    expect(lumoEvents(settings).sort()).toEqual(
      LUMO_HOOK_EVENTS.map(([e]) => e).sort()
    )
    expect(LUMO_HOOK_EVENTS).toHaveLength(17)
    expect(lumoEvents(join(repo, '.codex', 'hooks.json')).sort()).toEqual(
      CODEX_HOOK_EVENTS.map(([e]) => e).sort()
    )
    expect(existsSync(join(repo, '.codex', 'rules', 'lumo.rules'))).toBe(true)
    expect(
      readFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf8')
    ).toContain('lumo')
  })

  it('run from a subdirectory, writes at the repo root', async () => {
    const sub = join(repo, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    expect(
      await init({ agent: 'claude-code' }, { cwd: sub, ...notGlobal })
    ).toBe(0)
    expect(existsSync(join(repo, '.claude', 'settings.json'))).toBe(true)
    expect(existsSync(join(sub, '.claude'))).toBe(false)
    // --agent narrows to one agent: no Codex files.
    expect(existsSync(join(repo, '.codex'))).toBe(false)
  })

  it('--dry-run writes nothing and plans exactly what the real run writes', async () => {
    const before = snapshot(repo)
    expect(await init({ dryRun: true }, { cwd: repo, ...notGlobal })).toBe(0)
    expect(snapshot(repo)).toEqual(before)
    expect(tree(home)).toEqual([])

    const planned = planInit({ tokens: ['claude-code', 'codex'], root: repo })
    expect(planned.every(i => i.action === 'install')).toBe(true)

    expect(await init({}, { cwd: repo, ...notGlobal })).toBe(0)
    const written = tree(repo).filter(f => !f.startsWith('.git' + '/objects'))
    for (const item of planned)
      expect(written).toContain(relative(repo, item.path))
    const after = planInit({ tokens: ['claude-code', 'codex'], root: repo })
    expect(after.map(i => i.action)).toEqual(after.map(() => 'unchanged'))
    expect(after.map(i => i.path)).toEqual(planned.map(i => i.path))
  })

  it('refuses $HOME and writes nothing', async () => {
    const plain = tmp('lumo-t6-plain-')
    expect(await init({}, { cwd: plain, homeDir: plain, ...notGlobal })).toBe(1)
    expect(stderr).toContain('home directory')
    expect(tree(plain)).toEqual([])
    expect(tree(home)).toEqual([])
  })
})

describe('lumo uninstall / doctor — current repo only', () => {
  it('uninstall --confirm removes every entry init wrote', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    stdout = ''
    expect(
      await uninstall({ confirm: true }, { cwd: repo, homeDir: home })
    ).toBe(0)
    expect(lumoEvents(join(repo, '.claude', 'settings.json'))).toEqual([])
    expect(lumoEvents(join(repo, '.codex', 'hooks.json'))).toEqual([])
    expect(existsSync(join(repo, '.codex', 'rules', 'lumo.rules'))).toBe(false)
    expect(existsSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(
      false
    )
    expect(tree(home)).toEqual([])
  })

  it('doctor --json reports only this repo: hooks, rule, git hook, plus auth', async () => {
    await init({}, { cwd: repo, ...notGlobal })
    stdout = ''
    expect(
      await doctor(
        { json: true },
        {
          cwd: repo,
          homeDir: home,
          env: { PATH: '' },
          ...notGlobal,
          checkApi: async () => {
            throw new Error('no API call when logged out')
          },
        }
      )
    ).toBe(0)
    const report = JSON.parse(stdout) as {
      version: number
      repo: string | null
      rows: Array<{ kind: string; path: string }>
      auth: { loggedIn: boolean; api: string }
    }
    expect(report.version).toBe(2)
    expect(report.repo).toBe(repo)
    expect(report.rows.map(r => r.kind).sort()).toEqual([
      'claude-settings',
      'codex-hooks',
      'codex-rules',
      'git-hook',
      'skill-stub',
      'skill-stub',
    ])
    for (const r of report.rows) expect(r.path.startsWith(repo)).toBe(true)
    expect(report.auth).toMatchObject({ loggedIn: false, api: 'not-checked' })
    expect(stdout).not.toMatch(/installs\.json|scope/i)
  })

  it('doctor reports login and API reachability from the saved credentials', async () => {
    const creds = {
      token: 't',
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
    const run = async (checkApi: () => Promise<void>) => {
      stdout = ''
      await doctor(
        { json: true },
        {
          cwd: repo,
          homeDir: home,
          ...notGlobal,
          credentials: () => creds,
          checkApi,
        }
      )
      return (JSON.parse(stdout) as { auth: Record<string, unknown> }).auth
    }
    expect(await run(async () => {})).toMatchObject({
      loggedIn: true,
      email: 'a@b.c',
      workspace: 'acme',
      api: 'ok',
    })
    expect(
      await run(async () => {
        throw new Error('Could not reach Lumo API at x (timeout)')
      })
    ).toMatchObject({ api: 'unreachable' })
    expect(
      await run(async () => {
        throw new Error('Invalid or revoked API key')
      })
    ).toMatchObject({ api: 'invalid-key' })
  })
})

describe('removed flags — real CLI process', () => {
  const ROOT = join(__dirname, '..', '..')
  let pkgDir: string

  beforeAll(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'lumo-t6-pkg-'))
    const tsc = spawnSync(
      join(ROOT, 'node_modules/.bin/tsc'),
      ['-p', join(ROOT, 'cli/tsconfig.json'), '--outDir', join(pkgDir, 'dist')],
      { cwd: ROOT, encoding: 'utf8' }
    )
    if (tsc.status !== 0) throw new Error(`tsc failed: ${tsc.stdout}`)
    cpSync(join(ROOT, 'cli/package.json'), join(pkgDir, 'package.json'))
    symlinkSync(join(ROOT, 'node_modules'), join(pkgDir, 'node_modules'))
  }, 180_000)

  afterAll(() => rmSync(pkgDir, { recursive: true, force: true }))

  function run(args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of Object.keys(env))
      if (k.startsWith('LUMO_') || k === 'CLAUDECODE') delete env[k]
    Object.assign(env, {
      HOME: home,
      LUMO_API_URL: 'http://127.0.0.1:1',
      LUMO_NO_UPDATE_CHECK: '1',
      LUMO_NO_AUTO_UPDATE: '1',
    })
    const r = spawnSync(
      process.execPath,
      [join(pkgDir, 'dist/cli/src/index.js'), ...args],
      { cwd: repo, env, encoding: 'utf8', timeout: 60_000 }
    )
    return { status: r.status, err: r.stderr }
  }

  it.each([
    [['init', '--scope', 'project']],
    [['init', '--force']],
    [['uninstall', '--scope', 'project', '--confirm']],
    [['uninstall', '--force', '--confirm']],
  ])(
    '%j exits 2 as an unknown option and writes nothing',
    args => {
      const r = run(args)
      expect(r.status).toBe(2)
      expect(r.err).toMatch(/unknown option/i)
      expect(tree(repo).filter(f => !f.startsWith('.git'))).toEqual([])
    },
    90_000
  )

  it('init in a temp repo creates both stubs and nothing under HOME', () => {
    const r = run(['init'])
    expect(r.status).toBe(0)
    for (const rel of ['.claude', '.agents'])
      expect(
        readFileSync(join(repo, rel, 'skills', 'lumo', 'SKILL.md'), 'utf8')
      ).toBe(LUMO_SKILL_STUB)
    // Only the CLI's own last-command bookkeeping lives under HOME.
    expect(
      tree(home).filter(f => f !== join('.lumo', 'last-command.json'))
    ).toEqual([])
  }, 90_000)

  it.each([[['skill', 'status']], [['skill', 'update']]])(
    '%j is gone (exit 2)',
    args => {
      expect(run(args).status).toBe(2)
    },
    90_000
  )
})
