/**
 * @jest-environment node
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { update } from '@/cli/src/commands/update'
import { collectDoctor } from '@/cli/src/commands/doctor'

let cfg: string
let prevCfg: string | undefined
let prevCi: string | undefined
let prevNo: string | undefined
let out: string
let err: string

beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'lumo-updauto-'))
  prevCfg = process.env.LUMO_CONFIG_DIR
  prevCi = process.env.CI
  prevNo = process.env.LUMO_NO_AUTO_UPDATE
  process.env.LUMO_CONFIG_DIR = cfg
  delete process.env.CI
  delete process.env.LUMO_NO_AUTO_UPDATE
  out = ''
  err = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(process.stderr, 'write').mockImplementation(s => {
    err += String(s)
    return true
  })
})
afterEach(() => {
  jest.restoreAllMocks()
  for (const [k, v] of [
    ['LUMO_CONFIG_DIR', prevCfg],
    ['CI', prevCi],
    ['LUMO_NO_AUTO_UPDATE', prevNo],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(cfg, { recursive: true, force: true })
})

describe('lumo update --auto', () => {
  it('off persists the setting and prints the new state', async () => {
    expect(await update({ auto: 'off' })).toBe(0)
    expect(
      JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
    ).toEqual({ autoUpdate: false })
    expect(out).toContain('Auto-update: off')
    expect(out).toContain('lumo update --auto on')
  })
  it('on persists true', async () => {
    expect(await update({ auto: 'on' })).toBe(0)
    expect(
      JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
    ).toEqual({ autoUpdate: true })
    expect(out).toContain('Auto-update: on')
  })
  it('rejects other values without writing', async () => {
    expect(await update({ auto: 'maybe' })).toBe(2)
    expect(err).toContain('"on" or "off"')
  })
})

describe('doctor auto-update line', () => {
  it('reports the state in the report, using the env seam', () => {
    const base = { homeDir: cfg, cwd: cfg, cliVersion: '1.0.0' }
    process.env.LUMO_NO_AUTO_UPDATE = '1' // must be ignored when env is injected
    expect(collectDoctor({ ...base, env: { PATH: '' } }).autoUpdate).toEqual({
      enabled: true,
      source: 'default',
    })
    expect(
      collectDoctor({ ...base, env: { PATH: '', CI: 'true' } }).autoUpdate
    ).toEqual({ enabled: false, source: 'ci' })
  })
})

describe('manual lumo update while a background update runs', () => {
  it('refuses with exit 1 and does not start a second install', async () => {
    mkdirSync(cfg, { recursive: true })
    writeFileSync(join(cfg, 'auto-update.lock'), '')
    expect(await update()).toBe(1)
    expect(err).toContain('a background update is in progress')
  })
})
