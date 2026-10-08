/**
 * @jest-environment node
 */
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readSkillInstalls,
  recordSkillInstall,
  skillDirFor,
  syncSkills,
  isLumoSourceCheckout,
} from '@/cli/src/lib/skill-install'
import { skillSync } from '@/cli/src/commands/skill-sync'
import { update, type RunCommand } from '@/cli/src/commands/update'
import { installSkill } from '@/cli/src/commands/setup'

let base: string
let stdoutSpy: jest.SpyInstance
let stderrSpy: jest.SpyInstance
const savedConfigDir = process.env.LUMO_CONFIG_DIR

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
}

function read(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), 'utf8')
}

const NEW = { 'SKILL.md': 'new skill', 'references/a.md': 'new a' }
const OLD = {
  'SKILL.md': 'old skill',
  'references/a.md': 'old a',
  'references/stale.md': 'gone in new version',
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'lumo-skill-sync-'))
  process.env.LUMO_CONFIG_DIR = join(base, 'config')
  writeTree(join(base, 'bundle'), NEW)
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  if (savedConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = savedConfigDir
  rmSync(base, { recursive: true, force: true })
})

describe('skill install registry', () => {
  it('records a location once, as an absolute path', () => {
    const dir = join(base, 'proj', '.claude', 'skills', 'lumo')
    recordSkillInstall(dir)
    recordSkillInstall(dir)
    expect(readSkillInstalls()).toEqual([dir])
  })

  it('reads a malformed registry as empty', () => {
    mkdirSync(join(base, 'config'), { recursive: true })
    writeFileSync(join(base, 'config', 'skill-installs.json'), '{not json')
    expect(readSkillInstalls()).toEqual([])
  })
})

describe('installSkill (setup)', () => {
  it('records the project install location', () => {
    const claudeDir = join(base, 'proj', '.claude')
    installSkill(claudeDir, false, join(base, 'bundle'))
    expect(readSkillInstalls()).toEqual([join(claudeDir, 'skills', 'lumo')])
    expect(existsSync(join(claudeDir, 'skills', 'lumo', 'SKILL.md'))).toBe(true)
  })
})

describe('installSkill registry failure', () => {
  it('still installs the skill when the registry cannot be written', () => {
    writeFileSync(join(base, 'not-a-dir'), '')
    process.env.LUMO_CONFIG_DIR = join(base, 'not-a-dir')
    const claudeDir = join(base, 'proj', '.claude')
    installSkill(claudeDir, false, join(base, 'bundle'))
    expect(existsSync(join(claudeDir, 'skills', 'lumo', 'SKILL.md'))).toBe(true)
    expect(stdoutSpy.mock.calls.join('')).toContain('could not record')
  })
})

describe('syncSkills', () => {
  it('a failing location does not stop the others and stays registered', async () => {
    const bad = skillDirFor(join(base, 'bad'))
    const good = skillDirFor(join(base, 'good'))
    writeTree(bad, OLD)
    writeTree(good, OLD)
    recordSkillInstall(bad)
    recordSkillInstall(good)
    chmodSync(bad, 0o555)
    try {
      const results = syncSkills(join(base, 'bundle')).results
      expect(results.map(r => r.outcome)).toEqual(['failed', 'updated'])
      expect(read(good, 'SKILL.md')).toBe('new skill')
      expect(readSkillInstalls()).toEqual([bad, good])
      expect(
        await skillSync({
          srcDir: join(base, 'bundle'),
          homeDir: join(base, 'home'),
          cwd: join(base, 'proj'),
        })
      ).toBe(1)
    } finally {
      chmodSync(bad, 0o755)
    }
  })

  it('rewrites an outdated recorded install and drops stale references', () => {
    const dir = skillDirFor(join(base, 'proj'))
    writeTree(dir, OLD)
    recordSkillInstall(dir)

    const results = syncSkills(join(base, 'bundle')).results

    expect(results).toEqual([{ skillDir: dir, outcome: 'updated', files: 2 }])
    expect(read(dir, 'SKILL.md')).toBe('new skill')
    expect(read(dir, 'references/a.md')).toBe('new a')
    expect(existsSync(join(dir, 'references', 'stale.md'))).toBe(false)
  })

  it('a registry write failure keeps the per-location results', async () => {
    const proj = skillDirFor(join(base, 'proj'))
    writeTree(proj, OLD)
    writeFileSync(join(base, 'not-a-dir'), '')
    process.env.LUMO_CONFIG_DIR = join(base, 'not-a-dir')

    const { results, registryError } = syncSkills(join(base, 'bundle'), [proj])
    expect(results.map(r => r.outcome)).toEqual(['updated'])
    expect(registryError).toBeTruthy()
    expect(read(proj, 'SKILL.md')).toBe('new skill')

    writeTree(proj, OLD)
    const code = await skillSync({
      srcDir: join(base, 'bundle'),
      homeDir: join(base, 'home'),
      cwd: join(base, 'proj'),
    })
    expect(code).toBe(1)
    expect(stdoutSpy.mock.calls.join('')).toContain('updated skill')
    expect(stderrSpy.mock.calls.join('')).toContain(
      'could not save the install registry'
    )
  })

  it('reports an identical install as up to date', () => {
    const dir = skillDirFor(join(base, 'proj'))
    writeTree(dir, NEW)
    recordSkillInstall(dir)
    expect(syncSkills(join(base, 'bundle')).results[0]!.outcome).toBe(
      'up-to-date'
    )
  })

  it('forgets a recorded install that no longer exists', () => {
    const dir = skillDirFor(join(base, 'deleted-proj'))
    recordSkillInstall(dir)
    expect(syncSkills(join(base, 'bundle')).results[0]!.outcome).toBe('missing')
    expect(readSkillInstalls()).toEqual([])
  })

  it('discovers and registers a pre-registry install, ignores empty candidates', () => {
    const dir = skillDirFor(join(base, 'home'))
    writeTree(dir, OLD)
    const nowhere = skillDirFor(join(base, 'no-skill-here'))

    const results = syncSkills(join(base, 'bundle'), [dir, nowhere]).results

    expect(results.map(r => r.outcome)).toEqual(['updated'])
    expect(readSkillInstalls()).toEqual([dir])
  })

  it('never overwrites the Lumo source checkout', () => {
    const repo = join(base, 'lumo-repo')
    writeTree(repo, { 'cli/scripts/bundle-assets.js': '' })
    const dir = skillDirFor(repo)
    writeTree(dir, OLD)
    recordSkillInstall(dir)

    expect(isLumoSourceCheckout(dir)).toBe(true)
    expect(syncSkills(join(base, 'bundle')).results[0]!.outcome).toBe('source')
    expect(read(dir, 'SKILL.md')).toBe('old skill')
    expect(readSkillInstalls()).toEqual([dir])
  })
})

describe('skillSync command', () => {
  it('refreshes the home and cwd installs', async () => {
    const home = skillDirFor(join(base, 'home'))
    const proj = skillDirFor(join(base, 'proj'))
    writeTree(home, OLD)
    writeTree(proj, OLD)

    const code = await skillSync({
      srcDir: join(base, 'bundle'),
      homeDir: join(base, 'home'),
      cwd: join(base, 'proj'),
    })

    expect(code).toBe(0)
    expect(read(home, 'SKILL.md')).toBe('new skill')
    expect(read(proj, 'SKILL.md')).toBe('new skill')
  })

  it('says so when nothing is installed', async () => {
    const code = await skillSync({
      srcDir: join(base, 'bundle'),
      homeDir: join(base, 'home'),
      cwd: join(base, 'proj'),
    })
    expect(code).toBe(0)
    expect(stdoutSpy.mock.calls.join('')).toContain('No installed lumo skill')
  })

  it('fails when the bundled skill is missing', async () => {
    expect(await skillSync({ srcDir: join(base, 'nope') })).toBe(1)
  })
})

describe('update', () => {
  const pkg = { name: '@lumoai/cli', version: '1.0.0' }

  function fakeGlobalRoot(): string {
    const root = join(base, 'global', 'node_modules')
    writeTree(root, { '@lumoai/cli/dist/cli/src/index.js': '' })
    return root
  }

  it('after a successful npm upgrade, syncs skills with the newly installed entry point', async () => {
    const root = fakeGlobalRoot()
    const calls: string[][] = []
    const run: RunCommand = async (cmd, args) => {
      calls.push([cmd, ...args])
      return 0
    }
    const syncInProcess = jest.fn(async () => 0)

    const code = await update({
      pkg,
      fetchLatest: async () => '1.1.0',
      run,
      syncInProcess,
      globalRoot: () => root,
    })

    expect(code).toBe(0)
    expect(calls).toEqual([
      ['npm', 'install', '-g', '@lumoai/cli@latest'],
      [
        process.execPath,
        join(root, '@lumoai/cli/dist/cli/src/index.js'),
        'skill',
        'sync',
      ],
    ])
    expect(syncInProcess).not.toHaveBeenCalled()
  })

  it('cannot locate the new install: no PATH guess, points at the manual command', async () => {
    const calls: string[][] = []
    const code = await update({
      pkg,
      fetchLatest: async () => '1.1.0',
      run: async (cmd, args) => {
        calls.push([cmd, ...args])
        return 0
      },
      globalRoot: () => join(base, 'empty-root'),
    })
    expect(code).toBe(1)
    expect(calls).toHaveLength(1)
    expect(stderrSpy.mock.calls.join('')).toContain('lumo skill sync')
  })

  it('does not sync when the npm upgrade fails', async () => {
    const calls: string[][] = []
    const code = await update({
      pkg,
      fetchLatest: async () => '1.1.0',
      run: async (cmd, args) => {
        calls.push([cmd, ...args])
        return 1
      },
    })
    expect(code).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('already on the latest version: syncs skills in-process', async () => {
    const run = jest.fn<Promise<number>, [string, string[]]>()
    const syncInProcess = jest.fn(async () => 0)

    const code = await update({
      pkg,
      fetchLatest: async () => '1.0.0',
      run,
      syncInProcess,
    })

    expect(code).toBe(0)
    expect(syncInProcess).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })
})
