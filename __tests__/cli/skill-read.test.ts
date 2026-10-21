/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { shouldCheckForUpdates } from '@/cli/src/lib/update-gate'
import { skillRead } from '@/cli/src/commands/skill-read'
import {
  readSkillFile,
  skillRoot,
  SKILL_READ_FOOTER,
} from '@/cli/src/lib/skill-content'

const root = skillRoot()
let stdout: string
let stderr: string
let spies: jest.SpyInstance[]
let tmpHome: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  stdout = ''
  stderr = ''
  spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
      stdout += s
      return true
    }) as never),
    jest.spyOn(console, 'error').mockImplementation(((s: string) => {
      stderr += `${s}\n`
    }) as never),
  ]
  tmpHome = mkdtempSync(join(tmpdir(), 'lumo-skill-read-'))
  for (const k of ['HOME', 'LUMO_API_URL']) saved[k] = process.env[k]
  process.env.HOME = tmpHome
  process.env.LUMO_API_URL = 'http://127.0.0.1:1'
})

afterEach(() => {
  spies.forEach(s => s.mockRestore())
  for (const k of ['HOME', 'LUMO_API_URL']) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('skill root', () => {
  it('points at the package skill dir containing SKILL.md', () => {
    expect(root.endsWith(join('cli', 'skill'))).toBe(true)
    expect(readSkillFile('SKILL.md').ok).toBe(true)
  })
})

describe('readSkillFile', () => {
  it('rejects paths that leave the root', () => {
    expect(readSkillFile('../package.json')).toEqual({
      ok: false,
      error: 'outside',
    })
    expect(readSkillFile('/etc/hosts')).toEqual({ ok: false, error: 'outside' })
  })
  it('reports a missing file', () => {
    expect(readSkillFile('references/nope.md')).toEqual({
      ok: false,
      error: 'not-found',
    })
  })
})

describe('lumo skill read', () => {
  it('prints SKILL.md plus the footer with no argument', async () => {
    const code = await skillRead(undefined)
    expect(code).toBeUndefined()
    expect(stdout).toBe(
      `${readFileSync(join(root, 'SKILL.md'), 'utf8')}\n${SKILL_READ_FOOTER}\n`
    )
  })

  it('prints a reference file byte for byte, without footer', async () => {
    await skillRead('references/tasks.md')
    expect(stdout).toBe(readFileSync(join(root, 'references/tasks.md'), 'utf8'))
  })

  it.each(['../package.json', '/etc/hosts', 'references/../../x'])(
    'exits 2 with a hint for %s',
    async p => {
      expect(await skillRead(p)).toBe(2)
      expect(stderr).toContain('Error:')
      expect(stderr).toContain('Hint:')
      expect(stdout).toBe('')
    }
  )

  it('exits 1 with a list hint when the file does not exist', async () => {
    expect(await skillRead('references/nope.md')).toBe(1)
    expect(stderr).toContain('Hint: lumo skill read')
  })
})

/** Only the local last-command record may appear under ~/.lumo. */
function expectNoInstallOrUpdateState(home: string): void {
  const dir = join(home, '.lumo')
  const names = existsSync(dir) ? readdirSync(dir) : []
  expect(names.filter(n => n !== 'last-command.json')).toEqual([])
  expect(readdirSync(home).filter(n => n !== '.lumo')).toEqual([])
}

describe('lumo skill read — real CLI process', () => {
  const ROOT = join(__dirname, '..', '..')
  let pkgDir: string

  // The CLI entry resolves package.json from the compiled layout, so build
  // the CLI into a throwaway package dir (dist/ + package.json + skill/).
  beforeAll(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'lumo-skill-read-pkg-'))
    const tsc = spawnSync(
      join(ROOT, 'node_modules/.bin/tsc'),
      ['-p', join(ROOT, 'cli/tsconfig.json'), '--outDir', join(pkgDir, 'dist')],
      { cwd: ROOT, encoding: 'utf8' }
    )
    if (tsc.status !== 0) throw new Error(`tsc failed: ${tsc.stdout}`)
    cpSync(join(ROOT, 'cli/package.json'), join(pkgDir, 'package.json'))
    cpSync(root, join(pkgDir, 'skill'), { recursive: true })
    symlinkSync(join(ROOT, 'node_modules'), join(pkgDir, 'node_modules'))
  }, 180_000)

  afterAll(() => rmSync(pkgDir, { recursive: true, force: true }))

  function run(args: string[], home: string) {
    // Update checks stay ENABLED (no LUMO_NO_UPDATE_CHECK): `skill read` must
    // skip them itself.
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of Object.keys(env))
      if (k.startsWith('LUMO_') || k === 'CLAUDECODE') delete env[k]
    Object.assign(env, { HOME: home, LUMO_API_URL: 'http://127.0.0.1:1' })
    const r = spawnSync(
      process.execPath,
      [join(pkgDir, 'dist/cli/src/index.js'), 'skill', ...args],
      { cwd: home, env, encoding: 'utf8', timeout: 60_000 }
    )
    return { status: r.status, out: r.stdout, err: r.stderr }
  }

  it('prints SKILL.md + footer with exit 0, touching nothing under HOME', () => {
    const r = run(['read'], tmpHome)
    expect(r.err).toBe('')
    expect(r.status).toBe(0)
    expect(r.out).toBe(
      `${readFileSync(join(root, 'SKILL.md'), 'utf8')}\n${SKILL_READ_FOOTER}\n`
    )
    expectNoInstallOrUpdateState(tmpHome)
  }, 90_000)

  it('exits 2 with a Hint for a path outside the skill dir', () => {
    const r = run(['read', '../package.json'], tmpHome)
    expect(r.status).toBe(2)
    expect(r.err).toContain('Error:')
    expect(r.err).toContain('Hint:')
    expectNoInstallOrUpdateState(tmpHome)
  }, 90_000)

  it('exits 1 for a missing file', () => {
    const r = run(['read', 'references/nope.md'], tmpHome)
    expect(r.status).toBe(1)
    expect(r.err).toContain('Hint: lumo skill read')
    expectNoInstallOrUpdateState(tmpHome)
  }, 90_000)
})

describe('startup gating for skill read', () => {
  const argv = (...a: string[]) => ['node', 'lumo', ...a]
  it('skips the update check / background worker', () => {
    expect(shouldCheckForUpdates(argv('skill', 'read'))).toBe(false)
    expect(
      shouldCheckForUpdates(argv('skill', 'read', 'references/x.md'))
    ).toBe(false)
  })
  it('still runs it for other commands', () => {
    expect(shouldCheckForUpdates(argv('status'))).toBe(true)
  })
})
