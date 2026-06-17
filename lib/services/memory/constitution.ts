import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface Constitution {
  claudeMd: string | null
  agentsMd: string | null
}

/**
 * Read the project constitution files (CLAUDE.md / AGENTS.md) from the repo
 * root. Both reads degrade to null on any error (missing file, permission,
 * runtime where the file wasn't bundled) so callers never fail just because a
 * constitution file is absent.
 *
 * On Vercel these files only reach the serverless bundle because
 * `outputFileTracingIncludes` in next.config.mjs lists them for the API routes;
 * without that, `process.cwd()` would not contain them and both reads fall back
 * to null.
 *
 * Originally Layer-2-only (LUM-137); extracted here so the Layer-1 extraction
 * path and the manual write path can run the source de-dup gate too (LUM-538).
 */
export async function loadConstitution(): Promise<Constitution> {
  const root = process.cwd()
  const [claudeMd, agentsMd] = await Promise.all([
    readConstitutionFile(path.join(root, 'CLAUDE.md')),
    readConstitutionFile(path.join(root, 'AGENTS.md')),
  ])
  return { claudeMd, agentsMd }
}

/**
 * Load the constitution as a single combined text (CLAUDE.md + AGENTS.md), or
 * null when neither file is available — the shape the extraction gate's
 * redundancy check consumes.
 */
export async function loadConstitutionText(): Promise<string | null> {
  const { claudeMd, agentsMd } = await loadConstitution()
  const combined = [claudeMd, agentsMd].filter(Boolean).join('\n\n')
  return combined.length > 0 ? combined : null
}

async function readConstitutionFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf8')
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}
