/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { hashSkillDir, MARKER_FILE } from '@/cli/src/lib/skill-hash'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-hash-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function make(dir: string, files: Record<string, string>, order?: string[]) {
  mkdirSync(dir, { recursive: true })
  for (const rel of order ?? Object.keys(files)) {
    const p = join(dir, rel)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, files[rel]!)
  }
}

describe('hashSkillDir', () => {
  it('has sha256:<hex> format and is stable', () => {
    make(join(root, 'a'), { 'SKILL.md': 'x' })
    const h = hashSkillDir(join(root, 'a'))
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(hashSkillDir(join(root, 'a'))).toBe(h)
  })
  it('is independent of file creation order', () => {
    const files = {
      'SKILL.md': 'x',
      'references/b.md': 'b',
      'references/a.md': 'a',
    }
    make(join(root, 'a'), files, [
      'SKILL.md',
      'references/b.md',
      'references/a.md',
    ])
    make(join(root, 'b'), files, [
      'references/a.md',
      'references/b.md',
      'SKILL.md',
    ])
    expect(hashSkillDir(join(root, 'a'))).toBe(hashSkillDir(join(root, 'b')))
  })
  it('excludes the marker file', () => {
    make(join(root, 'a'), { 'SKILL.md': 'x' })
    const h = hashSkillDir(join(root, 'a'))
    writeFileSync(join(root, 'a', MARKER_FILE), '{}')
    expect(hashSkillDir(join(root, 'a'))).toBe(h)
  })
  it('changes with content and with path', () => {
    make(join(root, 'a'), { 'SKILL.md': 'x' })
    make(join(root, 'b'), { 'SKILL.md': 'y' })
    make(join(root, 'c'), { 'OTHER.md': 'x' })
    const a = hashSkillDir(join(root, 'a'))
    expect(hashSkillDir(join(root, 'b'))).not.toBe(a)
    expect(hashSkillDir(join(root, 'c'))).not.toBe(a)
  })
})
