import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'

/**
 * Fetches the workspace's Slack bot token and decrypts it. Returns null
 * when the workspace hasn't installed the Slack app — callers should
 * surface a "Slack not connected" error.
 */
export async function getSlackIntegrationToken(
  workspaceId: string
): Promise<{ token: string; slackTeamId: string } | null> {
  const integration = await prisma.slackIntegration.findUnique({
    where: { workspaceId },
    select: { accessToken: true, slackTeamId: true },
  })
  if (!integration) return null
  return {
    token: decrypt(integration.accessToken),
    slackTeamId: integration.slackTeamId,
  }
}
