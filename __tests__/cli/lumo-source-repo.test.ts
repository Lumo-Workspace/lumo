/**
 * @jest-environment node
 */
// LUM-1292: init / uninstall / doctor only know the frozen `SKILL.md` stub in
// `.claude/skills/lumo` and `.agents/skills/lumo`: an old full copy there is
// replaced by the stub (and removed again by uninstall), but its other files
// (`references/`) are never touched.
import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { collectDoctor } from '@/cli/src/commands/doctor'
import { init } from '@/cli/src/commands/init'
import { uninstall } from '@/cli/src/commands/uninstall'
import { LUMO_SKILL_STUB } from '@/cli/src/lib/skill-stub'

jest.mock('@/cli/src/lib/session-record-notice', () => ({
  fetchSessionRecordNotice: async () => null,
}))

let roots: string[]
let prevCfg: string | undefined
let outSpy: jest.SpyInstance
let errSpy: jest.SpyInstance

const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'lumo-src-')))
  roots.push(d)
  return d
}

beforeEach(() => {
  roots = []
  prevCfg = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = tmp()
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => {
  outSpy.mockRestore()
  errSpy.mockRestore()
  if (prevCfg === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevCfg
  for (const d of roots) rmSync(d, { recursive: true, force: true })
})

it('init and uninstall touch only SKILL.md of a committed skill dir', async () => {
  const root = tmp()
  execFileSync('git', ['init', '-q'], { cwd: root })
  const dirs = [
    join(root, '.claude', 'skills', 'lumo'),
    join(root, '.agents', 'skills', 'lumo'),
  ]
  for (const d of dirs) {
    mkdirSync(join(d, 'references'), { recursive: true })
    writeFileSync(join(d, 'SKILL.md'), 'OLD COPY')
    writeFileSync(join(d, 'references', 'a.md'), 'ref')
  }

  expect(await init({}, { cwd: root, isGlobalInstall: () => false })).toBe(0)
  const paths = collectDoctor({ cwd: root }).rows.map(r => r.path)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter(p => p.includes('references'))).toEqual([])
  for (const d of dirs)
    expect(readFileSync(join(d, 'SKILL.md'), 'utf8')).toBe(LUMO_SKILL_STUB)
  expect(await uninstall({ confirm: true }, { cwd: root })).toBe(0)

  for (const d of dirs) {
    expect(existsSync(join(d, 'SKILL.md'))).toBe(false)
    expect(readFileSync(join(d, 'references', 'a.md'), 'utf8')).toBe('ref')
  }
})
