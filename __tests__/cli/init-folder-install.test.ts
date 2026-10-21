/**
 * @jest-environment node
 */
// LUM-1292 Task 11: `lumo init` outside a git repo is a "folder install":
// warn + y/N (stdin; EOF / timeout = no); $HOME and / are refused.
import { EventEmitter } from 'events'
import { execFileSync, spawnSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { init } from '@/cli/src/commands/init'
import { uninstall } from '@/cli/src/commands/uninstall'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { projectInstallDrift } from '@/cli/src/lib/project-install-drift'
import { askYesNo } from '@/cli/src/lib/ask-yes-no'
import { resolveInstallRoot } from '@/cli/src/lib/repo-root'

jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let dirs: string[]
let home: string
let folder: string
let stdout: string
let stderr: string
let spies: jest.SpyInstance[]
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['HOME', 'LUMO_CONFIG_DIR', 'LUMO_NO_AUTO_UPDATE']
const notGlobal = { isGlobalInstall: () => false }

const tmp = (prefix: string): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  dirs.push(d)
  return d
}
function tree(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name)
      if (name.isDirectory()) walk(p)
      else out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}
/** A stdin double: emits `lines` then ends (or stays silent). */
function fakeStdin(
  answer: string | null,
  end = true
): EventEmitter & { resume(): void; pause(): void; setEncoding(): void } {
  const e = new EventEmitter() as EventEmitter & {
    resume(): void
    pause(): void
    setEncoding(): void
  }
  e.pause = () => {}
  e.setEncoding = () => {}
  e.resume = () => {
    setImmediate(() => {
      if (answer !== null) e.emit('data', answer)
      if (end && (answer === null || !answer.includes('\n'))) e.emit('end')
    })
  }
  return e
}
const deps = (answer: string | null, extra = {}) => ({
  cwd: folder,
  homeDir: home,
  stdin: fakeStdin(answer),
  ...notGlobal,
  ...extra,
})

beforeEach(() => {
  dirs = []
  stdout = ''
  stderr = ''
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  home = tmp('lumo-t11-home-')
  folder = tmp('lumo-t11-folder-')
  process.env.HOME = home
  process.env.LUMO_CONFIG_DIR = join(home, '.lumo')
  process.env.LUMO_NO_AUTO_UPDATE = '1'
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

describe('resolveInstallRoot', () => {
  it('git toplevel inside a repo', () => {
    const repo = tmp('lumo-t11-repo-')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    mkdirSync(join(repo, 'sub'))
    expect(resolveInstallRoot(join(repo, 'sub'), home)).toEqual({
      ok: true,
      root: repo,
      kind: 'git',
    })
  })
  it('the (real) cwd as a folder outside git', () => {
    expect(resolveInstallRoot(folder, home)).toEqual({
      ok: true,
      root: folder,
      kind: 'folder',
    })
  })
  it('refuses $HOME, a symlink to $HOME and /', () => {
    expect(resolveInstallRoot(home, home).ok).toBe(false)
    const link = join(tmp('lumo-t11-link-'), 'h')
    symlinkSync(home, link)
    expect(resolveInstallRoot(link, home).ok).toBe(false)
    expect(resolveInstallRoot('/', home).ok).toBe(false)
  })
})

describe('askYesNo', () => {
  const ask = (s: ReturnType<typeof fakeStdin>, ms = 1000) =>
    askYesNo('Q? ', { stdin: s, write: () => {}, timeoutMs: ms })
  it.each(['y\n', 'YES\n', '  Yes \n', 'y\r\n'])('%j is yes', async a => {
    expect(await ask(fakeStdin(a))).toBe(true)
  })
  it.each(['n\n', '\n', 'maybe\n', 'yy\n'])('%j is no', async a => {
    expect(await ask(fakeStdin(a))).toBe(false)
  })
  it('EOF is no', async () => {
    expect(await ask(fakeStdin(null))).toBe(false)
  })
  it('open but silent stdin times out as no', async () => {
    expect(await ask(fakeStdin(null, false), 30)).toBe(false)
  })
})

describe('init in a non-git folder', () => {
  it('y writes hooks and stubs, skips the git hook with a note', async () => {
    expect(await init({}, deps('y\n'))).toBe(0)
    expect(stdout).toContain('not a git repository')
    expect(stdout).toContain('Install Lumo here anyway? [y/N]')
    expect(stdout).toContain('no git hook installed')
    expect(tree(folder)).toEqual(
      expect.arrayContaining([
        '.claude/settings.json',
        '.codex/hooks.json',
        '.codex/rules/lumo.rules',
        '.claude/skills/lumo/SKILL.md',
        '.agents/skills/lumo/SKILL.md',
      ])
    )
    expect(existsSync(join(folder, '.git'))).toBe(false)
    expect(tree(home)).toEqual([])
  })

  it('lists files and both warnings before asking', async () => {
    await init({}, deps('n\n'))
    expect(stdout).toContain('would install .claude/settings.json')
    expect(stdout).toContain("can't be shared with teammates via git")
    expect(stdout).toContain('only to agent sessions started in this folder')
  })

  it.each([['n\n'], ['\n'], [null]])(
    '%j writes nothing, prints "Nothing written.", exits 0',
    async a => {
      expect(await init({}, deps(a))).toBe(0)
      expect(stdout).toContain('Nothing written.')
      expect(tree(folder)).toEqual([])
    }
  )

  it('silent stdin times out: nothing written, exit 0', async () => {
    const d = { ...deps(null), stdin: fakeStdin(null, false) }
    expect(await init({}, { ...d, answerTimeoutMs: 30 })).toBe(0)
    expect(stdout).toContain('Nothing written.')
    expect(tree(folder)).toEqual([])
  })

  it('--dry-run never prompts or writes and shows the warnings', async () => {
    expect(await init({ dryRun: true }, deps('y\n'))).toBe(0)
    expect(stdout).not.toContain('[y/N]')
    expect(stdout).toContain("can't be shared with teammates via git")
    expect(stdout).toContain('no git hook')
    expect(tree(folder)).toEqual([])
  })

  it('--scan-hooks exits 2 with a hint, nothing written, no prompt', async () => {
    expect(await init({ scanHooks: true }, deps('y\n'))).toBe(2)
    expect(stderr).toContain('needs a git repository')
    expect(stdout).not.toContain('[y/N]')
    expect(tree(folder)).toEqual([])
  })

  it('refuses $HOME and a symlink to it without prompting', async () => {
    expect(await init({}, deps('y\n', { cwd: home }))).toBe(1)
    expect(stderr).toContain('home directory')
    const link = join(tmp('lumo-t11-link-'), 'h')
    symlinkSync(home, link)
    stderr = ''
    expect(await init({}, deps('y\n', { cwd: link }))).toBe(1)
    expect(stderr).toContain('home directory')
    expect(stdout).not.toContain('[y/N]')
    expect(tree(home)).toEqual([])
  })

  it('a repo never prompts', async () => {
    execFileSync('git', ['init', '-q'], { cwd: folder })
    expect(await init({}, deps(null))).toBe(0)
    expect(stdout).not.toContain('[y/N]')
  })
})

describe('doctor / uninstall / drift in a folder install', () => {
  beforeEach(async () => {
    await init({}, deps('y\n'))
    stdout = ''
  })

  it('doctor reports the folder with local wording', () => {
    const r = collectDoctor({ cwd: folder, homeDir: home, cliVersion: '2.0.0' })
    expect(r.repo).toBe(folder)
    expect(r.folder).toBe(true)
    expect(r.rows.some(x => x.kind === 'git-hook')).toBe(false)
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.every(x => !x.tracked)).toBe(true)
  })

  it('doctor in $HOME has no root and a warning', () => {
    const r = collectDoctor({ cwd: home, homeDir: home, cliVersion: '2.0.0' })
    expect(r.repo).toBeNull()
    expect(r.warnings.map(w => w.code)).toContain('not-a-repo')
  })

  it('uninstall keeps its exit-4 gate, then removes everything', async () => {
    expect(await uninstall({}, { cwd: folder, homeDir: home })).toBe(4)
    expect(existsSync(join(folder, '.claude', 'settings.json'))).toBe(true)
    expect(
      await uninstall({ confirm: true }, { cwd: folder, homeDir: home })
    ).toBe(0)
    // the emptied hook files stay (uninstall keeps files); stubs/rules go
    expect(tree(folder)).toEqual(['.claude/settings.json', '.codex/hooks.json'])
  })

  it('uninstall in $HOME is refused', async () => {
    expect(await uninstall({}, { cwd: home, homeDir: home })).toBe(1)
  })

  it('drift check works against the folder root', () => {
    expect(
      projectInstallDrift({ cwd: join(folder), cliVersion: '2.0.0' })
    ).toEqual([])
  })
})

describe('real built CLI through a pseudo-TTY (script) and pipes', () => {
  const cli = join(__dirname, '../../cli/dist/cli/src/index.js')
  const have = existsSync(cli) && existsSync('/usr/bin/script')
  // A pseudo-TTY needs the answer typed AFTER the CLI is up (an early line
  // plus the EOF `script` sends gets flushed away), hence the delayed feed.
  const run = (input: string, tty: boolean, cwd = folder) => {
    const q = (x: string): string => `'${x.replace(/'/g, `'\\''`)}'`
    const node = `${q(process.execPath)} ${q(cli)} init`
    const script = tty
      ? `(sleep 2; printf %s ${q(input)}; sleep 2) | script -q /dev/null ${node}`
      : `printf %s ${q(input)} | ${node}`
    return spawnSync('sh', ['-c', script], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        HOME: home,
        LUMO_CONFIG_DIR: join(home, '.lumo'),
        LUMO_NO_AUTO_UPDATE: '1',
        PATH: process.env.PATH ?? '',
      },
    })
  }
  const maybe = have ? it : it.skip
  maybe.each([
    ['y\n', true],
    ['n\n', false],
    ['\n', false],
  ])('pseudo-TTY answer %j -> wrote=%s', (ans, wrote) => {
    const r = run(ans, true)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Install Lumo here anyway? [y/N]')
    expect(existsSync(join(folder, '.claude/settings.json'))).toBe(wrote)
    if (!wrote) expect(r.stdout).toContain('Nothing written.')
  })
  maybe('a piped y is accepted (non-TTY)', () => {
    const r = run('y\n', false)
    expect(r.status).toBe(0)
    expect(existsSync(join(folder, '.claude/settings.json'))).toBe(true)
  })
  maybe('closed stdin (EOF) writes nothing and exits 0', () => {
    const r = spawnSync(process.execPath, [cli, 'init'], {
      cwd: folder,
      input: '',
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        LUMO_CONFIG_DIR: join(home, '.lumo'),
        LUMO_NO_AUTO_UPDATE: '1',
      },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Nothing written.')
    expect(tree(folder)).toEqual([])
  })
})

describe('init output: headline, stub lines and the commit block', () => {
  const gitRepo = (): string => {
    const r = tmp('lumo-t11-out-')
    execFileSync('git', ['init', '-q'], { cwd: r })
    return r
  }
  const commitSection = (out: string): string =>
    out.slice(out.indexOf('Commit these'), out.indexOf('Next:'))

  it('repo, both agents: headline names the parts; block lists exactly the five files', async () => {
    const repo = gitRepo()
    expect(await init({}, { cwd: repo, homeDir: home, ...notGlobal })).toBe(0)
    expect(stdout).toContain(
      `Installing Lumo for this repo: agent hooks, Codex rules, a /lumo skill stub and a git hook — ${repo}`
    )
    expect(stdout).toContain(
      'gives the agent /lumo ($lumo in Codex); its content never changes'
    )
    expect(stdout).toContain('gives Codex $lumo')
    const block = commitSection(stdout)
    expect(block.match(/\S+\.(json|rules|md)/g)?.sort()).toEqual(
      [
        '.agents/skills/lumo/SKILL.md',
        '.claude/settings.json',
        '.claude/skills/lumo/SKILL.md',
        '.codex/hooks.json',
        '.codex/rules/lumo.rules',
      ].sort()
    )
    expect(block).toContain('git add .claude .codex .agents')
    expect(block).not.toContain('.git/')
  })

  it('single agent lists only its files', async () => {
    const repo = gitRepo()
    await init({ agent: 'codex' }, { cwd: repo, homeDir: home, ...notGlobal })
    const block = commitSection(stdout)
    expect(block.match(/\S+\.(json|rules|md)/g)?.sort()).toEqual(
      [
        '.agents/skills/lumo/SKILL.md',
        '.codex/hooks.json',
        '.codex/rules/lumo.rules',
      ].sort()
    )
    expect(block).toContain('git add .codex .agents')
    expect(stdout).toContain(
      'Installing Lumo for this repo: agent hooks, Codex rules, a /lumo skill stub and a git hook'
    )
  })

  it('a second run changes nothing, so there is nothing to commit', async () => {
    const repo = gitRepo()
    await init({}, { cwd: repo, homeDir: home, ...notGlobal })
    stdout = ''
    await init({}, { cwd: repo, homeDir: home, ...notGlobal })
    expect(stdout).not.toContain('Commit these')
  })

  it('folder install: no commit block, says the files stay local', async () => {
    await init({}, deps('y\n'))
    expect(stdout).toContain(
      'Installing Lumo for this folder: agent hooks, Codex rules and a /lumo skill stub'
    )
    expect(stdout).not.toContain('git hook —')
    expect(stdout).not.toContain('Commit these')
    expect(stdout).toContain(
      'Not a git repo — these files stay local to this folder.'
    )
  })
})
