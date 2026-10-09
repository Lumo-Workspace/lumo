import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

export const MARKER_FILE = '.lumo-install.json'

function listFiles(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(root, rel), {
    withFileTypes: true,
  })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(root, r))
    else if (entry.isFile() && r !== MARKER_FILE) out.push(r)
  }
  return out
}

/**
 * Content hash of an installed skill directory: sha256 over the sorted
 * relative file paths and their bytes, excluding the install marker.
 * Format: `sha256:<hex>`.
 */
export function hashSkillDir(dir: string): string {
  const h = crypto.createHash('sha256')
  for (const rel of listFiles(dir).sort()) {
    const bytes = fs.readFileSync(path.join(dir, rel))
    h.update(`${rel}\0${bytes.length}\0`)
    h.update(bytes)
  }
  return `sha256:${h.digest('hex')}`
}
