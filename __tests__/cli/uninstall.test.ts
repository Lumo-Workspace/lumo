/**
 * @jest-environment node
 */
// `lumo uninstall` (LUM-1292): removes what `lumo init` wrote into the
// current git repo; --purge also empties the Lumo config dir.
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { uninstall, planUninstall } from '@/cli/src/commands/uninstall'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import {
  HOOK_SCRIPT_BLOCK,
  mergeGitHook,
} from '@/cli/src/lib/git-hook-template'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'

let roots: string[]
let prevConfigDir: string | undefined
let stdout: string
let stderr: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-uninstall-')))
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
function writeSettings(
  file: string,
  extra: Record<string, unknown> = {}
): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const hooks: Record<string, unknown> = {}
  for (const [ev, slug] of LUMO_HOOK_EVENTS)
    hooks[ev] = [
      {
        hooks: [
          { type: 'command', command: `lumo hook ${slug} --agent claude-code` },
        ],
      },
    ]
  hooks.Stop = [
    ...(hooks.Stop as unknown[]),
    { hooks: [{ type: 'command', command: 'echo mine' }] },
  ]
  writeFileSync(file, JSON.stringify({ ...extra, hooks }))
}
const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

function fixture() {
  const home = tmp()
  const repo = tmp()
  gitInit(repo)
  return {
    home,
    repo,
    deps: {
      homeDir: home,
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    },
    settings: join(repo, '.claude', 'settings.json'),
    codex: join(repo, '.codex', 'hooks.json'),
    hook: join(repo, '.git', 'hooks', 'prepare-commit-msg'),
  }
}
const argv = (...a: string[]): string[] => ['uninstall', ...a]

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

describe('confirmation envelope', () => {
  it('exits 4 with every path and the committed flag, touching nothing', async () => {
    const f = fixture()
    writeSettings(f.settings)
    git(f.repo, 'add', '.claude')
    git(f.repo, 'commit', '-qm', 'x')
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)

    const code = await uninstall({}, { ...f.deps, argv: argv() })
    expect(code).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(stdout) as {
      status: string
      command: string
      changes: string[]
      confirmCommand: string
    }
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('uninstall')
    const text = env.changes.join('\n')
    expect(text).toMatch(
      new RegExp(
        `${f.settings.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*affects the whole team after you commit`
      )
    )
    // The default .git/hooks hook is never tracked.
    expect(env.changes.find(c => c.includes(f.hook))).not.toContain(
      'affects the whole team'
    )
    expect(text).toContain('2-space')
    expect(env.confirmCommand).toBe('lumo uninstall --confirm')
    expect(json(f.settings).hooks).toHaveProperty('PreToolUse')
    expect(existsSync(f.hook)).toBe(true)
  })

  it('confirmCommand repeats the flags the user gave', async () => {
    const f = fixture()
    writeSettings(f.settings)
    await uninstall(
      { agent: 'claude-code', purge: true },
      { ...f.deps, argv: argv('--agent', 'claude-code', '--purge') }
    )
    const env = JSON.parse(stdout) as {
      confirmCommand: string
      changes: string[]
    }
    expect(env.confirmCommand).toBe(
      'lumo uninstall --agent claude-code --purge --confirm'
    )
    expect(env.changes.join('\n')).toContain('--purge')
  })
})

describe('outside a git repository', () => {
  it('exits 1 without an envelope', async () => {
    const dir = tmp()
    expect(await uninstall({}, { cwd: dir, homeDir: tmp() })).toBe(1)
    expect(stderr).toContain('run it inside a git repository')
    expect(stdout).toBe('')
  })

  it('--purge still empties the config dir', async () => {
    const cfg = process.env.LUMO_CONFIG_DIR as string
    writeFileSync(join(cfg, 'credentials.json'), '{"apiKey":"x"}')
    expect(
      await uninstall(
        { purge: true, confirm: true },
        { cwd: tmp(), homeDir: tmp() }
      )
    ).toBe(0)
    expect(existsSync(join(cfg, 'credentials.json'))).toBe(false)
  })
})

describe('agent filtering', () => {
  it('--agent restricts to that agent; git hooks are agent git', async () => {
    const f = fixture()
    writeSettings(f.settings)
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)
    expect(
      planUninstall({ agent: 'git' }, f.deps).actions.map(a => a.row.kind)
    ).toEqual(['git-hook'])
    expect(
      planUninstall({ agent: 'claude-code' }, f.deps).actions.map(
        a => a.row.kind
      )
    ).toEqual(['claude-settings'])
    expect(await uninstall({ agent: 'git', confirm: true }, f.deps)).toBe(0)
    expect(existsSync(f.hook)).toBe(false)
    expect(json(f.settings).hooks).toHaveProperty('PreToolUse')
  })
})

describe('foreign content is preserved', () => {
  it('settings.json, Codex hooks.json and the git hook keep user entries', async () => {
    const f = fixture()
    writeSettings(f.settings, { model: 'opus' })
    mkdirSync(join(f.repo, '.codex'), { recursive: true })
    writeFileSync(
      f.codex,
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: 'command', command: 'lumo hook stop --agent codex' },
              ],
            },
            { hooks: [{ type: 'command', command: 'my-codex-hook' }] },
          ],
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'lumo hook pre-tool-use' }] },
          ],
        },
      })
    )
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook('#!/bin/sh\necho user hook\n').content)

    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)

    expect(json(f.settings)).toEqual({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] },
    })
    expect(json(f.codex)).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'my-codex-hook' }] }],
      },
    })
    expect(readFileSync(f.hook, 'utf8')).toBe('#!/bin/sh\necho user hook\n')
    expect(stdout).toContain('Codex trust entries')
  })

  it('a git hook that is only the Lumo block is deleted', async () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(f.hook, mergeGitHook(null).content)
    await uninstall({ confirm: true }, f.deps)
    expect(existsSync(f.hook)).toBe(false)
  })

  it('a git hook with an unterminated block is left as is and not reported as removed', async () => {
    const f = fixture()
    mkdirSync(join(f.repo, '.git', 'hooks'), { recursive: true })
    const broken = '#!/bin/sh\n# >>> lumo prepare-commit-msg >>>\nfoo\n'
    writeFileSync(f.hook, broken)
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(readFileSync(f.hook, 'utf8')).toBe(broken)
    expect(stdout).not.toContain(`✓ Removed the Lumo block from ${f.hook}`)
    expect(stdout).not.toContain(`✓ Deleted ${f.hook}`)
  })

  it('core.hooksPath: strips the block only when the markers are present', async () => {
    const f = fixture()
    const dir = join(f.repo, '.husky')
    mkdirSync(dir)
    git(f.repo, 'config', 'core.hooksPath', '.husky')
    const withBlock = join(dir, 'prepare-commit-msg')
    writeFileSync(withBlock, `#!/bin/sh\necho husky\n${HOOK_SCRIPT_BLOCK}\n`)
    await uninstall({ confirm: true }, f.deps)
    expect(readFileSync(withBlock, 'utf8')).toBe('#!/bin/sh\necho husky\n')

    // Without markers there is no row, so nothing is touched.
    writeFileSync(withBlock, '#!/bin/sh\necho husky only\n')
    stdout = ''
    await uninstall({ confirm: true }, f.deps)
    expect(readFileSync(withBlock, 'utf8')).toBe('#!/bin/sh\necho husky only\n')
  })

  it('never touches files outside the repo (e.g. ~/.claude/settings.json)', async () => {
    const f = fixture()
    const userSettings = join(f.home, '.claude', 'settings.json')
    writeSettings(userSettings)
    const before = readFileSync(userSettings, 'utf8')
    writeSettings(f.settings)
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(readFileSync(userSettings, 'utf8')).toBe(before)
  })
})

describe('purge and final step', () => {
  it('--purge empties the config directory', async () => {
    const f = fixture()
    const cfg = process.env.LUMO_CONFIG_DIR as string
    writeFileSync(join(cfg, 'credentials.json'), '{"apiKey":"x"}')
    mkdirSync(join(cfg, 'cache'))
    writeFileSync(join(cfg, 'cache', 'a'), '1')
    writeSettings(f.settings)
    expect(await uninstall({ confirm: true, purge: true }, f.deps)).toBe(0)
    expect(json(f.settings).hooks).not.toHaveProperty('PreToolUse')
    expect(existsSync(join(cfg, 'credentials.json'))).toBe(false)
    expect(existsSync(join(cfg, 'cache'))).toBe(false)
  })

  it('without --purge credentials stay', async () => {
    const f = fixture()
    const cfg = process.env.LUMO_CONFIG_DIR as string
    writeFileSync(join(cfg, 'credentials.json'), '{"apiKey":"x"}')
    await uninstall({ confirm: true }, f.deps)
    expect(existsSync(join(cfg, 'credentials.json'))).toBe(true)
  })

  it('with nothing installed it says so, exits 0 and still prints the npm step', async () => {
    const f = fixture()
    expect(await uninstall({ confirm: true }, f.deps)).toBe(0)
    expect(stdout).toContain('Nothing to uninstall')
    expect(stdout.trimEnd().endsWith('npm rm -g @lumoai/cli')).toBe(true)
  })
})
