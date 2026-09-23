import { sanitizeField } from '../lib/sanitize'
import { apiContext } from '../lib/test-case-api'
import { fetchDirectory, type Directory } from '../lib/directory'

export interface MemberListOptions {
  json?: boolean
}

/**
 * Render the directory: humans as `name  email  ROLE`, then agent actors.
 * Columns are padded to the widest cell (same style as `task list`).
 */
export function formatMemberList(dir: Directory): string {
  if (dir.members.length === 0 && dir.agents.length === 0) {
    return 'No members.'
  }
  const rows = dir.members.map(m => ({
    name: sanitizeField(m.displayName),
    email: sanitizeField(m.email ?? '-'),
    role: m.role,
  }))
  const nameW = Math.max(4, ...rows.map(r => r.name.length))
  const emailW = Math.max(5, ...rows.map(r => r.email.length))
  const lines = rows.map(
    r => `${r.name.padEnd(nameW)}  ${r.email.padEnd(emailW)}  ${r.role}`
  )
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
