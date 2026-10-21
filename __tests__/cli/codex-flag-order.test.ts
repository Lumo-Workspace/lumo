/**
 * @jest-environment node
 *
 * LUM-1292: global flags before the command words of a non-server-only
 * command are refused (exit 2), because Codex's prompt rules match the
 * leading tokens only.
 */
import { spawnSync } from 'child_process'
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  codexFlagOrderError,
  flagsBeforeCommandWords,
  isServerOnlyPath,
} from '@/cli/src/lib/codex-flag-order'
import { skillRoot } from '@/cli/src/lib/skill-content'

describe('flagsBeforeCommandWords', () => {
  it.each([
    [['--no-hints', 'init'], 'init', true],
    [['--project', 'app', 'doc', 'create', '--file', 'x'], 'doc create', true],
    [['doc', '--project', 'x', 'create'], 'doc create', true],
    [['doc', 'create', '--project', 'app', '--file', 'x'], 'doc create', false],
    [['init', '--no-hints'], 'init', false],
    [['init'], 'init', false],
    [['-x', 'task', 'update', 'LUM-1'], 'task update', true],
    [['task', 'update', 'LUM-1', '--no-hints'], 'task update', false],
    [['doc', 'create', '--', '--x'], 'doc create', false],
    [[], 'init', false],
  ])('%j for `%s` -> %s', (argv, path, expected) => {
    expect(flagsBeforeCommandWords(argv, path)).toBe(expected)
  })
})

describe('codexFlagOrderError', () => {
  it('names the problem and shows the reordered command', () => {
    expect(
      codexFlagOrderError(
        ['--project', 'app', 'doc', 'create', '--file', 'x'],
        'doc create'
      )
    ).toEqual([
      expect.stringMatching(/^Error: global flags before the command words/),
      'Hint: put the global flags after the command words, e.g. `lumo doc create --file x --project app`.',
    ])
  })

  it('is silent for server-only commands and for correct order', () => {
    expect(isServerOnlyPath('skill read')).toBe(true)
    expect(isServerOnlyPath('init')).toBe(false)
    expect(
      codexFlagOrderError(['--no-hints', 'skill', 'read'], 'skill read')
    ).toBeNull()
    expect(codexFlagOrderError(['init', '--no-hints'], 'init')).toBeNull()
  })
})

describe('spawned CLI', () => {
  const ROOT = join(__dirname, '../..')
  let pkgDir: string
  let home: string

  beforeAll(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'lumo-flag-order-pkg-'))
    home = mkdtempSync(join(tmpdir(), 'lumo-flag-order-home-'))
    const tsc = spawnSync(
      join(ROOT, 'node_modules/.bin/tsc'),
      ['-p', join(ROOT, 'cli/tsconfig.json'), '--outDir', join(pkgDir, 'dist')],
      { cwd: ROOT, encoding: 'utf8' }
    )
    if (tsc.status !== 0) throw new Error(`tsc failed: ${tsc.stdout}`)
    cpSync(join(ROOT, 'cli/package.json'), join(pkgDir, 'package.json'))
    cpSync(skillRoot(), join(pkgDir, 'skill'), { recursive: true })
    symlinkSync(join(ROOT, 'node_modules'), join(pkgDir, 'node_modules'))
  }, 180_000)

  afterAll(() => {
    rmSync(pkgDir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  function run(args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const k of Object.keys(env))
      if (k.startsWith('LUMO_') || k === 'CLAUDECODE') delete env[k]
    Object.assign(env, { HOME: home, LUMO_API_URL: 'http://127.0.0.1:1' })
    const r = spawnSync(
      process.execPath,
      [join(pkgDir, 'dist/cli/src/index.js'), ...args],
      { cwd: home, env, encoding: 'utf8', timeout: 60_000 }
    )
    return { status: r.status, out: r.stdout, err: r.stderr }
  }

  it.each([
    ['--no-hints', 'init'],
    ['--project', 'app', 'doc', 'create', '--file', 'x'],
    ['doc', '--project', 'app', 'create', '--file', 'x'],
    ['--no-hints', 'update'],
  ])(
    '`lumo %s` exits 2 with Error and Hint before doing anything',
    (...args) => {
      const r = run(args)
      expect(r.status).toBe(2)
      expect(r.err).toContain('Error: global flags before the command words')
      expect(r.err).toContain(
        'Hint: put the global flags after the command words'
      )
      expect(r.out).toBe('')
    },
    90_000
  )

  it('a server-only command keeps free flag order (`lumo --no-hints skill read`)', () => {
    const r = run(['--no-hints', 'skill', 'read'])
    expect(r.status).toBe(0)
  }, 90_000)

  it('the correct order passes the guard (`lumo init --help`)', () => {
    const r = run(['init', '--no-hints', '--help'])
    expect(r.status).toBe(0)
    expect(r.err).not.toContain('global flags before')
  }, 90_000)
})
