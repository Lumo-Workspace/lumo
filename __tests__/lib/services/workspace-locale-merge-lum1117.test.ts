/**
 * @jest-environment node
 *
 * LUM-1117 phase 1 — `Workspace.summaryLocale` is merged into
 * `defaultLocale`: the one language field drives AI summaries too, nothing
 * writes `summaryLocale` any more, and an old client that still sends or
 * reads `summaryLocale` is mapped onto `defaultLocale` for one release.
 */
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    update: jest.fn(async (_id: string, data: unknown) => data),
    isSlugUnique: jest.fn(),
    findAuditedSettings: jest.fn(async () => ({ defaultLocale: 'en' })),
    findDefaultLocale: jest.fn(async () => 'en'),
  },
}))
const mockRecordAuditEvent = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: (...a: unknown[]) => mockRecordAuditEvent(...a),
}))

import { workspaceService } from '@/lib/services/workspace.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  defaultLocaleFromSummaryLocale,
  summaryLanguageFor,
} from '@/lib/i18n/summary-locale'
import { PUBLIC_LOCALES } from '@/lib/i18n/public-locale'
import { AUDITED_WORKSPACE_SETTINGS } from '@/lib/audit/workspace-settings'
import { serializeWorkspaceSettings } from '@/lib/plugins/workspace-settings'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'

const update = workspaceRepository.update as jest.Mock
const findDefaultLocale = workspaceRepository.findDefaultLocale as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  findDefaultLocale.mockResolvedValue('en')
})

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

describe('defaultLocaleFromSummaryLocale', () => {
  it.each([
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['ZH-hans', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-hk', 'zh-TW'],
    ['en', 'en'],
    ['ja', 'ja'],
    ['es-419', 'es-419'],
  ])('maps %p to %p', (legacy, expected) => {
    expect(defaultLocaleFromSummaryLocale(legacy)).toBe(expected)
  })

  it.each([['xx'], [''], ['  '], [null], [undefined]])(
    'has no locale for %p',
    legacy => {
      expect(defaultLocaleFromSummaryLocale(legacy)).toBeNull()
    }
  )
})

describe('updateWorkspace — summaryLocale is no longer written', () => {
  it('never writes the summaryLocale column', async () => {
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      summaryEnabled: true,
      summaryLocale: 'zh',
    })
    const written = update.mock.calls[0]![1] as Record<string, unknown>
    expect(written).not.toHaveProperty('summaryLocale')
    expect(AUDITED_WORKSPACE_SETTINGS['workspace.settings_updated']).toEqual(
      expect.not.arrayContaining(['summaryLocale'])
    )
  })

  it('an old client asking for Chinese summaries moves defaultLocale to zh-CN', async () => {
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      summaryLocale: 'zh',
    })
    expect(update).toHaveBeenCalledWith(
      'ws_a',
      expect.objectContaining({ defaultLocale: 'zh-CN' })
    )
  })

  it('a legacy value that keeps the summary language leaves defaultLocale alone', async () => {
    // A workspace whose default is Japanese already gets English summaries;
    // the old page re-sending 'en' must not reset it to English.
    findDefaultLocale.mockResolvedValue('ja')
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      summaryEnabled: false,
      summaryLocale: 'en',
    })
    const written = update.mock.calls[0]![1] as Record<string, unknown>
    expect(written).not.toHaveProperty('defaultLocale')
    expect(written).toEqual({ summaryEnabled: false })
  })

  it('an explicit defaultLocale wins over a legacy summaryLocale', async () => {
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      defaultLocale: 'fr',
      summaryLocale: 'zh',
    })
    expect(update).toHaveBeenCalledWith(
      'ws_a',
      expect.objectContaining({ defaultLocale: 'fr' })
    )
    expect(findDefaultLocale).not.toHaveBeenCalled()
  })

  it('an unknown legacy value is ignored', async () => {
    await workspaceService.updateWorkspace('ws_a', 'OWNER', 'slug', {
      summaryLocale: 'xx',
    })
    const written = update.mock.calls[0]![1] as Record<string, unknown>
    expect(written).toEqual({})
  })

  it('the API still accepts summaryLocale from an old client', () => {
    expect(
      updateWorkspaceSchema.safeParse({ summaryLocale: 'zh' }).success
    ).toBe(true)
  })
})

describe('GET /api/workspaces/me — summaryLocale is read from defaultLocale', () => {
  it('serves the summary language of defaultLocale, not the stale column', () => {
    const served = serializeWorkspaceSettings({
      id: 'w1',
      summaryLocale: 'en',
      defaultLocale: 'zh-CN',
    })
    expect(served).toMatchObject({
      defaultLocale: 'zh-CN',
      summaryLocale: 'zh',
    })
    expect(
      serializeWorkspaceSettings({
        id: 'w1',
        summaryLocale: 'zh',
        defaultLocale: 'de',
      })
    ).toMatchObject({ summaryLocale: 'en' })
  })
})
