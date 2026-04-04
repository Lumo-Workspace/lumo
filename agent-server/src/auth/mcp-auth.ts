import { createHash } from 'crypto'
import { prisma } from '../db/prisma.js'

/**
 * Validate an incoming MCP request against two auth schemes:
 *
 * 1. Per-task ephemeral token — AgentRun.mcpToken matching; run must be WORKING
 * 2. Per-user API key — SHA-256 hash lookup in ApiKey table
 */
export async function validateMcpToken(
  authHeader: string | null,
  taskId: string
): Promise<boolean> {
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7).trim()
  if (!token) return false

  // 1. Per-task ephemeral token
  const run = await prisma.agentRun.findFirst({
    where: { taskId, mcpToken: token, status: 'WORKING' },
    select: { id: true },
  })
  if (run) return true

  // 2. Per-user API key
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

  void prisma.apiKey
    .update({ where: { keyHash }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return true
}

/**
 * Validate service-to-service auth via shared secret.
 */
export function validateServiceSecret(authHeader: string | null): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7).trim()
  const secret = process.env.AGENT_SERVICE_SECRET
  if (!secret || !token) return false
  return token === secret
}
