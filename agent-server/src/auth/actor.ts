import { prisma } from '../db/prisma.js'

/**
 * Get the human actor ID for a WorkspaceMember.
 */
export async function getHumanActorId(
  memberId: string
): Promise<string | null> {
  const actor = await prisma.actor.findUnique({
    where: { memberId },
    select: { id: true },
  })
  return actor?.id ?? null
}

/**
 * Resolve an Actor ID to its associated Clerk user ID.
 */
export async function getActorClerkId(actorId: string): Promise<string | null> {
  const actor = await prisma.actor.findUnique({
    where: { id: actorId },
    select: { member: { select: { clerkId: true } } },
  })
  return actor?.member?.clerkId ?? null
}

/**
 * Get an agent actor for a workspace by type.
 */
export async function getAgentActor(
  workspaceId: string,
  agentType: 'CODING' | 'REVIEW' | 'PLANNER' = 'CODING'
): Promise<string | null> {
  const actor = await prisma.actor.findFirst({
    where: {
      workspaceId,
      type: 'AGENT',
      agent: { type: agentType },
    },
  })
  return actor?.id ?? null
}
