/**
 * @jest-environment node
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { installSkill, skillInstallDir } from '@/cli/src/commands/init'

let stdoutSpy: jest.SpyInstance

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
})
afterEach(() => {
  stdoutSpy.mockRestore()
})

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lumo-setup-codex-'))
}

function makeSkill(dir: string, body = 'skill'): void {
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  writeFileSync(join(dir, 'references', 'tasks.md'), 'tasks')
}

describe('skillInstallDir', () => {
  it('uses .agents/skills/lumo for codex', () => {
    expect(skillInstallDir('/r', 'codex')).toBe(
      join('/r', '.agents', 'skills', 'lumo')
    )
  })

  it('keeps .claude/skills/lumo for claude-code and the other agents', () => {
    expect(skillInstallDir('/r', 'claude-code')).toBe(
      join('/r', '.claude', 'skills', 'lumo')
    )
    expect(skillInstallDir('/r', 'cursor')).toBe(
      join('/r', '.claude', 'skills', 'lumo')
    )
  })
})

describe('installSkill', () => {
  it('installs SKILL.md and references/ into a fresh Codex skill dir', () => {
    const src = tmp()
    const root = tmp()
    try {
      makeSkill(src)
      const dst = skillInstallDir(root, 'codex')
      installSkill(src, dst, false)
      expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('skill')
      expect(readFileSync(join(dst, 'references', 'tasks.md'), 'utf8')).toBe(
        'tasks'
      )
      expect(existsSync(join(root, '.claude'))).toBe(false)
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves a differing install alone without --force', () => {
    const src = tmp()
    const dst = join(tmp(), 'lumo')
    try {
      makeSkill(src, 'new')
      makeSkill(dst, 'old')
      installSkill(src, dst, false)
      expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('old')
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(dst, { recursive: true, force: true })
    }
  })

  it('overwrites and drops stale top-level and reference files with --force', () => {
    const src = tmp()
    const dst = join(tmp(), 'lumo')
    try {
      makeSkill(src, 'new')
      makeSkill(dst, 'old')
      writeFileSync(join(dst, 'references', 'stale.md'), 'x')
      writeFileSync(join(dst, 'OLD.md'), 'x')
      installSkill(src, dst, true)
      expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('new')
      expect(existsSync(join(dst, 'references', 'stale.md'))).toBe(false)
      expect(existsSync(join(dst, 'OLD.md'))).toBe(false)
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(dst, { recursive: true, force: true })
    }
  })

  it('throws when the bundled skill is missing', () => {
    const src = tmp()
    try {
      expect(() => installSkill(src, join(src, 'out'), false)).toThrow(
        /reinstall @lumoai\/cli/
      )
    } finally {
      rmSync(src, { recursive: true, force: true })
    }
  })
})
