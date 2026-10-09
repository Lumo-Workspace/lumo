/**
 * @jest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  readRegistry,
  writeRegistry,
  upsertInstall,
  removeInstall,
  readMarker,
  writeMarker,
  registryPath,
  type InstallRecord,
} from '@/cli/src/lib/install-registry'

let cfg: string
const prev = process.env.LUMO_CONFIG_DIR
beforeEach(() => {
  cfg = mkdtempSync(join(tmpdir(), 'install-reg-'))
  process.env.LUMO_CONFIG_DIR = cfg
})
afterEach(() => {
  rmSync(cfg, { recursive: true, force: true })
  if (prev === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prev
})

const rec = (over: Partial<InstallRecord> = {}): InstallRecord => ({
  kind: 'skill',
  path: '/p/skills/lumo',
  scope: 'user',
  agent: 'claude',
  version: '1.0.0',
  installedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

describe('registry', () => {
  it('returns empty registry when file missing', () => {
    expect(readRegistry()).toEqual({ lastSyncedVersion: null, installs: [] })
  })
  it('tolerates corrupt file and bad shapes', () => {
    writeFileSync(registryPath(), '{not json')
    expect(readRegistry()).toEqual({ lastSyncedVersion: null, installs: [] })
    writeFileSync(
      registryPath(),
      JSON.stringify({ installs: 'x', lastSyncedVersion: 3 })
    )
    expect(readRegistry()).toEqual({ lastSyncedVersion: null, installs: [] })
  })
  it('write/read round trip creates config dir', () => {
    rmSync(cfg, { recursive: true, force: true })
    writeRegistry({ lastSyncedVersion: '1.2.3', installs: [rec()] })
    expect(readRegistry().lastSyncedVersion).toBe('1.2.3')
    expect(readRegistry().installs).toHaveLength(1)
  })
  it('upsert is keyed by kind+path', () => {
    upsertInstall(rec())
    upsertInstall(rec({ version: '2.0.0' }))
    upsertInstall(rec({ kind: 'git-hook' }))
    upsertInstall(rec({ path: '/other' }))
    const r = readRegistry().installs
    expect(r).toHaveLength(3)
    expect(
      r.find(i => i.kind === 'skill' && i.path === '/p/skills/lumo')!.version
    ).toBe('2.0.0')
  })
  it('remove deletes only the matching key', () => {
    upsertInstall(rec())
    upsertInstall(rec({ kind: 'git-hook' }))
    removeInstall('skill', '/p/skills/lumo')
    expect(readRegistry().installs.map(i => i.kind)).toEqual(['git-hook'])
    removeInstall('skill', '/nope')
    expect(readRegistry().installs).toHaveLength(1)
  })
  it('upsert preserves lastSyncedVersion', () => {
    writeRegistry({ lastSyncedVersion: '9.9.9', installs: [] })
    upsertInstall(rec())
    expect(readRegistry().lastSyncedVersion).toBe('9.9.9')
  })
})

describe('marker', () => {
  it('returns null when missing or corrupt', () => {
    const d = join(cfg, 'skill')
    mkdirSync(d)
    expect(readMarker(d)).toBeNull()
    writeFileSync(join(d, '.lumo-install.json'), 'zzz')
    expect(readMarker(d)).toBeNull()
  })
  it('round trips', () => {
    const d = join(cfg, 'skill')
    mkdirSync(d)
    const m = {
      version: '1.0.0',
      hash: 'sha256:ab',
      agent: 'claude',
      installedAt: 'now',
    }
    writeMarker(d, m)
    expect(readMarker(d)).toEqual(m)
    expect(
      JSON.parse(readFileSync(join(d, '.lumo-install.json'), 'utf8'))
    ).toEqual(m)
  })
})
