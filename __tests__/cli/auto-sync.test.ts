/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { maybeAutoSync } from '@/cli/src/lib/auto-sync'
import {
  readMarker,
  readRegistry,
  writeMarker,
  writeRegistry,
  type InstallRecord,
} from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import { LUMO_HOOK_EVENTS } from '@/cli/src/lib/hooks-template'

let root: string
let cfg: string
let bundled: string
let prevCfg: string | undefined
const lines: string[] = []
const log = (l: string): void => void lines.push(l)

function installSkillAt(dir: string, version: string, body = 'old'): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: 'claude-code',
    installedAt: new Date().toISOString(),
  })
}

function rec(path: string, over: Partial<InstallRecord> = {}): InstallRecord {
  return {
    kind: 'skill',
    path,
    scope: 'user',
    agent: 'claude-code',
    version: '1.0.0',
    installedAt: new Date().toISOString(),
    ...over,
  }
}

function seed(
  installs: InstallRecord[],
  lastSyncedVersion: string | null = null
): void {
  writeRegistry({ lastSyncedVersion, installs })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumo-autosync-'))
  cfg = join(root, 'cfg')
  bundled = join(root, 'bundled')
  mkdirSync(cfg)
  mkdirSync(bundled)
  writeFileSync(join(bundled, 'SKILL.md'), 'new')
  prevCfg = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = cfg
  lines.length = 0
})

afterEach(() => {
  if (prevCfg === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevCfg
  rmSync(root, { recursive: true, force: true })
})

describe('maybeAutoSync', () => {
  it('fast path: same lastSyncedVersion does no work', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir)], '2.0.0')
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
    expect(existsSync(join(cfg, 'auto-sync.lock'))).toBe(false)
    expect(lines).toEqual([])
  })

  it('does nothing when the CLI version is unknown', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir)])
    maybeAutoSync(null, { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
  })

  it('updates a user-scope managed older skill, marker, record, and logs once', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir)])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('new')
    expect(readMarker(dir)?.version).toBe('2.0.0')
    expect(readMarker(dir)?.hash).toBe(hashSkillDir(dir))
    const reg = readRegistry()
    expect(reg.lastSyncedVersion).toBe('2.0.0')
    expect(reg.installs[0]?.version).toBe('2.0.0')
    expect(lines).toEqual([`✓ Lumo skill updated to 2.0.0: ${dir}`])
    expect(existsSync(join(cfg, 'auto-sync.lock'))).toBe(false)
  })

  it('prints nothing when quiet (lumo hook ...) but still updates', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir)])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log, quiet: true })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('new')
    expect(lines).toEqual([])
  })

  it('leaves a git-tracked skill untouched (git status stays clean)', () => {
    const repo = join(root, 'repo')
    const dir = join(repo, '.claude', 'skills', 'lumo')
    installSkillAt(dir, '1.0.0')
    const git = (...a: string[]): void =>
      void execFileSync(
        'git',
        ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a],
        { cwd: repo, stdio: 'ignore' }
      )
    git('init')
    git('add', '.')
    git('commit', '-m', 'x')
    seed([rec(dir)])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
    expect(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repo,
        encoding: 'utf8',
      })
    ).toBe('')
    expect(lines).toEqual([])
  })

  it('skips project-scope records', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir, { scope: 'project' })])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
  })

  it('leaves a locally modified skill untouched', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    writeFileSync(join(dir, 'SKILL.md'), 'edited by user')
    seed([rec(dir)])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('edited by user')
    expect(lines).toEqual([])
  })

  it('never downgrades a skill newer than the running CLI', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '3.0.0')
    seed([rec(dir)])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
    expect(readMarker(dir)?.version).toBe('3.0.0')
  })

  it('skips while a fresh lock is held, and steals a stale one', () => {
    const dir = join(root, 'skill')
    installSkillAt(dir, '1.0.0')
    seed([rec(dir)])
    const lock = join(cfg, 'auto-sync.lock')
    writeFileSync(lock, '')
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('old')
    expect(readRegistry().lastSyncedVersion).toBeNull()
    expect(existsSync(lock)).toBe(true)

    const old = new Date(Date.now() - 120_000)
    utimesSync(lock, old, old)
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe('new')
    expect(existsSync(lock)).toBe(false)
  })

  it('swallows errors and does not mark the version synced', () => {
    const settings = join(root, 'settings.json')
    writeFileSync(settings, '{ not json')
    seed([rec(settings, { kind: 'claude-settings' })])
    expect(() =>
      maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    ).not.toThrow()
    expect(readRegistry().lastSyncedVersion).toBeNull()
    expect(existsSync(join(cfg, 'auto-sync.lock'))).toBe(false)
  })

  it('re-merges hooks only when the Lumo event set differs', () => {
    const settings = join(root, 'settings.json')
    writeFileSync(settings, JSON.stringify({ permissions: { allow: [] } }))
    seed([rec(settings, { kind: 'claude-settings' })])
    maybeAutoSync('2.0.0', { bundledSkillDir: bundled, log })
    const merged = JSON.parse(readFileSync(settings, 'utf8'))
    expect(Object.keys(merged.hooks)).toEqual(
      expect.arrayContaining(LUMO_HOOK_EVENTS.map(e => e[0]))
    )
    expect(merged.permissions).toEqual({ allow: [] })

    // Already complete: file must not be rewritten.
    const before = readFileSync(settings, 'utf8')
    const stamp = new Date(Date.now() - 100_000)
    utimesSync(settings, stamp, stamp)
    writeRegistry({ ...readRegistry(), lastSyncedVersion: '2.0.0' })
    maybeAutoSync('2.1.0', { bundledSkillDir: bundled, log })
    expect(readFileSync(settings, 'utf8')).toBe(before)
  })
})
