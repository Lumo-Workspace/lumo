/**
 * @jest-environment node
 *
 * LUM-551 — `applySync(..., { clean: true })` also clears the throttle state so
 * `memory sync --clean` is a true reset (next attach re-syncs).
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySync } from '@/cli/src/lib/apply-sync'
import { writeThrottleState } from '@/cli/src/lib/sync-throttle'

it('clean removes the throttle state file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-clean-'))
  try {
    const now = new Date('2026-06-19T10:00:00.000Z')
    writeThrottleState(
      dir,
      { lastSyncAt: now.toISOString(), projectId: 'p1' },
      now
    )
    expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(true)
    applySync(dir, { projectId: '', entries: [] }, { clean: true })
    expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('clean --dry-run leaves the throttle state in place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumo-clean-dry-'))
  try {
    const now = new Date('2026-06-19T10:00:00.000Z')
    writeThrottleState(
      dir,
      { lastSyncAt: now.toISOString(), projectId: 'p1' },
      now
    )
    applySync(
      dir,
      { projectId: '', entries: [] },
      { clean: true, dryRun: true }
    )
    expect(existsSync(join(dir, '.lumo-sync.json'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
