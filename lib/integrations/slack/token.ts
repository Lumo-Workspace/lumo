import { prisma } from '@/lib/db/prisma'
import { decrypt } from '@/lib/crypto'

export async function getSlackIntegrationToken(
  workspaceId: string
): Promise<{
  token: string
  slackTeamId: string
  slackTeamName: string
} | null> {
  const integration = await prisma.slackIntegration.findUnique({
    where: { workspaceId },
    select: { accessToken: true, slackTeamId: true, slackTeamName: true },
  })
  if (!integration) return null
  return {
    token: decrypt(integration.accessToken),
    slackTeamId: integration.slackTeamId,
    slackTeamName: integration.slackTeamName,
  }
}
