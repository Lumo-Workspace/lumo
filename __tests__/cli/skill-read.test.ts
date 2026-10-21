/**
 * @jest-environment node
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { skillRead } from '@/cli/src/commands/skill-read'
import {
  readSkillFile,
  skillRoot,
  SKILL_READ_FOOTER,
} from '@/cli/src/lib/skill-content'

const root = skillRoot()
let stdout: string
let stderr: string
let spies: jest.SpyInstance[]
let tmpHome: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  stdout = ''
  stderr = ''
  spies = [
    jest.spyOn(process.stdout, 'write').mockImplementation(((s: string) => {
      stdout += s
      return true
    }) as never),
    jest.spyOn(console, 'error').mockImplementation(((s: string) => {
      stderr += `${s}\n`
    }) as never),
  ]
  tmpHome = mkdtempSync(join(tmpdir(), 'lumo-skill-read-'))
  for (const k of ['HOME', 'LUMO_API_URL']) saved[k] = process.env[k]
  process.env.HOME = tmpHome
  process.env.LUMO_API_URL = 'http://127.0.0.1:1'
})

afterEach(() => {
  spies.forEach(s => s.mockRestore())
  for (const k of ['HOME', 'LUMO_API_URL']) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(tmpHome, { recursive: true, force: true })
})

describe('skill root', () => {
  it('points at the package skill dir containing SKILL.md', () => {
    expect(root.endsWith(join('cli', 'skill'))).toBe(true)
    expect(readSkillFile('SKILL.md').ok).toBe(true)
  })
})

describe('readSkillFile', () => {
  it('rejects paths that leave the root', () => {
    expect(readSkillFile('../package.json')).toEqual({
      ok: false,
      error: 'outside',
    })
    expect(readSkillFile('/etc/hosts')).toEqual({ ok: false, error: 'outside' })
  })
  it('reports a missing file', () => {
    expect(readSkillFile('references/nope.md')).toEqual({
      ok: false,
      error: 'not-found',
    })
  })
})

describe('lumo skill read', () => {
  it('prints SKILL.md plus the footer with no argument', async () => {
    const code = await skillRead(undefined)
    expect(code).toBeUndefined()
    expect(stdout).toBe(
      `${readFileSync(join(root, 'SKILL.md'), 'utf8')}\n${SKILL_READ_FOOTER}\n`
    )
  })

  it('prints a reference file byte for byte, without footer', async () => {
    await skillRead('references/tasks.md')
    expect(stdout).toBe(readFileSync(join(root, 'references/tasks.md'), 'utf8'))
  })

  it.each(['../package.json', '/etc/hosts', 'references/../../x'])(
    'exits 2 with a hint for %s',
    async p => {
      expect(await skillRead(p)).toBe(2)
      expect(stderr).toContain('Error:')
      expect(stderr).toContain('Hint:')
      expect(stdout).toBe('')
    }
  )

  it('exits 1 with a list hint when the file does not exist', async () => {
    expect(await skillRead('references/nope.md')).toBe(1)
    expect(stderr).toContain('Hint: lumo skill read')
  })
})
