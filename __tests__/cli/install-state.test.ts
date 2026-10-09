/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { classifySkillDir, isNewerVersion } from '@/cli/src/lib/install-state'
import { hashSkillDir } from '@/cli/src/lib/skill-hash'
import { writeMarker } from '@/cli/src/lib/install-registry'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'install-state-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function skill(name = 'skill', body = 'hello'): string {
  const d = join(root, name)
  mkdirSync(join(d, 'references'), { recursive: true })
  writeFileSync(join(d, 'SKILL.md'), body)
  writeFileSync(join(d, 'references', 'a.md'), 'ref')
  return d
}
const marker = (d: string, hash = hashSkillDir(d)) =>
  writeMarker(d, { version: '1.5.0', hash, agent: 'claude', installedAt: 'x' })

describe('classifySkillDir', () => {
  it('missing', () => {
    expect(classifySkillDir(join(root, 'none'), {})).toEqual({
      state: 'missing',
      gitTracked: false,
    })
  })
  it('managed via clean marker', () => {
    const d = skill()
    marker(d)
    expect(classifySkillDir(d, {})).toMatchObject({
      state: 'managed',
      version: '1.5.0',
      gitTracked: false,
    })
  })
  it('modified when marker hash differs from content', () => {
    const d = skill()
    marker(d)
    writeFileSync(join(d, 'SKILL.md'), 'edited')
    expect(classifySkillDir(d, {}).state).toBe('modified')
  })
  it('managed via legacy hash hit (no marker)', () => {
    const d = skill()
    const table = { [hashSkillDir(d)]: '1.2.0' }
    expect(classifySkillDir(d, table)).toMatchObject({
      state: 'managed',
      version: '1.2.0',
    })
  })
  it('modified on legacy miss (no marker)', () => {
    const d = skill()
    expect(classifySkillDir(d, { 'sha256:other': '1.0.0' }).state).toBe(
      'modified'
    )
  })
  it('default table loads from bundled json', () => {
    const d = skill()
    expect(classifySkillDir(d).state).toBe('modified')
  })
  it('gitTracked when files are committed', () => {
    const d = skill()
    const git = (...a: string[]) =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], {
        cwd: root,
        stdio: 'ignore',
      })
    git('init', '-q')
    git('add', '.')
    git('commit', '-qm', 'x', '--no-gpg-sign')
    expect(classifySkillDir(d, {}).gitTracked).toBe(true)
  })
  it('gitTracked false for untracked dir in a repo', () => {
    const d = skill()
    execFileSync('git', ['init', '-q'], { cwd: root })
    expect(classifySkillDir(d, {}).gitTracked).toBe(false)
  })
  it('fails closed: an unreadable git index counts as tracked', () => {
    const d = skill()
    execFileSync('git', ['init', '-q'], { cwd: root })
    writeFileSync(join(root, '.git', 'index'), 'garbage')
    expect(classifySkillDir(d, {}).gitTracked).toBe(true)
  })
  it('git not installed counts as untracked', () => {
    const d = skill()
    const prev = process.env.PATH
    process.env.PATH = ''
    try {
      expect(classifySkillDir(d, {}).gitTracked).toBe(false)
    } finally {
      process.env.PATH = prev
    }
  })
})

describe('isNewerVersion', () => {
  it('delegates to isNewer semantics', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(false)
  })
})
