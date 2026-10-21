/**
 * @jest-environment node
 */
// LUM-1292 Task 10: the frozen project-level skill stub.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  LUMO_SKILL_STUB,
  classifySkillStub,
  installSkillStub,
  removeSkillStub,
  skillStubPaths,
} from '@/cli/src/lib/skill-stub'

// FREEZE GUARD: the literal below is the stub every repo already has. A
// deliberate edit must change it here AND in skill-stub.ts, and means every
// repo has to re-run `lumo init`.
const FROZEN = [
  '---',
  'name: lumo',
  "description: Use for this repository's task tracking in Lumo — creating, finding, filing, picking, starting, resuming or finishing tasks and bugs, a task id (LUM-42, SPEC-12 or any team prefix), the `lumo` CLI, test cases, milestones, sprints or team memory. Prefer it over other task trackers here.",
  '---',
  '',
  'Run `lumo skill read` first and follow it. It prints the current guide for the installed Lumo CLI; read linked files with `lumo skill read <path>`.',
  '',
  'If `lumo` is not found: `npm install -g @lumoai/cli`, then `lumo auth login`.',
  '',
].join('\n')

let dir: string
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-stub-')))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('LUMO_SKILL_STUB', () => {
  it('is byte-for-byte the frozen text', () => {
    expect(LUMO_SKILL_STUB).toBe(FROZEN)
  })

  it('has frontmatter name lumo, a description within 1024 chars, and points at skill read', () => {
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n([\s\S]*)$/.exec(
      LUMO_SKILL_STUB
    )
    expect(m).not.toBeNull()
    expect(m![1]).toBe('lumo')
    expect(m![2]!.length).toBeLessThanOrEqual(1024)
    expect(m![3]).toContain('lumo skill read')
    expect(LUMO_SKILL_STUB.length).toBeLessThanOrEqual(700)
    expect(LUMO_SKILL_STUB.endsWith('\n')).toBe(true)
    expect(LUMO_SKILL_STUB).not.toMatch(/\d+\.\d+\.\d+/) // no version
  })
})

describe('skillStubPaths', () => {
  it('returns both stubs by default', () => {
    expect(skillStubPaths(dir)).toEqual([
      join(dir, '.claude/skills/lumo/SKILL.md'),
      join(dir, '.agents/skills/lumo/SKILL.md'),
    ])
  })
  it('narrows to the selected agent', () => {
    expect(skillStubPaths(dir, ['codex'])).toEqual([
      join(dir, '.agents/skills/lumo/SKILL.md'),
    ])
    expect(skillStubPaths(dir, ['claude-code'])).toEqual([
      join(dir, '.claude/skills/lumo/SKILL.md'),
    ])
  })
})

describe('install / classify / remove', () => {
  it('creates, is idempotent, and overwrites different content', () => {
    const f = join(dir, '.claude/skills/lumo/SKILL.md')
    expect(classifySkillStub(f)).toBe('missing')
    expect(installSkillStub(f)).toBe('created')
    expect(readFileSync(f, 'utf8')).toBe(LUMO_SKILL_STUB)
    expect(classifySkillStub(f)).toBe('current')
    expect(installSkillStub(f)).toBe('unchanged')
    writeFileSync(f, 'mine')
    expect(classifySkillStub(f)).toBe('differs')
    expect(installSkillStub(f)).toBe('updated')
    expect(readFileSync(f, 'utf8')).toBe(LUMO_SKILL_STUB)
  })

  it('removal drops the empty lumo dir but never a sibling skill', () => {
    const f = join(dir, '.claude/skills/lumo/SKILL.md')
    installSkillStub(f)
    mkdirSync(join(dir, '.claude/skills/other'), { recursive: true })
    writeFileSync(join(dir, '.claude/skills/other/SKILL.md'), 'x')
    expect(removeSkillStub(f)).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/lumo'))).toBe(false)
    expect(existsSync(join(dir, '.claude/skills/other/SKILL.md'))).toBe(true)
    expect(removeSkillStub(f)).toBe(false)
  })

  it('keeps the lumo dir when other files live in it', () => {
    const f = join(dir, '.claude/skills/lumo/SKILL.md')
    installSkillStub(f)
    writeFileSync(join(dir, '.claude/skills/lumo/notes.md'), 'x')
    removeSkillStub(f)
    expect(existsSync(join(dir, '.claude/skills/lumo/notes.md'))).toBe(true)
  })
})
