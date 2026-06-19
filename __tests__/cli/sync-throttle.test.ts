/**
 * @jest-environment node
 *
 * LUM-551 — per-repo freshness throttle for the attach-triggered auto-downsync.
 */
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readThrottleState,
  writeThrottleState,
  isThrottled,
  throttleHours,
  clearThrottleState,
} from '@/cli/src/lib/sync-throttle'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lumo-throttle-'))
}

describe('throttleHours', () => {
  const orig = process.env.LUMO_SYNC_THROTTLE_HOURS
  afterEach(() => {
    if (orig === undefined) delete process.env.LUMO_SYNC_THROTTLE_HOURS
    else process.env.LUMO_SYNC_THROTTLE_HOURS = orig
  })
  it('defaults to 12 when unset', () => {
    delete process.env.LUMO_SYNC_THROTTLE_HOURS
    expect(throttleHours()).toBe(12)
  })
  it('parses a valid override', () => {
    process.env.LUMO_SYNC_THROTTLE_HOURS = '24'
    expect(throttleHours()).toBe(24)
  })
  it('falls back to 12 on a non-positive or NaN value', () => {
    process.env.LUMO_SYNC_THROTTLE_HOURS = '0'
    expect(throttleHours()).toBe(12)
    process.env.LUMO_SYNC_THROTTLE_HOURS = 'nope'
    expect(throttleHours()).toBe(12)
  })
})

describe('read / write / clear', () => {
  it('round-trips state and clears it', () => {
    const dir = tmp()
    try {
      expect(readThrottleState(dir)).toBeNull()
      const now = new Date('2026-06-19T10:00:00.000Z')
      writeThrottleState(
        dir,
        { lastSyncAt: now.toISOString(), projectId: 'p1' },
        now
      )
      const st = readThrottleState(dir)
      expect(st).toEqual({
        lastSyncAt: '2026-06-19T10:00:00.000Z',
        projectId: 'p1',
      })
      expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(true)
      clearThrottleState(dir)
      expect(readThrottleState(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('returns null on a malformed state file', () => {
    const dir = tmp()
    try {
      writeFileSync(join(dir, '.lumo-sync.json'), 'not json{')
      expect(readThrottleState(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('isThrottled', () => {
  const base = { lastSyncAt: '2026-06-19T10:00:00.000Z', projectId: 'p1' }
  it('is throttled within the window for the same project', () => {
    const now = new Date('2026-06-19T16:00:00.000Z') // +6h
    expect(isThrottled(base, now, 12, 'p1')).toBe(true)
  })
  it('is not throttled past the window', () => {
    const now = new Date('2026-06-20T00:00:00.000Z') // +14h
    expect(isThrottled(base, now, 12, 'p1')).toBe(false)
  })
  it('is not throttled for a different project', () => {
    const now = new Date('2026-06-19T16:00:00.000Z')
    expect(isThrottled(base, now, 12, 'p2')).toBe(false)
  })
  it('is not throttled with null state', () => {
    expect(
      isThrottled(null, new Date('2026-06-19T16:00:00.000Z'), 12, 'p1')
    ).toBe(false)
  })
})
