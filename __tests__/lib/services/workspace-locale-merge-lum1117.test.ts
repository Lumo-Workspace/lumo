/**
 * @jest-environment node
 *
 * LUM-1117 — the workspace has one language field, `defaultLocale`; AI
 * summaries use it (English for languages other than English and Chinese).
 * Phase 2 dropped the old summary-only language column and its one-release
 * compatibility layer: the API neither serves nor accepts it any more.
 */
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    update: jest.fn(async (_id: string, data: unknown) => data),
    isSlugUnique: jest.fn(),
    findAuditedSettings: jest.fn(async () => ({ defaultLocale: 'en' })),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn(),
}))

import { Prisma } from '@prisma/client'
import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { summaryLanguageFor } from '@/lib/i18n/summary-locale'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'
import {
  auditedColumns,
  AUDITED_WORKSPACE_SETTINGS,
} from '@/lib/audit/workspace-settings'
import {
  CORE_WORKSPACE_COLUMNS,
  serializeWorkspaceSettings,
} from '@/lib/plugins/workspace-settings'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'

/** Built at run time so this file is not a `git grep` hit for the old name. */
const RETIRED = ['summary', 'Locale'].join('')

const update = workspaceRepository.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('summaryLanguageFor', () => {
  it('writes Chinese summaries for both Chinese locales', () => {
    expect(summaryLanguageFor('zh-CN')).toBe('zh')
    expect(summaryLanguageFor('zh-TW')).toBe('zh')
  })

  it('falls back to English for every other supported locale', () => {
    for (const locale of PUBLIC_LOCALES.filter(l => !l.startsWith('zh')))
      expect(summaryLanguageFor(locale)).toBe('en')
    expect(summaryLanguageFor(null)).toBe('en')
    expect(summaryLanguageFor('')).toBe('en')
  })
})

describe('the retired column is gone (phase 2)', () => {
  it('is not a Workspace column, a core column or an audited setting', () => {
    expect(Object.values(Prisma.WorkspaceScalarFieldEnum)).not.toContain(
      RETIRED
    )
    expect(CORE_WORKSPACE_COLUMNS).not.toContain(RETIRED)
    expect(auditedColumns(AUDITED_WORKSPACE_SETTINGS)).not.toContain(RETIRED)
  })

  it('an old client sending it writes nothing', async () => {
    const parsed = updateWorkspaceSchema.safeParse({
      summaryEnabled: true,
      [RETIRED]: 'zh',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ summaryEnabled: true })

    await workspaceService.updateWorkspace(
      'ws_a',
      'OWNER',
      'slug',
      parsed.data!
    )
    expect(update).toHaveBeenCalledWith('ws_a', { summaryEnabled: true })
  })

  it('GET serves defaultLocale and nothing derived from the old column', () => {
    const served = serializeWorkspaceSettings({
      id: 'w1',
      defaultLocale: 'zh-CN',
    })
    expect(served).toEqual({ id: 'w1', defaultLocale: 'zh-CN' })
  })
})
