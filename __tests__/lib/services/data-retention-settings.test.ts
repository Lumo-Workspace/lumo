/**
 * @jest-environment node
 *
 * LUM-933 / LUM-912 / LUM-941 — Settings → Data retention: what the API
 * accepts per row, how the session record choice is stored, OWNER-only
 * writes, and an additive-only migration.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { update: jest.fn(), isSlugUnique: jest.fn() },
}))

import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import {
  SESSION_RECORD_CHOICES,
  isHookEventRetentionMode,
  sessionRecordChoiceOf,
  sessionRecordChoiceShortens,
  sessionRecordSettingFor,
  shouldStripCodeOnIngest,
  type SessionRecordChoice,
} from '@/lib/hook-event/retention'

const update = workspaceRepository.update as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('session record setting', () => {
  it('session record choice maps to a valid mode and days pair', async () => {
    // Choice ↔ stored columns round-trips for every option.
    expect(SESSION_RECORD_CHOICES).toEqual([
      'forever',
      30,
      90,
      180,
      365,
      'used_up',
    ])
    for (const choice of SESSION_RECORD_CHOICES) {
      const setting = sessionRecordSettingFor(choice)
      expect(sessionRecordChoiceOf(setting.mode, setting.days)).toBe(choice)
      // Every pair the UI sends passes the API schema.
      expect(
        updateWorkspaceSchema.safeParse({
          hookEventRetentionMode: setting.mode,
          hookEventRetentionDays: setting.days,
        }).success
      ).toBe(true)
    }
    expect(sessionRecordSettingFor('used_up')).toEqual({
      mode: 'USED_UP',
      days: null,
    })
    // Defaults: an existing workspace (RETAIN, null) reads as "forever".
    expect(sessionRecordChoiceOf('RETAIN', null)).toBe('forever')
    expect(sessionRecordChoiceOf(undefined, undefined)).toBe('forever')

    // Invalid values are rejected by the schema (the route answers 400).
    for (const bad of ['FOREVER', 'used_up', null, 1]) {
      expect(
        updateWorkspaceSchema.safeParse({ hookEventRetentionMode: bad }).success
      ).toBe(false)
    }

    // USED_UP clears any day tier; a day tier alone is a RETAIN choice.
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      hookEventRetentionMode: 'USED_UP',
      hookEventRetentionDays: null,
    })
    expect(update).toHaveBeenLastCalledWith('ws_a', {
      hookEventRetentionMode: 'USED_UP',
      hookEventRetentionDays: null,
    })
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 90,
    })
    expect(update).toHaveBeenLastCalledWith('ws_a', {
      hookEventRetentionMode: 'RETAIN',
      hookEventRetentionDays: 90,
    })
    await expect(
      workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
        hookEventRetentionMode: 'USED_UP',
        hookEventRetentionDays: 30,
      })
    ).rejects.toMatchObject({ status: 400 })

    // Non-owners can change none of the retention rows.
    for (const input of [
      { hookEventRetentionMode: 'USED_UP' as const },
      { crossingRawRetentionDays: 30 as const },
      { deadLetterRetentionDays: 90 as const },
      { scanEvidenceRetentionDays: 14 as const },
    ]) {
      await expect(
        workspaceService.updateWorkspace('ws_a', 'MEMBER', 'slug', input)
      ).rejects.toMatchObject({ status: 403 })
    }

    // The migration only adds: a type, columns with defaults, an index.
    const dir = join(process.cwd(), 'prisma/migrations')
    const name = readdirSync(dir).find(d =>
      d.endsWith('_lum933_data_retention_settings')
    )!
    const statements = readFileSync(join(dir, name, 'migration.sql'), 'utf8')
      .split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('--'))
      .join('\n')
    expect(statements).not.toMatch(/\b(DROP|DELETE|TRUNCATE|RENAME)\b/i)
    expect(statements).not.toMatch(/ALTER COLUMN/i)
    expect(statements).not.toMatch(/\bUPDATE\b/i)
    expect(statements).toMatch(
      /"hookEventRetentionMode" "HookEventRetentionMode" NOT NULL DEFAULT 'RETAIN'/
    )
  })

  it('only used-up mode strips code on ingest', () => {
    expect(shouldStripCodeOnIngest('RETAIN')).toBe(false)
    expect(shouldStripCodeOnIngest('USED_UP')).toBe(true)
    expect(isHookEventRetentionMode('USED_UP')).toBe(true)
    expect(isHookEventRetentionMode('used_up')).toBe(false)
  })

  it('sessionRecordChoiceShortens flags every change that can clear more', () => {
    const cases: [SessionRecordChoice, SessionRecordChoice, boolean][] = [
      ['forever', 30, true],
      ['forever', 'used_up', true],
      [30, 365, false],
      [365, 30, true],
      ['used_up', 90, true],
      [90, 'forever', false],
      ['used_up', 'forever', false],
      [90, 90, false],
    ]
    for (const [from, to, expected] of cases) {
      expect(sessionRecordChoiceShortens(from, to)).toBe(expected)
    }
  })
})

describe('crossing and dead letter rows', () => {
  it('dead letter and crossing rows accept only their tiers', async () => {
    for (const key of [
      'crossingRawRetentionDays',
      'deadLetterRetentionDays',
    ] as const) {
      for (const ok of [7, 30, 90]) {
        expect(updateWorkspaceSchema.safeParse({ [key]: ok }).success).toBe(
          true
        )
      }
      for (const bad of [0, 14, 60, 365, null, '7']) {
        expect(updateWorkspaceSchema.safeParse({ [key]: bad }).success).toBe(
          false
        )
      }
    }
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      crossingRawRetentionDays: 30,
      deadLetterRetentionDays: 90,
    })
    expect(update).toHaveBeenLastCalledWith('ws_a', {
      crossingRawRetentionDays: 30,
      deadLetterRetentionDays: 90,
    })
    // Defaults are 7 days for both (schema defaults, not a data migration).
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8'
    )
    expect(schema).toMatch(/crossingRawRetentionDays\s+Int\s+@default\(7\)/)
    expect(schema).toMatch(/deadLetterRetentionDays\s+Int\s+@default\(7\)/)
  })
})
