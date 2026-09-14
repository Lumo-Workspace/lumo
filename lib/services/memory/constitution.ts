import { logger } from '@/lib/logger'
import { projectRepository } from '@/lib/repositories/project.repository'

/** The tenant dimension of a constitution read: which project, in which workspace. */
export interface ConstitutionScope {
  projectId: string
  workspaceId: string
}

export interface Constitution {
  claudeMd: string | null
  agentsMd: string | null
  /**
   * "owner/repo" the files were read from — the project's default linked
   * repository — or null when the project has no linked repository. Surfaced
   * so a rejection can name the file it is pointing at.
   */
  repo: string | null
}

export interface ConstitutionSource {
  /** Combined CLAUDE.md + AGENTS.md text, or null when neither is available. */
  text: string | null
  repo: string | null
}

/**
 * Same TTL as the policy compiler's source cache: Layer-1 runs once per agent
 * turn, and two GitHub reads per turn per project would be wasteful.
 */
const CACHE_TTL_MS = 60_000
const _cache = new Map<string, { at: number; value: Constitution }>()

const EMPTY: Constitution = { claudeMd: null, agentsMd: null, repo: null }

/**
 * Read the project constitution (CLAUDE.md / AGENTS.md) from the CUSTOMER's
 * repository — the project's default linked GitHub repo, read through
 * `readRepoFile({ workspaceId, fullName })`, the same source the policy
 * compiler reads its rules from (LUM-778).
 *
 * It used to read the server process's working directory, i.e. Lumo's own
 * CLAUDE.md shipped in the deployment bundle — correct only for Lumo's own workspace, and silently
 * wrong for every other tenant (memories were rejected as "already in your
 * constitution" against a file the customer could not even see).
 *
 * Fail-open at every step: no linked repo, no GitHub installation for the
 * workspace, a GitHub error, a missing (404) or empty file — each degrades to
 * null so the redundancy gate is skipped rather than rejecting on a file it
 * could not read. Results (including the null ones) are cached per project
 * for CACHE_TTL_MS.
 *
 * Originally Layer-2-only (LUM-137); extracted here so the Layer-1 extraction
 * path and the manual write path can run the source de-dup gate too (LUM-538).
 */
export async function loadConstitution(
  scope: ConstitutionScope
): Promise<Constitution> {
  const cached = _cache.get(scope.projectId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  const value = await readProjectConstitution(scope)
  _cache.set(scope.projectId, { at: Date.now(), value })
  return value
}

/**
 * Load the constitution as a single combined text (CLAUDE.md + AGENTS.md), or
 * null when neither file is available — the shape the extraction gate's
 * redundancy check consumes.
 */
export async function loadConstitutionText(
  scope: ConstitutionScope
): Promise<string | null> {
  return (await loadConstitutionSource(scope)).text
}

/**
 * Combined text plus the repo it was read from — for callers that must name
 * the file a rejection points at.
 */
export async function loadConstitutionSource(
  scope: ConstitutionScope
): Promise<ConstitutionSource> {
  const { claudeMd, agentsMd, repo } = await loadConstitution(scope)
  const combined = [claudeMd, agentsMd].filter(Boolean).join('\n\n')
  return { text: combined.length > 0 ? combined : null, repo }
}

/** Test hook — the per-project cache is module state. */
export function resetConstitutionCache(): void {
  _cache.clear()
}

async function readProjectConstitution(
  scope: ConstitutionScope
): Promise<Constitution> {
  let repo: string | null = null
  try {
    const row = await projectRepository.findDefaultRepository(scope.projectId)
    if (!row) return EMPTY
    repo = row.fullName
  } catch (err) {
    logger.warn(
      `[memory.constitution] default-repo lookup failed for project=${scope.projectId} — constitution treated as absent:`,
      err instanceof Error ? err.message : err
    )
    return EMPTY
  }

  // Dynamic import, same as the policy compiler's readSource: the GitHub
  // contents module statically pulls @octokit/auth-app (ESM-only), which
  // breaks every jest suite that loads this module's static graph.
  const { readRepoFile } = await import('@/lib/integrations/github/contents')
  const fullName = repo
  const [claudeMd, agentsMd] = await Promise.all([
    readConstitutionFile(
      readRepoFile,
      scope.workspaceId,
      fullName,
      'CLAUDE.md'
    ),
    readConstitutionFile(
      readRepoFile,
      scope.workspaceId,
      fullName,
      'AGENTS.md'
    ),
  ])
  return { claudeMd, agentsMd, repo }
}

type ReadRepoFile =
  typeof import('@/lib/integrations/github/contents').readRepoFile

async function readConstitutionFile(
  readRepoFile: ReadRepoFile,
  workspaceId: string,
  fullName: string,
  path: 'CLAUDE.md' | 'AGENTS.md'
): Promise<string | null> {
  try {
    const content = await readRepoFile({ workspaceId, fullName, path })
    if (content == null) return null
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (err) {
    logger.warn(
      `[memory.constitution] could not read ${fullName}/${path} for workspace=${workspaceId} — treated as absent:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}
