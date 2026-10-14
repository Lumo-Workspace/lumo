/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import {
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
import { collectDoctor } from '@/cli/src/commands/doctor'
import { init } from '@/cli/src/commands/init'
import { uninstall } from '@/cli/src/commands/uninstall'
import { maybeAutoSync } from '@/cli/src/lib/auto-sync'
import {
  isLumoSourceRepo,
  isLumoSkillSource,
} from '@/cli/src/lib/install-locations'
import {
  readMarker,
  writeMarker,
  writeRegistry,
} from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))
jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let roots: string[]
let prevCfg: string | undefined
let stdout: string
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-src-')))
  roots.push(d)
  return d
}

/** A repo shaped like the Lumo source repo, skill SOURCE included. */
function sourceRepo() {
  const root = tmp()
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(join(root, 'cli'), { recursive: true })
  writeFileSync(join(root, 'cli', 'package.json'), '{"name":"@lumoai/cli"}')
  const skill = join(root, '.claude', 'skills', 'lumo')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), 'SOURCE')
  return { root, skill }
}
/** Make the source dir look like a managed v1 copy so an upgrade WOULD write it. */
function markManaged(skill: string): void {
  writeMarker(skill, {
    version: '1.0.0',
    hash: hashSkillDir(skill),
    agent: 'claude-code',
    installedAt: '2026-01-01T00:00:00.000Z',
  })
}
function bundledSkill(): string {
  const d = join(tmp(), 'skill')
  mkdirSync(d)
  writeFileSync(join(d, 'SKILL.md'), 'bundled')
  return d
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

describe('isLumoSourceRepo / isLumoSkillSource', () => {
  it('needs both the @lumoai/cli package and the skill SKILL.md', () => {
    const { root, skill } = sourceRepo()
    expect(isLumoSourceRepo(root)).toBe(true)
    expect(isLumoSkillSource(skill)).toBe(true)
    expect(isLumoSkillSource(join(root, '.agents', 'skills', 'lumo'))).toBe(
      false
    )
    rmSync(join(skill, 'SKILL.md'))
    expect(isLumoSourceRepo(root)).toBe(false)
    const other = tmp()
    mkdirSync(join(other, 'cli'))
    writeFileSync(join(other, 'cli', 'package.json'), '{"name":"x"}')
    mkdirSync(join(other, '.claude', 'skills', 'lumo'), { recursive: true })
    writeFileSync(join(other, '.claude', 'skills', 'lumo', 'SKILL.md'), 'a')
    expect(isLumoSourceRepo(other)).toBe(false)
    expect(isLumoSourceRepo(join(other, 'missing'))).toBe(false)
  })
})

describe('the Lumo skill source is never written or deleted', () => {
  it('init --project --force leaves it alone', async () => {
    const { root, skill } = sourceRepo()
    const code = await init(
      { project: true, force: true },
      {
        cliVersion: '2.0.0',
        homeDir: tmp(),
        cwd: root,
        bundledSkillDir: bundledSkill(),
      }
    )
    expect(code).toBe(0)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
    expect(existsSync(join(skill, '.lumo-install.json'))).toBe(false)
  })

  it('init --project --dry-run previews it as left untouched', async () => {
    const { root, skill } = sourceRepo()
    markManaged(skill)
    const code = await init(
      { project: true, agent: 'claude-code', dryRun: true },
      {
        cliVersion: '2.0.0',
        homeDir: tmp(),
        cwd: root,
        bundledSkillDir: bundledSkill(),
      }
    )
    expect(code).toBe(0)
    expect(stdout).toContain(
      `⚠ skip ${skill} — skill: Lumo skill source (not an install) — left untouched`
    )
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
    expect(readMarker(skill)?.version).toBe('1.0.0')
  })

  it('auto-sync leaves it alone', () => {
    const { skill } = sourceRepo()
    markManaged(skill)
    writeRegistry({
      lastSyncedVersion: null,
      installs: [
        {
          kind: 'skill',
          path: skill,
          scope: 'user',
          agent: 'claude-code',
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    maybeAutoSync('2.0.0', {
      bundledSkillDir: bundledSkill(),
      quiet: true,
      // never scan the real ~ for legacy copies
      homeDir: join(skill, '..', '..', '..', 'no-home'),
    })
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
    expect(readMarker(skill)?.version).toBe('1.0.0')
  })

  it('doctor labels it a skill source with no suggestion', () => {
    const { root, skill } = sourceRepo()
    const r = collectDoctor({
      homeDir: tmp(),
      cwd: root,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    })
    const row = r.rows.find(x => x.path === skill)
    expect(row?.state).toBe('Lumo skill source (not an install)')
    expect(row?.suggestion).toBeUndefined()
  })

  it('uninstall never deletes it, not even with --force', async () => {
    const { root, skill } = sourceRepo()
    markManaged(skill)
    const deps = {
      homeDir: tmp(),
      cwd: root,
      cliVersion: '2.0.0',
      env: { PATH: '' },
    }
    await uninstall({ confirm: true, force: true }, deps)
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
    stdout = ''
    await uninstall({ force: true }, { ...deps, argv: ['uninstall'] })
    expect(stdout).not.toContain(`Delete skill dir ${skill}`)
  })
})

describe('symlinks and registry cannot route around the guard', () => {
  /** home whose skill dir reaches the source via a leaf or a parent link. */
  function linkedHome(mode: 'leaf' | 'parent') {
    const src = sourceRepo()
    const home = tmp()
    if (mode === 'leaf') {
      mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
      symlinkSync(src.skill, join(home, '.claude', 'skills', 'lumo'))
    } else {
      symlinkSync(join(src.root, '.claude'), join(home, '.claude'))
    }
    return { ...src, home, via: join(home, '.claude', 'skills', 'lumo') }
  }
  const depsFor = (home: string, cwd: string) => ({
    homeDir: home,
    cwd,
    cliVersion: '2.0.0',
    env: { PATH: '' },
  })

  it.each(['leaf', 'parent'] as const)(
    'isLumoSkillSource sees through a %s symlink',
    mode => {
      const l = linkedHome(mode)
      expect(isLumoSkillSource(l.via)).toBe(true)
    }
  )

  it.each(['leaf', 'parent'] as const)(
    'uninstall --force never deletes the source through a %s symlink',
    async mode => {
      const l = linkedHome(mode)
      markManaged(l.skill)
      await uninstall({ confirm: true, force: true }, depsFor(l.home, tmp()))
      expect(readFileSync(join(l.skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
      expect(existsSync(join(l.skill, 'SKILL.md'))).toBe(true)
    }
  )

  it.each(['leaf', 'parent'] as const)(
    'init --user --force never writes the source through a %s symlink',
    async mode => {
      const l = linkedHome(mode)
      await init(
        { user: true, force: true },
        {
          cliVersion: '2.0.0',
          homeDir: l.home,
          cwd: tmp(),
          bundledSkillDir: bundledSkill(),
        }
      )
      expect(readFileSync(join(l.skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
      expect(existsSync(join(l.skill, '.lumo-install.json'))).toBe(false)
    }
  )

  it('a registry skill record pointing at the source is ignored from another repo', async () => {
    const { skill } = sourceRepo()
    markManaged(skill)
    writeRegistry({
      lastSyncedVersion: null,
      installs: [
        {
          kind: 'skill',
          path: skill,
          scope: 'project',
          agent: 'claude-code',
          version: '1.0.0',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    await uninstall({ confirm: true, force: true }, depsFor(tmp(), tmp()))
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toBe('SOURCE')
  })
})
