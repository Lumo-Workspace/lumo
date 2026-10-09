/**
 * @jest-environment node
 */
// LUM-1052 I3: copySkillTree swaps via a backup so a failed final rename can
// never lose both copies, and stages under a dot-prefixed (non-loadable) name.
const realFs = jest.requireActual<typeof import('fs')>('fs')
let failRenameTo: string | null = null
const copyTargets: string[] = []

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (
        failRenameTo !== null &&
        to === failRenameTo &&
        from.includes('.lumo-staging-')
      )
        throw Object.assign(new Error('simulated rename failure'), {
          code: 'EIO',
        })
      return actual.renameSync(from, to)
    },
    copyFileSync: (from: string, to: string) => {
      copyTargets.push(to)
      return actual.copyFileSync(from, to)
    },
  }
})

import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { copySkillTree } from '@/cli/src/lib/codex-plugin'

let root: string
let src: string
let dst: string

beforeEach(() => {
  failRenameTo = null
  copyTargets.length = 0
  root = realFs.mkdtempSync(join(tmpdir(), 'lumo-swap-'))
  src = join(root, 'src')
  dst = join(root, 'skills', 'lumo')
  realFs.mkdirSync(src)
  realFs.writeFileSync(join(src, 'SKILL.md'), 'new')
  realFs.mkdirSync(dst, { recursive: true })
  realFs.writeFileSync(join(dst, 'SKILL.md'), 'old')
})
afterEach(() => realFs.rmSync(root, { recursive: true, force: true }))

describe('copySkillTree swap (I3)', () => {
  it('restores the old copy when the staging -> dst rename fails', () => {
    failRenameTo = dst
    expect(() => copySkillTree(src, dst)).toThrow('simulated rename failure')
    expect(realFs.readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('old')
    // No staging/backup leftovers next to the skill.
    expect(realFs.readdirSync(dirname(dst))).toEqual(['lumo'])
  })

  it('stages under a dot-prefixed .lumo-staging-<pid> sibling', () => {
    copySkillTree(src, dst)
    expect(copyTargets.length).toBe(1)
    const staging = basename(dirname(copyTargets[0]!))
    expect(staging).toBe(`.lumo-staging-${process.pid}`)
    expect(dirname(dirname(copyTargets[0]!))).toBe(dirname(dst))
    expect(realFs.readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('new')
    expect(realFs.readdirSync(dirname(dst))).toEqual(['lumo'])
  })

  it('cleans stale (>1h) staging/backup siblings but keeps fresh ones', () => {
    const parent = dirname(dst)
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    for (const n of ['.lumo-staging-11', '.lumo-backup-12']) {
      realFs.mkdirSync(join(parent, n))
      realFs.writeFileSync(join(parent, n, 'SKILL.md'), 'x')
      realFs.utimesSync(join(parent, n), old, old)
    }
    realFs.mkdirSync(join(parent, '.lumo-staging-13'))
    realFs.mkdirSync(join(parent, 'other'))
    realFs.utimesSync(join(parent, 'other'), old, old)
    copySkillTree(src, dst)
    expect(realFs.readdirSync(parent).sort()).toEqual([
      '.lumo-staging-13',
      'lumo',
      'other',
    ])
  })
})
