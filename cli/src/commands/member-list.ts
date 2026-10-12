import { sanitizeField } from '../lib/sanitize'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { apiContext } from '../lib/test-case-api'
import { fetchDirectory, type Directory } from '../lib/directory'

export interface MemberListOptions {
  json?: boolean
}

/**
 * Render the directory: humans as a `name  email  ROLE` table (LUM-1089,
 * header on a TTY only), then agent actors.
 */
export function formatMemberList(
  dir: Directory,
  opts: ListRenderOptions = {}
): string {
  if (dir.members.length === 0 && dir.agents.length === 0) {
    return 'No members.'
  }
  const lines: string[] = []
  if (dir.members.length > 0) {
    lines.push(
      renderListTable(
        dir.members.map(m => [
          sanitizeField(m.displayName),
          sanitizeField(m.email ?? '-'),
          m.role,
        ]),
        { header: ['NAME', 'EMAIL', 'ROLE'], ...opts }
      )
    )
  }
  if (dir.agents.length > 0) {
    lines.push('', 'Agents:')
    for (const a of dir.agents) {
      lines.push(`  ${sanitizeField(a.name)}  (${a.type})`)
    }
  }
  return lines.join('\n')
}

/** `lumo member list` — the workspace member directory (LUM-821). */
export async function memberList(
  opts: MemberListOptions = {}
): Promise<number | void> {
  const ctx = apiContext()
  if (!ctx) return 1
  const dir = await fetchDirectory(ctx)
  if (!dir) return 1
  if (opts.json) {
    process.stdout.write(JSON.stringify(dir, null, 2) + '\n')
    return
  }
  process.stdout.write(formatMemberList(dir) + '\n')
}
