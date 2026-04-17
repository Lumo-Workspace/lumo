import { prisma } from '@/lib/db/prisma'

export interface AuditInput {
  connectionId: string
  clerkUserId: string
  workspaceId: string | null
  toolName: string
  status: 'ok' | 'error'
  errorCode?: string | null
  durationMs: number
}

export async function writeAuditLog(input: AuditInput): Promise<void> {
  try {
    await prisma.mcpAuditLog.create({
      data: {
        connectionId: input.connectionId,
        clerkUserId: input.clerkUserId,
        workspaceId: input.workspaceId,
        toolName: input.toolName,
        status: input.status,
        errorCode: input.errorCode ?? null,
        durationMs: input.durationMs,
      },
    })
  } catch {
    // Audit failures never break tool calls.
  }
}
