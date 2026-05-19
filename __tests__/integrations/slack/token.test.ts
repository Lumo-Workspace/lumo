/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    slackIntegration: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn((s: string) => `decrypted(${s})`),
}))

import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'
import { getSlackIntegrationToken } from '@/lib/integrations/slack/token'

const findUnique = prisma.slackIntegration.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getSlackIntegrationToken', () => {
  it('returns decrypted token + teamId when integration exists', async () => {
    findUnique.mockResolvedValue({
      accessToken: 'cipher',
      slackTeamId: 'T01',
    })
    expect(await getSlackIntegrationToken('ws_1')).toEqual({
      token: 'decrypted(cipher)',
      slackTeamId: 'T01',
    })
    expect(findUnique).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
      select: { accessToken: true, slackTeamId: true },
    })
    expect(decrypt).toHaveBeenCalledWith('cipher')
  })

  it('returns null when no integration', async () => {
    findUnique.mockResolvedValue(null)
    expect(await getSlackIntegrationToken('ws_1')).toBeNull()
  })
})
