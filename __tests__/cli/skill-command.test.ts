/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import {
  shellQuote,
  skillStatus,
  skillUpdate,
  type SkillDeps,
} from '@/cli/src/commands/skill'
import {
  diffSkillDirs,
  SKILL_STATUS_SCHEMA_VERSION,
} from '@/cli/src/lib/skill-copies'
import {
  readMarker,
  readRegistry,
  registryPath,
  writeMarker,
} from '@/cli/src/lib/install-registry'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import { shouldAutoSync } from '@/cli/src/lib/auto-sync'

jest.mock('@/cli/src/lib/skill-version-hashes.json', () => ({}))

const CLI = '2.0.0'
let tmpRoots: string[]
let prevConfigDir: string | undefined
let out: string
let err: string

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-skill-')))
  tmpRoots.push(d)
  return d
}

beforeEach(() => {
  tmpRoots = []
  out = ''
  err = ''
  prevConfigDir = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
})
afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevConfigDir
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

function gitInit(dir: string): void {
  git(dir, 'init', '-q')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
}

/** A skill dir: SKILL.md + references/a.md (+ optional extra files). */
function writeSkill(
  dir: string,
  body: string,
  extra: Record<string, string> = {}
): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'a.md'), 'ref\n')
  for (const [f, c] of Object.entries(extra)) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), c)
  }
}

/** A Lumo-managed copy at `version`: files plus a marker whose hash matches. */
function managedSkill(
  dir: string,
  version: string,
  body = `body ${version}\n`,
  extra: Record<string, string> = {}
): void {
  writeSkill(dir, body, extra)
  writeMarker(dir, {
    version,
    hash: hashSkillDir(dir),
    agent: 'claude-code',
    installedAt: '2026-01-01T00:00:00.000Z',
  })
}

/** sha256 per file under `root` (skips `.git` internals except hooks). */
function snapshot(root: string): Record<string, string> {
  const res: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name)
      const rel = relative(root, full)
      if (e.isDirectory()) {
        if (rel === '.git') {
          if (existsSync(join(full, 'hooks'))) walk(join(full, 'hooks'))
          continue
        }
        walk(full)
      } else if (e.isFile()) {
        res[rel] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk(root)
  return res
}

function world(bundledBody = 'body 2.0.0\nnew line\n') {
  const home = tmp()
  const project = tmp()
  gitInit(project)
  const bundled = join(tmp(), 'skills', 'lumo')
  writeSkill(bundled, bundledBody, { 'references/new.md': 'n1\nn2\n' })
  const deps: SkillDeps = {
    cliVersion: CLI,
    homeDir: home,
    cwd: project,
    bundledSkillDir: bundled,
    out: s => void (out += s),
    err: s => void (err += s),
    render: { tty: false, color: false },
  }
  return {
    home,
    project,
    bundled,
    deps,
    userClaude: join(home, '.claude', 'skills', 'lumo'),
    userCodex: join(home, '.agents', 'skills', 'lumo'),
    projClaude: join(project, '.claude', 'skills', 'lumo'),
    projCodex: join(project, '.agents', 'skills', 'lumo'),
  }
}

async function statusJson(deps: SkillDeps) {
  out = ''
  expect(await skillStatus({ json: true }, deps)).toBe(0)
  return JSON.parse(out) as {
    version: number
    schemaVersion: number
    cliVersion: string
    skills: Array<Record<string, unknown>>
  }
}

describe('lumo skill status', () => {
  it('classifies up to date, behind, newer and modified copies', async () => {
    const w = world()
    managedSkill(w.userClaude, '2.0.0')
    managedSkill(w.userCodex, '1.0.0')
    managedSkill(w.projClaude, '3.0.0')
    managedSkill(w.projCodex, '1.0.0')
    writeFileSync(join(w.projCodex, 'SKILL.md'), 'edited by hand\n')

    const s = await statusJson(w.deps)
    const byPath = Object.fromEntries(s.skills.map(x => [x.path, x]))
    expect(byPath[w.userClaude]).toMatchObject({
      state: 'up-to-date',
      version: '2.0.0',
      scope: 'user',
      agent: 'claude-code',
    })
    expect(byPath[w.userCodex]).toMatchObject({
      state: 'behind',
      version: '1.0.0',
      agent: 'codex',
    })
    expect(byPath[w.projClaude]).toMatchObject({
      state: 'newer',
      version: '3.0.0',
      scope: 'project',
    })
    // modified keeps the version its marker last recorded
    expect(byPath[w.projCodex]).toMatchObject({
      state: 'modified',
      version: '1.0.0',
    })
  })

  it('reports the Lumo source repo skill as source and git tracking', async () => {
    const w = world()
    // Make the project look like the Lumo source repo.
    mkdirSync(join(w.project, 'cli'), { recursive: true })
    writeFileSync(
      join(w.project, 'cli', 'package.json'),
      JSON.stringify({ name: '@lumoai/cli' })
    )
    writeSkill(w.projClaude, 'source body\n')
    managedSkill(w.projCodex, '1.0.0')
    git(w.project, 'add', '.')
    git(w.project, 'commit', '-qm', 'init')

    const s = await statusJson(w.deps)
    const byPath = Object.fromEntries(s.skills.map(x => [x.path, x]))
    expect(byPath[w.projClaude]).toMatchObject({
      state: 'source',
      gitTracked: true,
    })
    expect(byPath[w.projCodex]).toMatchObject({
      state: 'behind',
      gitTracked: true,
    })
  })

  it('--json has a versioned, stable field set', async () => {
    const w = world()
    managedSkill(w.userClaude, '1.0.0')
    const s = await statusJson(w.deps)
    expect(Object.keys(s).sort()).toEqual([
      'cliVersion',
      'schemaVersion',
      'skills',
      'version',
    ])
    expect(s.version).toBe(1)
    expect(s.schemaVersion).toBe(SKILL_STATUS_SCHEMA_VERSION)
    expect(s.schemaVersion).toBe(1)
    expect(s.cliVersion).toBe(CLI)
    expect(s.skills).toHaveLength(1)
    expect(Object.keys(s.skills[0]!)).toEqual([
      'path',
      'scope',
      'agent',
      'version',
      'state',
      'gitTracked',
    ])
    expect(s.skills[0]).toEqual({
      path: w.userClaude,
      scope: 'user',
      agent: 'claude-code',
      version: '1.0.0',
      state: 'behind',
      gitTracked: false,
    })
  })

  it('includes recorded installs from other repos and prints a table', async () => {
    const w = world()
    const other = join(tmp(), 'repo', '.claude', 'skills', 'lumo')
    managedSkill(other, '1.0.0')
    writeFileSync(
      registryPath(),
      JSON.stringify({
        lastSyncedVersion: null,
        installs: [
          {
            kind: 'skill',
            path: other,
            scope: 'project',
            agent: 'claude-code',
            version: '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    )
    managedSkill(w.userClaude, '2.0.0')
    expect(await skillStatus({}, w.deps)).toBe(0)
    expect(out).toContain('Lumo skill copies (CLI 2.0.0)')
    expect(out).toContain('~/.claude/skills/lumo')
    expect(out).toContain(other)
    expect(out).toContain('behind CLI')
    expect(out).toContain('lumo skill update')
  })

  it('says so when no copy exists', async () => {
    const w = world()
    expect(await skillStatus({}, w.deps)).toBe(0)
    expect(out).toContain('No Lumo skill copies found')
  })
})

describe('lumo skill update', () => {
  /** settings.json, Codex hooks/rules and the git hook, user and project. */
  function writeNonSkillInstalls(w: ReturnType<typeof world>): string[] {
    const files = [
      join(w.home, '.claude', 'settings.json'),
      join(w.home, '.codex', 'hooks.json'),
      join(w.home, '.codex', 'rules', 'lumo.rules'),
      join(w.project, '.claude', 'settings.json'),
      join(w.project, '.codex', 'hooks.json'),
      join(w.project, '.codex', 'rules', 'lumo.rules'),
      join(w.project, '.git', 'hooks', 'prepare-commit-msg'),
    ]
    for (const f of files) {
      mkdirSync(join(f, '..'), { recursive: true })
      // deliberately stale Lumo content that re-running init would rewrite
      writeFileSync(f, `{"hooks":{"Stop":[]}} # ${f}\n`)
    }
    return files
  }

  it('updates only skill dirs; hooks/settings/rules bytes unchanged', async () => {
    const w = world()
    managedSkill(w.userClaude, '1.0.0', 'old\n', {
      'references/gone.md': 'x\n',
    })
    managedSkill(w.projCodex, '1.0.0')
    const files = writeNonSkillInstalls(w)
    const before = files.map(f => readFileSync(f))

    expect(await skillUpdate({}, w.deps)).toBe(0)

    files.forEach((f, i) =>
      expect(readFileSync(f).equals(before[i]!)).toBe(true)
    )
    for (const dir of [w.userClaude, w.projCodex]) {
      expect(diffSkillDirs(w.bundled, dir)).toEqual([])
      expect(readMarker(dir)).toMatchObject({ version: CLI })
      expect(readMarker(dir)!.hash).toBe(hashSkillDir(dir))
    }
    expect(existsSync(join(w.userClaude, 'references', 'gone.md'))).toBe(false)
    const reg = readRegistry().installs
    expect(reg.map(r => r.kind)).toEqual(['skill', 'skill'])
    expect(reg.every(r => r.version === CLI)).toBe(true)
    expect(out).toContain('2 of 2 updated')
  })

  it('skips a modified copy without --force and overwrites it with --force', async () => {
    const w = world()
    managedSkill(w.userClaude, '1.0.0')
    writeFileSync(join(w.userClaude, 'SKILL.md'), 'my edits\n')

    expect(await skillUpdate({}, w.deps)).toBe(0)
    expect(readFileSync(join(w.userClaude, 'SKILL.md'), 'utf8')).toBe(
      'my edits\n'
    )
    expect(out).toContain('modified locally')

    out = ''
    expect(await skillUpdate({ force: true }, w.deps)).toBe(0)
    expect(diffSkillDirs(w.bundled, w.userClaude)).toEqual([])
    expect(readMarker(w.userClaude)).toMatchObject({ version: CLI })
  })

  it('never downgrades a newer copy, even with --force', async () => {
    const w = world()
    managedSkill(w.userClaude, '3.0.0')
    const before = snapshot(w.userClaude)
    expect(await skillUpdate({ force: true }, w.deps)).toBe(0)
    expect(snapshot(w.userClaude)).toEqual(before)
    expect(out).toContain('newer than this CLI')
  })

  it('never downgrades a modified copy whose marker is newer, even with --force', async () => {
    const w = world()
    managedSkill(w.userClaude, '3.0.0')
    writeFileSync(join(w.userClaude, 'SKILL.md'), 'edited\n')
    const before = snapshot(w.userClaude)
    expect(await skillUpdate({ force: true }, w.deps)).toBe(0)
    expect(snapshot(w.userClaude)).toEqual(before)
    expect(out).toContain('3.0.0 is newer than this CLI')
  })

  it('never touches the Lumo source repo skill, even with --force', async () => {
    const w = world()
    mkdirSync(join(w.project, 'cli'), { recursive: true })
    writeFileSync(
      join(w.project, 'cli', 'package.json'),
      JSON.stringify({ name: '@lumoai/cli' })
    )
    writeSkill(w.projClaude, 'source body\n')
    const before = snapshot(w.projClaude)
    expect(await skillUpdate({ force: true }, w.deps)).toBe(0)
    expect(snapshot(w.projClaude)).toEqual(before)
    expect(out).toContain('Lumo skill source')
  })

  it('--dry-run lists added/modified/deleted files with line counts and writes nothing', async () => {
    const w = world()
    managedSkill(w.userClaude, '1.0.0', 'body 1.0.0\n', {
      'references/gone.md': 'g1\ng2\ng3\n',
    })
    writeNonSkillInstalls(w)
    const config = process.env.LUMO_CONFIG_DIR!
    const before = [snapshot(w.home), snapshot(w.project), snapshot(config)]

    expect(await skillUpdate({ dryRun: true }, w.deps)).toBe(0)

    expect([snapshot(w.home), snapshot(w.project), snapshot(config)]).toEqual(
      before
    )
    expect(existsSync(registryPath())).toBe(false)
    expect(out).toContain('dry run, nothing is written')
    expect(out).toContain(
      'would update ~/.claude/skills/lumo (1.0.0 → 2.0.0): 3 files changed'
    )
    expect(out).toContain('~ SKILL.md (+2 −1)')
    expect(out).toContain('+ references/new.md (+2)')
    expect(out).toContain('- references/gone.md (−3)')
    expect(out).toContain('1 of 1 would be updated')
  })

  it('changes a git-tracked copy without committing and asks for a PR', async () => {
    const w = world()
    managedSkill(w.projClaude, '1.0.0')
    git(w.project, 'add', '.')
    git(w.project, 'commit', '-qm', 'init')
    const head = git(w.project, 'rev-parse', 'HEAD')

    expect(await skillUpdate({ scope: 'project' }, w.deps)).toBe(0)

    expect(git(w.project, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(w.project, 'status', '--porcelain')).toContain(
      '.claude/skills/lumo/'
    )
    expect(out).toMatch(/tracked by git — modified 2 files .*open a PR/)
  })

  it('filters by --user / --project / --agent', async () => {
    const w = world()
    managedSkill(w.userClaude, '1.0.0')
    managedSkill(w.userCodex, '1.0.0')
    managedSkill(w.projClaude, '1.0.0')

    expect(await skillUpdate({ scope: 'user', agent: 'codex' }, w.deps)).toBe(0)
    expect(readMarker(w.userCodex)!.version).toBe(CLI)
    expect(readMarker(w.userClaude)!.version).toBe('1.0.0')
    expect(readMarker(w.projClaude)!.version).toBe('1.0.0')

    expect(await skillUpdate({ scope: 'project' }, w.deps)).toBe(0)
    expect(readMarker(w.projClaude)!.version).toBe(CLI)
    expect(readMarker(w.userClaude)!.version).toBe('1.0.0')
  })

  it('rejects an invalid --scope and an unknown agent', async () => {
    const w = world()
    expect(await skillUpdate({ scope: 'both' }, w.deps)).toBe(2)
    expect(err).toContain('invalid --scope "both"')
    expect(await skillUpdate({ agent: 'nope' }, w.deps)).toBe(2)
    expect(err).toContain('Unknown agent "nope"')
  })

  describe('LUM-1122: copies recorded in other repos are never written', () => {
    function register(
      ...recs: Array<{ path: string; agent?: string; version?: string }>
    ): void {
      writeFileSync(
        registryPath(),
        JSON.stringify({
          lastSyncedVersion: null,
          installs: recs.map(r => ({
            kind: 'skill',
            path: r.path,
            scope: 'project',
            agent: r.agent ?? 'claude-code',
            version: r.version ?? '1.0.0',
            installedAt: '2026-01-01T00:00:00.000Z',
          })),
        })
      )
    }

    /** Another git repo with a behind copy and a modified copy, both recorded. */
    function otherRepo() {
      const root = tmp()
      gitInit(root)
      const claude = join(root, '.claude', 'skills', 'lumo')
      const codex = join(root, '.agents', 'skills', 'lumo')
      managedSkill(claude, '1.0.0')
      managedSkill(codex, '1.0.0')
      writeFileSync(join(codex, 'SKILL.md'), 'hand edits in the other repo\n')
      register({ path: claude }, { path: codex, agent: 'codex' })
      return { root, claude, codex }
    }

    it.each([
      ['--project --force', { scope: 'project', force: true }],
      ['--project', { scope: 'project' }],
      ['no scope --force', { force: true }],
    ])(
      '%s updates only the current repo; the other repo is byte-identical',
      async (_label, opts) => {
        const w = world()
        managedSkill(w.projClaude, '1.0.0')
        const other = otherRepo()
        const before = snapshot(other.root)

        expect(await skillUpdate(opts, w.deps)).toBe(0)

        expect(snapshot(other.root)).toEqual(before)
        expect(readMarker(w.projClaude)).toMatchObject({ version: CLI })
        expect(diffSkillDirs(w.bundled, w.projClaude)).toEqual([])
        expect(out).toContain('1 of 1 updated')
        expect(out).not.toContain(`updated ${other.claude}`)
        expect(out).toContain(`· ${other.claude}: in another repo`)
        expect(out).toContain(`cd ${other.root} && lumo skill update`)
        // registry records of the other repo keep their old version
        const reg = readRegistry().installs
        expect(reg.find(r => r.path === other.claude)?.version).toBe('1.0.0')
      }
    )

    it('--dry-run lists only the current repo copy as would-update', async () => {
      const w = world()
      managedSkill(w.projCodex, '1.0.0')
      const other = otherRepo()
      const before = snapshot(other.root)

      expect(
        await skillUpdate(
          { scope: 'project', force: true, dryRun: true, agent: 'codex' },
          w.deps
        )
      ).toBe(0)

      expect(snapshot(other.root)).toEqual(before)
      expect(out).toContain(`would update ${w.projCodex}`)
      expect(out).not.toContain(`would update ${other.codex}`)
      expect(out).toContain(`· ${other.codex}: in another repo`)
      expect(out).toContain('1 of 1 would be updated')
    })

    it('--user writes only user copies, never a recorded project copy', async () => {
      const w = world()
      managedSkill(w.userClaude, '1.0.0')
      managedSkill(w.projClaude, '1.0.0')
      const other = otherRepo()
      const before = snapshot(other.root)

      expect(await skillUpdate({ scope: 'user', force: true }, w.deps)).toBe(0)

      expect(snapshot(other.root)).toEqual(before)
      expect(readMarker(w.userClaude)!.version).toBe(CLI)
      expect(readMarker(w.projClaude)!.version).toBe('1.0.0')
      expect(out).not.toContain('in another repo')
    })

    it('in a git worktree nested in the main checkout, writes only the worktree copy', async () => {
      const w = world()
      const main = w.project
      managedSkill(join(main, '.agents', 'skills', 'lumo'), '1.0.0')
      git(main, 'add', '.')
      git(main, 'commit', '-qm', 'init')
      const wt = join(main, '.worktrees', 'LUM-1-x')
      git(main, 'worktree', 'add', '-q', '-b', 'lumo/LUM-1-x', wt)
      const mainCodex = join(main, '.agents', 'skills', 'lumo')
      const wtCodex = join(wt, '.agents', 'skills', 'lumo')
      register(
        { path: mainCodex, agent: 'codex' },
        { path: wtCodex, agent: 'codex' }
      )
      const mainBefore = snapshot(mainCodex)

      // From the worktree: the main checkout's copy is "another repo".
      expect(
        await skillUpdate(
          { scope: 'project', force: true, agent: 'codex' },
          { ...w.deps, cwd: wt }
        )
      ).toBe(0)
      expect(snapshot(mainCodex)).toEqual(mainBefore)
      expect(readMarker(wtCodex)!.version).toBe(CLI)
      expect(out).toContain(`· ${mainCodex}: in another repo`)

      // From the main checkout: the worktree copy (under main's dir) is not written.
      managedSkill(wtCodex, '1.0.0')
      const wtBefore = snapshot(wtCodex)
      out = ''
      expect(
        await skillUpdate(
          { scope: 'project', force: true, agent: 'codex' },
          w.deps
        )
      ).toBe(0)
      expect(snapshot(wtCodex)).toEqual(wtBefore)
      expect(readMarker(mainCodex)!.version).toBe(CLI)
      expect(out).toContain(`· ${wtCodex}: in another repo`)
    })

    it('says nothing is to update here when every copy is in another repo', async () => {
      const w = world()
      const other = otherRepo()
      const before = snapshot(other.root)

      expect(await skillUpdate({ scope: 'project', force: true }, w.deps)).toBe(
        0
      )

      expect(snapshot(other.root)).toEqual(before)
      expect(out).toContain(`· ${other.claude}: in another repo`)
      expect(out).toContain('Nothing to update in this repo')
      expect(out).not.toContain('0 of 0')
    })

    it('shell-quotes a repo path that needs it in the hint', () => {
      expect(shellQuote('/home/me/repo-1.x')).toBe('/home/me/repo-1.x')
      expect(shellQuote('/home/me/my repo')).toBe("'/home/me/my repo'")
      expect(shellQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'")
    })

    it('skill status still lists other-repo copies, with a run-it-there hint', async () => {
      const w = world()
      managedSkill(w.projClaude, '2.0.0')
      const other = otherRepo()

      const s = await statusJson(w.deps)
      expect(s.skills.map(x => x.path)).toEqual(
        expect.arrayContaining([w.projClaude, other.claude, other.codex])
      )

      out = ''
      expect(await skillStatus({}, w.deps)).toBe(0)
      expect(out).toContain(other.claude)
      expect(out).toContain(
        '2 in other repos — `lumo skill update` only writes the current repo; run it in that repo.'
      )
      // the "behind" hint does not count the other repo's copy
      expect(out).not.toContain('behind the CLI — run')
    })
  })

  it('is excluded from the first-run auto-sync (which also rewrites hooks)', () => {
    expect(shouldAutoSync(['node', 'lumo', 'skill', 'update'])).toBe(false)
    expect(shouldAutoSync(['node', 'lumo', 'skill', 'status'])).toBe(false)
  })
})

describe('diffSkillDirs', () => {
  it('is empty for identical dirs and ignores the install marker', () => {
    const a = join(tmp(), 'a')
    const b = join(tmp(), 'b')
    writeSkill(a, 'same\n')
    managedSkill(b, '1.0.0', 'same\n')
    expect(diffSkillDirs(a, b)).toEqual([])
  })

  it('counts lines per added, modified and deleted file', () => {
    const a = join(tmp(), 'a')
    const b = join(tmp(), 'b')
    writeSkill(a, 'x\ny\nz\n', { 'new.md': 'n\n' })
    writeSkill(b, 'x\nold\n', { 'old/deep.md': 'd1\nd2\n' })
    expect(diffSkillDirs(a, b)).toEqual([
      { file: 'new.md', change: 'added', linesAdded: 1, linesRemoved: 0 },
      {
        file: 'old/deep.md',
        change: 'deleted',
        linesAdded: 0,
        linesRemoved: 2,
      },
      { file: 'SKILL.md', change: 'modified', linesAdded: 2, linesRemoved: 1 },
    ])
  })
})
