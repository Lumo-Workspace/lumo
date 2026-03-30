import { prisma } from '@/lib/db/prisma'

/**
 * Get or create the HUMAN actor for a WorkspaceMember.
 * Called during workspace creation and invite acceptance.
 */
export async function getOrCreateHumanActor(
  workspaceId: string,
  memberId: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  const db = tx ?? prisma
  const existing = await db.actor.findUnique({ where: { memberId } })
  if (existing) return existing.id
  const actor = await db.actor.create({
    data: { workspaceId, type: 'HUMAN', memberId },
  })
  return actor.id
}

/**
 * Get the CODING agent actor for a workspace.
 */
export async function getCodingAgentActor(
  workspaceId: string
): Promise<string | null> {
  const actor = await prisma.actor.findFirst({
    where: {
      workspaceId,
      type: 'AGENT',
      agent: { type: 'CODING' },
    },
  })
  return actor?.id ?? null
}

/**
 * Get the human actor ID for a WorkspaceMember.
 * Returns null if no actor exists (shouldn't happen in normal flow).
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
 * Used for sending Slack DMs and real-time push notifications.
 */
export async function getActorClerkId(actorId: string): Promise<string | null> {
  const actor = await prisma.actor.findUnique({
    where: { id: actorId },
    select: { member: { select: { clerkId: true } } },
  })
  return actor?.member?.clerkId ?? null
}
