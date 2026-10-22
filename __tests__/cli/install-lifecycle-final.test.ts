/**
 * @jest-environment node
 */
// LUM-1052 final review fixes still relevant after LUM-1292 (project-only
// install): I5 (symlinks into a git repo count as tracked), M4 (git-diff note
// for a tracked settings.json), M7 (git hooks are labelled agent "git").
import { execFileSync } from 'child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { init } from '@/cli/src/commands/init'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { planUninstall, uninstall } from '@/cli/src/commands/uninstall'
import { isPathGitTracked } from '@/cli/src/lib/repo-root'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'
import { HOOK_SCRIPT_BLOCK } from '@/cli/src/lib/git-hook-template'

jest.mock('@/cli/src/lib/cli-version', () => ({
  readCliVersion: jest.fn(() => '2.0.0'),
  findCliPackageRoot: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let roots: string[]
let prevCfg: string | undefined
let stdout: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-final-')))
  roots.push(d)
  return d
}
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })
function gitInit(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
}
function commitAll(dir: string): void {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'x')
}
/** A settings file with exactly one Lumo hook event (so it is "incomplete"). */
function partialSettings(file: string): void {
  const [ev, slug] = LUMO_HOOK_EVENTS[0]!
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(
    file,
    JSON.stringify({
      hooks: {
        [ev]: [
          {
            hooks: [
              {
                type: 'command',
                command: `lumo hook ${slug} --agent claude-code`,
              },
            ],
          },
        ],
      },
    }) + '\n'
  )
}

beforeEach(() => {
  roots = []
  stdout = ''
  prevCfg = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(c => {
    stdout += String(c)
    return true
  })
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevCfg === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevCfg
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

describe('I5: a symlinked settings.json into another git repo counts as tracked', () => {
  function stow() {
    const dotfiles = tmp()
    gitInit(dotfiles)
    partialSettings(join(dotfiles, 'claude', 'settings.json'))
    commitAll(dotfiles)
    const repo = tmp()
    gitInit(repo)
    mkdirSync(join(repo, '.claude'), { recursive: true })
    const settings = join(repo, '.claude', 'settings.json')
    symlinkSync(join(dotfiles, 'claude', 'settings.json'), settings)
    return { repo, settings }
  }

  it('isPathGitTracked resolves symlinks', () => {
    expect(isPathGitTracked(stow().settings)).toBe(true)
  })

  it('doctor and uninstall flag it as tracked', async () => {
    const s = stow()
    const deps = {
      homeDir: tmp(),
      cwd: s.repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    const row = collectDoctor(deps).rows.find(r => r.path === s.settings)
    expect(row?.tracked).toBe(true)
    expect(await uninstall({}, { ...deps, argv: ['uninstall'] })).toBe(4)
    expect(stdout).toContain(
      `Remove the Lumo hook entries from ${s.settings}; other settings and hooks are kept ⚠ committed`
    )
  })
})

describe('M4: plain init notes git diff for a tracked settings.json', () => {
  it('prints the git-diff note for a tracked settings.json', async () => {
    const project = tmp()
    gitInit(project)
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude', 'settings.json'), '{}\n')
    commitAll(project)
    await init({}, { cliVersion: '2.0.0', cwd: project })
    expect(stdout).toContain(
      `ℹ ${join(project, '.claude', 'settings.json')} is tracked by git — the change shows up in \`git diff\``
    )
  })
})

describe('M7: git-hook rows are labelled agent "git"', () => {
  it('doctor labels the hook git; uninstall --agent picks it only for git', async () => {
    const repo = tmp()
    gitInit(repo)
    const hook = join(repo, '.git', 'hooks', 'prepare-commit-msg')
    mkdirSync(join(hook, '..'), { recursive: true })
    writeFileSync(hook, `#!/bin/sh\n${HOOK_SCRIPT_BLOCK}\n`)
    const deps = {
      homeDir: tmp(),
      cwd: repo,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    expect(collectDoctor(deps).rows.find(r => r.path === hook)?.agent).toBe(
      'git'
    )
    const cc = planUninstall({ agent: 'claude-code' }, deps)
    expect(cc.actions.map(a => a.row.path)).not.toContain(hook)
    const g = planUninstall({ agent: 'git' }, deps)
    expect(g.actions.map(a => a.row.path)).toEqual([hook])
  })
})
