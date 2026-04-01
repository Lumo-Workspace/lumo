import { createHash } from 'crypto'
import { prisma } from '@/lib/db/prisma'

/**
 * Validate an incoming MCP request against two auth schemes:
 *
 * 1. Per-task ephemeral token — AgentRun.mcpToken matching; run must be WORKING
 *    and belong to the given taskId.
 * 2. Per-user API key — SHA-256 hash lookup in ApiKey table; must be unrevoked
 *    and the key owner must be in the same workspace as the task.
 *
 * Returns true if either scheme passes, false otherwise.
 */
export async function validateMcpToken(
  request: Request,
  taskId: string
): Promise<boolean> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7).trim()
  if (!token) return false

  // ── 1. Per-task ephemeral token ────────────────────────────────────────
  // mcpToken has @unique but we need to also verify taskId + status to prevent
  // a token from one task being used against a different task.
  // We use findFirst (not findUnique) because the compound where
  // (taskId, mcpToken, status) is not a @unique constraint in the Prisma schema.
  const run = await prisma.agentRun.findFirst({
    where: { taskId, mcpToken: token, status: 'WORKING' },
    select: { id: true },
  })
  if (run) return true

  // ── 2. Per-user API key ────────────────────────────────────────────────
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { workspaceId: true } } },
  })
  if (!task) return false

  const keyHash = createHash('sha256').update(token).digest('hex')
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      revokedAt: true,
      member: { select: { workspaceId: true } },
    },
  })

  if (!apiKey || apiKey.revokedAt !== null) return false
  if (apiKey.member.workspaceId !== task.project.workspaceId) return false

  // Fire-and-forget lastUsedAt update — don't block the response
  void prisma.apiKey
    .update({ where: { keyHash }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return true
}
