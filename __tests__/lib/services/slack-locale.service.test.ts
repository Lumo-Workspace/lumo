/**
 * @jest-environment node
 *
 * LUM-1097 — the Slack language rules: workspace default for channels,
 * recipient preference (else workspace default) for DMs; never throws.
 */
const mockFindDefaultLocale = jest.fn()
const mockFindLocaleForMember = jest.fn()
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findDefaultLocale: (...a: unknown[]) => mockFindDefaultLocale(...a),
  },
}))
jest.mock('@/lib/repositories/preference.repository', () => ({
  preferenceRepository: {
    findLocaleForMember: (...a: unknown[]) => mockFindLocaleForMember(...a),
  },
}))

import { slackLocaleService } from '@/lib/services/slack-locale.service'

beforeEach(() => jest.clearAllMocks())

describe('forWorkspace', () => {
  it('returns the stored default language', async () => {
    mockFindDefaultLocale.mockResolvedValue('zh-CN')
    await expect(slackLocaleService.forWorkspace('ws')).resolves.toBe('zh-CN')
    expect(mockFindDefaultLocale).toHaveBeenCalledWith('ws')
  })

  it.each([[null], ['zh'], ['']])('%p → en', async stored => {
    mockFindDefaultLocale.mockResolvedValue(stored)
    await expect(slackLocaleService.forWorkspace('ws')).resolves.toBe('en')
  })

  it('a failed lookup → en', async () => {
    mockFindDefaultLocale.mockRejectedValue(new Error('down'))
    await expect(slackLocaleService.forWorkspace('ws')).resolves.toBe('en')
  })
})

describe('forRecipient', () => {
  it('prefers the recipient language', async () => {
    mockFindDefaultLocale.mockResolvedValue('fr')
    mockFindLocaleForMember.mockResolvedValue('ko')
    await expect(slackLocaleService.forRecipient('ws', 'u1')).resolves.toBe(
      'ko'
    )
    expect(mockFindLocaleForMember).toHaveBeenCalledWith('ws', 'u1')
  })

  it('no preference → workspace default', async () => {
    mockFindDefaultLocale.mockResolvedValue('fr')
    mockFindLocaleForMember.mockResolvedValue(null)
    await expect(slackLocaleService.forRecipient('ws', 'u1')).resolves.toBe(
      'fr'
    )
  })

  it('a failed preference lookup → workspace default', async () => {
    mockFindDefaultLocale.mockResolvedValue('de')
    mockFindLocaleForMember.mockRejectedValue(new Error('down'))
    await expect(slackLocaleService.forRecipient('ws', 'u1')).resolves.toBe(
      'de'
    )
  })
})
