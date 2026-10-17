import { memoryRepository } from '@/lib/repositories/memory.repository'
import {
  isFullCuid,
  matchRef,
  normaliseRef,
  refMatchError,
} from '@/shared/src/short-ref'

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

/**
 * LUM-1230: turn what a person typed for a memory — the full cuid, the
 * 8-character short ref the CLI prints, or a unique id prefix (≥6 chars) —
 * into the memory's id.
 *
 * A full cuid passes through untouched so the routes keep their existing
 * semantics for it. Anything else is looked up inside `workspaceId` only:
 * no match is a 404, more than one is a 409 whose message lists the
 * candidates — never a silent pick.
 */
export async function resolveMemoryRef(
  ref: string,
  workspaceId: string
): Promise<string> {
  const needle = normaliseRef(ref)
  if (isFullCuid(needle)) return needle
  const rows =
    needle.length > 0
      ? await memoryRepository.findIdsMatchingRef(workspaceId, needle)
      : []
  const match = matchRef(needle, rows, r => r.id)
  if (match.kind === 'found') return match.item.id
  const status =
    match.kind === 'ambiguous' ? 409 : match.kind === 'too-short' ? 400 : 404
  throw Object.assign(
    new Error(
      refMatchError(
        'memory',
        ref,
        match,
        r => r.id,
        r => r.category
      )
    ),
    { status }
  )
}
