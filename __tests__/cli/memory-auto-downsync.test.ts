/**
 * @jest-environment node
 *
 * LUM-551 — attach-triggered best-effort downsync: throttle-gated, swallows all
 * errors, honors the disable env, writes throttle state after a real sync.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoDownsyncOnAttach } from '@/cli/src/lib/memory-auto'
import { writeThrottleState } from '@/cli/src/lib/sync-throttle'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lumo-auto-down-'))
}

const okBundle = {
  ok: true,
  status: 200,
  json: async () => ({ bundle: { projectId: 'p1', entries: [] } }),
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_DISABLE_MEMORY_AUTO
  global.fetch = jest
    .fn()
    .mockResolvedValue(okBundle) as unknown as typeof fetch
})

it('skips entirely when LUMO_DISABLE_MEMORY_AUTO is set (no fetch)', async () => {
  process.env.LUMO_DISABLE_MEMORY_AUTO = '1'
  const dir = tmp()
  try {
    const res = await autoDownsyncOnAttach({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      projectId: 'p1',
      now: new Date(),
      dir,
    })
    expect(res.skipped).toBe('disabled')
    expect(global.fetch).not.toHaveBeenCalled()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.LUMO_DISABLE_MEMORY_AUTO
  }
})

it('skips the network when the throttle is fresh for the same project', async () => {
  const dir = tmp()
  try {
    const now = new Date('2026-06-19T10:00:00.000Z')
    writeThrottleState(
      dir,
      { lastSyncAt: now.toISOString(), projectId: 'p1' },
      now
    )
    const res = await autoDownsyncOnAttach({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      projectId: 'p1',
      now: new Date('2026-06-19T14:00:00.000Z'),
      dir,
    })
    expect(res.skipped).toBe('throttled')
    expect(global.fetch).not.toHaveBeenCalled()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('fetches + applies + writes throttle state when stale', async () => {
  const dir = tmp()
  try {
    const now = new Date('2026-06-19T10:00:00.000Z')
    const res = await autoDownsyncOnAttach({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      projectId: 'p1',
      now,
      dir,
    })
    expect(res.error).toBeUndefined()
    expect(res.added).toBe(0)
    expect(global.fetch).toHaveBeenCalled()
    expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('swallows a thrown fetch and returns { error }, never throwing', async () => {
  global.fetch = jest
    .fn()
    .mockRejectedValue(new Error('boom')) as unknown as typeof fetch
  const dir = tmp()
  try {
    const res = await autoDownsyncOnAttach({
      cwd: process.cwd(),
      base: 'https://api.example.com',
      token: 't',
      projectId: 'p1',
      now: new Date(),
      dir,
    })
    expect(res.error).toContain('boom')
    expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
