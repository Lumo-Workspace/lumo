/**
 * @jest-environment node
 */
import { EventEmitter } from 'events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getAutoUpdateStatus,
  describeAutoUpdate,
  isGlobalNpmInstall,
  maybeAutoUpdate,
  readAutoUpdateState,
  writeAutoUpdateSetting,
} from '@/cli/src/lib/auto-update'
import { acquireFileLock } from '@/cli/src/lib/file-lock'
import { findCliPackageRoot } from '@/cli/src/lib/cli-version'

const isNewer = (c: string, l: string): boolean => c !== l && l > c

let root: string
let cfg: string
let globalRoot: string
let pkgRoot: string
let prevCfg: string | undefined
const baseEnv: Record<string, string | undefined> = {}

function fakeSpawnSync(stdout: string, status = 0) {
  return jest.fn(() => ({ status, stdout }))
}

type FakeChild = EventEmitter & { stderr: EventEmitter; unref: jest.Mock }
function fakeSpawn(exit: { code?: number; error?: Error; stderr?: string }) {
  const calls: Array<{ cmd: string; args: string[]; opts: any }> = []
  const fn = jest.fn((cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter() as FakeChild
    child.stderr = new EventEmitter()
    child.unref = jest.fn()
    setImmediate(() => {
      if (exit.stderr) child.stderr.emit('data', Buffer.from(exit.stderr))
      if (exit.error) child.emit('error', exit.error)
      else child.emit('close', exit.code ?? 0)
    })
    return child
  })
  return { fn, calls }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lumo-autoupd-'))
  cfg = join(root, 'cfg')
  globalRoot = join(root, 'npm-global', 'lib', 'node_modules')
  pkgRoot = join(globalRoot, '@lumoai', 'cli')
  mkdirSync(pkgRoot, { recursive: true })
  prevCfg = process.env.LUMO_CONFIG_DIR
  process.env.LUMO_CONFIG_DIR = cfg
})
afterEach(() => {
  if (prevCfg === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = prevCfg
  rmSync(root, { recursive: true, force: true })
})

function run(
  over: Partial<Parameters<typeof maybeAutoUpdate>[3]> & {
    spawnFn?: ReturnType<typeof fakeSpawn>
  } = {}
) {
  const sp = over.spawnFn ?? fakeSpawn({ code: 0 })
  const sync = over.spawnSync ?? fakeSpawnSync(globalRoot + '\n')
  return {
    sp,
    sync,
    p: maybeAutoUpdate('1.0.0', '1.1.0', isNewer, {
      env: baseEnv,
      pkgRoot,
      spawnSync: sync as any,
      spawn: sp.fn as any,
      ...over,
      ...(over.spawnFn ? { spawn: sp.fn as any } : {}),
    }),
  }
}

describe('getAutoUpdateStatus', () => {
  it('defaults to on', () => {
    expect(getAutoUpdateStatus(baseEnv)).toEqual({
      enabled: true,
      source: 'default',
    })
    expect(describeAutoUpdate(getAutoUpdateStatus(baseEnv))).toContain(
      'lumo update --auto off'
    )
  })
  it('is off via the setting and keeps other keys', () => {
    mkdirSync(cfg, { recursive: true })
    writeFileSync(join(cfg, 'settings.json'), '{"other":1}')
    writeAutoUpdateSetting(false)
    expect(
      JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'))
    ).toEqual({ other: 1, autoUpdate: false })
    expect(getAutoUpdateStatus(baseEnv)).toEqual({
      enabled: false,
      source: 'setting',
    })
    writeAutoUpdateSetting(true)
    expect(getAutoUpdateStatus(baseEnv).enabled).toBe(true)
  })
  it('is off via LUMO_NO_AUTO_UPDATE=1 or CI', () => {
    expect(getAutoUpdateStatus({ LUMO_NO_AUTO_UPDATE: '1' })).toEqual({
      enabled: false,
      source: 'env',
    })
    expect(getAutoUpdateStatus({ CI: 'true' }).source).toBe('ci')
    expect(getAutoUpdateStatus({ CI: '1' }).enabled).toBe(false)
    expect(getAutoUpdateStatus({ CI: 'false' }).enabled).toBe(true)
    expect(getAutoUpdateStatus({ CI: '0' }).enabled).toBe(true)
    expect(getAutoUpdateStatus({ CI: '' }).enabled).toBe(true)
  })
})

describe('isGlobalNpmInstall', () => {
  it('true when pkg root is <npm root -g>/@lumoai/cli (via symlink too)', () => {
    expect(isGlobalNpmInstall(pkgRoot, fakeSpawnSync(globalRoot) as any)).toBe(
      true
    )
    const link = join(root, 'link-root')
    symlinkSync(globalRoot, link)
    expect(isGlobalNpmInstall(pkgRoot, fakeSpawnSync(link) as any)).toBe(true)
  })
  it('false for a different dir, npm failure, or missing root', () => {
    const other = join(root, 'repo', 'cli')
    mkdirSync(other, { recursive: true })
    expect(isGlobalNpmInstall(other, fakeSpawnSync(globalRoot) as any)).toBe(
      false
    )
    expect(isGlobalNpmInstall(pkgRoot, fakeSpawnSync('', 1) as any)).toBe(false)
    expect(isGlobalNpmInstall(null, fakeSpawnSync(globalRoot) as any)).toBe(
      false
    )
    expect(
      isGlobalNpmInstall(pkgRoot, (() => {
        throw new Error('ENOENT')
      }) as any)
    ).toBe(false)
  })
})

describe('findCliPackageRoot', () => {
  it('finds the @lumoai/cli package dir walking up', () => {
    mkdirSync(join(pkgRoot, 'dist', 'x'), { recursive: true })
    writeFileSync(join(pkgRoot, 'package.json'), '{"name":"@lumoai/cli"}')
    expect(findCliPackageRoot(join(pkgRoot, 'dist', 'x'))).toBe(pkgRoot)
  })
})

describe('maybeAutoUpdate', () => {
  it('installs the new version detached when on by default', async () => {
    const { sp, p } = run()
    await p
    expect(sp.calls).toHaveLength(1)
    expect(sp.calls[0]!.cmd).toBe('npm')
    expect(sp.calls[0]!.args).toEqual(['install', '-g', '@lumoai/cli@1.1.0'])
    expect(sp.calls[0]!.opts.detached).toBe(true)
    expect(readAutoUpdateState().lastAutoUpdateAttempt).toEqual(
      expect.any(Number)
    )
    expect(existsSync(join(cfg, 'auto-update.lock'))).toBe(false)
  })

  it('skips when disabled by setting', async () => {
    writeAutoUpdateSetting(false)
    const { sp, p } = run()
    await p
    expect(sp.fn).not.toHaveBeenCalled()
  })

  it('skips under LUMO_NO_AUTO_UPDATE and CI', async () => {
    for (const env of [{ LUMO_NO_AUTO_UPDATE: '1' }, { CI: 'true' }]) {
      const { sp, p } = run({ env })
      await p
      expect(sp.fn).not.toHaveBeenCalled()
    }
  })

  it('skips when no newer version exists', async () => {
    const sp = fakeSpawn({ code: 0 })
    await maybeAutoUpdate('1.1.0', '1.1.0', isNewer, {
      env: baseEnv,
      pkgRoot,
      spawnSync: fakeSpawnSync(globalRoot) as any,
      spawn: sp.fn as any,
    })
    expect(sp.fn).not.toHaveBeenCalled()
  })

  it('skips when not a global npm install (npm link / dev / npx)', async () => {
    const { sp, p } = run({ pkgRoot: join(root, 'monorepo', 'cli') })
    await p
    expect(sp.fn).not.toHaveBeenCalled()
    expect(readAutoUpdateState().lastAutoUpdateAttempt).toBeUndefined()
  })

  it('skips when npm root -g fails', async () => {
    const { sp, p } = run({ spawnSync: fakeSpawnSync('', 1) as any })
    await p
    expect(sp.fn).not.toHaveBeenCalled()
  })

  it('throttles to one attempt per 24h', async () => {
    const t0 = Date.now()
    await run({ now: () => t0 }).p
    const second = run({ now: () => t0 + 23 * 3600_000 })
    await second.p
    expect(second.sp.fn).not.toHaveBeenCalled()
    const third = run({ now: () => t0 + 25 * 3600_000 })
    await third.p
    expect(third.sp.fn).toHaveBeenCalledTimes(1)
  })

  it('does nothing while another process holds a fresh lock', async () => {
    mkdirSync(cfg, { recursive: true })
    writeFileSync(join(cfg, 'auto-update.lock'), '')
    const { sp, p } = run()
    await p
    expect(sp.fn).not.toHaveBeenCalled()
    expect(existsSync(join(cfg, 'auto-update.lock'))).toBe(true)
  })

  it('takes over a stale lock', async () => {
    mkdirSync(cfg, { recursive: true })
    const lock = join(cfg, 'auto-update.lock')
    writeFileSync(lock, '')
    const old = new Date(Date.now() - 3600_000)
    utimesSync(lock, old, old)
    const { sp, p } = run()
    await p
    expect(sp.fn).toHaveBeenCalledTimes(1)
  })

  it('records a truncated error on failure and never throws', async () => {
    const spawnFn = fakeSpawn({ code: 243, stderr: 'EACCES '.repeat(100) })
    await expect(run({ spawnFn }).p).resolves.toBeUndefined()
    const st = readAutoUpdateState()
    expect(st.lastError).toContain('code 243')
    expect((st.lastError ?? '').length).toBeLessThanOrEqual(200)
    expect(existsSync(join(cfg, 'auto-update.lock'))).toBe(false)
  })

  it('records a launch error', async () => {
    const spawnFn = fakeSpawn({ error: new Error('ENOENT') })
    await run({ spawnFn }).p
    expect(readAutoUpdateState().lastError).toContain('ENOENT')
  })

  it('failure leaves the cache so the Update-available notice still shows', async () => {
    mkdirSync(cfg, { recursive: true })
    writeFileSync(
      join(cfg, 'update-check.json'),
      JSON.stringify({ lastChecked: Date.now(), latest: '9.9.9' })
    )
    await run({ spawnFn: fakeSpawn({ code: 1 }) }).p
    jest.resetModules()
    const { printUpdateNoticeIfAny } = require('@/cli/src/lib/update-check')
    const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
    printUpdateNoticeIfAny('@lumoai/cli', '1.0.0')
    const out = err.mock.calls.map(c => String(c[0])).join('')
    err.mockRestore()
    expect(out).toContain('Update available')
  })
})

describe('acquireFileLock', () => {
  it('is exclusive until stale', () => {
    const lock = join(cfg, 'x.lock')
    expect(acquireFileLock(lock, 60_000)).toBe(true)
    expect(acquireFileLock(lock, 60_000)).toBe(false)
    const old = new Date(Date.now() - 10_000)
    utimesSync(lock, old, old)
    expect(acquireFileLock(lock, 1000)).toBe(true)
  })
})
