import { memoryRepository } from '@/lib/repositories/memory.repository'

/**
 * Fetch one memory's full card, enforcing workspace isolation.
 *
 * Consumed by `GET /api/memories/<id>` (the `lumo memory show <id>` CLI
 * command, LUM-500). DIP: reads through the repository, never Prisma directly.
 *
 * A cross-workspace id and a non-existent id collapse to the same 404 so the
 * route never leaks whether a memory exists in another workspace.
 */
export async function getMemoryByIdForWorkspace(
  id: string,
  workspaceId: string
) {
  const memory = await memoryRepository.findByIdWithWorkspace(id)
  if (!memory || memory.workspaceId !== workspaceId) {
    throw Object.assign(new Error('Memory not found'), { status: 404 })
  }
  return memory
}
