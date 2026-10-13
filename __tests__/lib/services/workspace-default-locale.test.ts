/**
 * @jest-environment node
 *
 * LUM-1097 — the workspace default language setting: the API schema accepts
 * the member-preference language codes only, OWNER-only writes store it, and
 * the migration is additive (one column with a default).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    update: jest.fn(async (_id: string, data: unknown) => data),
    isSlugUnique: jest.fn(),
    findAuditedSettings: jest.fn(async () => ({ defaultLocale: 'en' })),
  },
}))
const mockRecordAuditEvent = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'
import { AUDITED_WORKSPACE_SETTINGS } from '@/lib/audit/workspace-settings'
import { CORE_WORKSPACE_COLUMNS } from '@/lib/plugins/workspace-settings'

const update = workspaceRepository.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('defaultLocale in PATCH /api/workspaces/me', () => {
  it('accepts every supported language code', () => {
    for (const locale of PUBLIC_LOCALES) {
      expect(
        updateWorkspaceSchema.safeParse({ defaultLocale: locale }).success
      ).toBe(true)
    }
  })

  it.each([['zh'], ['xx'], [''], [null], [1]])('rejects %p', bad => {
    expect(
      updateWorkspaceSchema.safeParse({ defaultLocale: bad }).success
    ).toBe(false)
  })

  it('an OWNER stores it (and it is audited and served)', async () => {
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      defaultLocale: 'zh-CN',
    })
    expect(update).toHaveBeenCalledWith(
      'ws_a',
      expect.objectContaining({ defaultLocale: 'zh-CN' })
    )
    expect(AUDITED_WORKSPACE_SETTINGS['workspace.settings_updated']).toContain(
      'defaultLocale'
    )
    expect(CORE_WORKSPACE_COLUMNS).toContain('defaultLocale')
  })

  it('a non-OWNER is refused', async () => {
    await expect(
      workspaceService.updateWorkspace('ws_a', 'MEMBER', 'slug', {
        defaultLocale: 'zh-CN',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(update).not.toHaveBeenCalled()
  })
})

describe('migration', () => {
  it('adds one defaulted column to the mapped table and deletes nothing', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20261031090000_lum1097_workspace_default_locale/migration.sql'
      ),
      'utf8'
    )
    expect(sql).toContain(
      `ALTER TABLE "workspaces" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en';`
    )
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE|TRUNCATE/i)
  })
})
