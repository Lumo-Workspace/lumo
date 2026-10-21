/**
 * @jest-environment node
 */
// LUM-1292: init / uninstall / doctor no longer know about skill dirs at all,
// so a committed `skills/lumo` dir under `.claude/` or `.agents/` — the Lumo
// source repo's own, or a copy a team committed — is never written, deleted
// or reported.
import { execFileSync } from 'child_process'
import {
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

it('init, doctor and uninstall leave committed skill dirs untouched', async () => {
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
  expect(paths.filter(p => p.includes('skills'))).toEqual([])
  expect(await uninstall({ confirm: true }, { cwd: root })).toBe(0)

  for (const d of dirs) {
    expect(readFileSync(join(d, 'SKILL.md'), 'utf8')).toBe('OLD COPY')
    expect(readFileSync(join(d, 'references', 'a.md'), 'utf8')).toBe('ref')
  }
})
