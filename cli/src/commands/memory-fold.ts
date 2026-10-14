import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { sanitizeField } from '../lib/sanitize'
import { errHttp, errNotLoggedIn } from '../lib/errors'

interface FoldOptions {
  dryRun?: boolean
}

interface FoldProposalLike {
  category: string
  coarseContent: unknown
  sourceIds: string[]
  excludedIds: string[]
}

function flatten(content: unknown): string {
  if (content === null || typeof content !== 'object') return ''
  return Object.values(content as Record<string, unknown>)
    .map(v => (Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : ''))
    .filter(Boolean)
    .join(' — ')
}

export async function memoryFold(
  refArg: string | undefined,
  options: FoldOptions
): Promise<number | void> {
  // Folding runs automatically (daily cron). The CLI is preview-only.
  if (!options.dryRun) {
    console.error(
      'Topic folding runs automatically (daily). This command only previews it.\n' +
        'Run `lumo memory fold --dry-run` to see what the next fold pass would do.'
    )
    return 1
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  if (refArg) {
    projectId = await resolveProjectId(base, creds.token, refArg)
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) {
      console.error(
        'Error: no <project-ref> given and no task bound to this session.\n' +
          'Pass a project, or run `lumo session attach <LUM-N>`.'
      )
      return 1
    }
    const r = await resolveBoundProjectId(apiUrl, creds.token, bound)
    if (!r.ok) {
      console.error(`Error: ${r.error}`)
      return 1
    }
    projectId = r.id
  }

  let res: Response
  try {
    res = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/memories/fold-candidates`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    console.error(
      `Error: could not reach Lumo API at ${apiUrl} (${err instanceof Error ? err.message : String(err)})`
    )
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('fold preview', res.status))
    return 1
  }

  const { proposals } = (await res.json()) as { proposals: FoldProposalLike[] }
  if (proposals.length === 0) {
    process.stdout.write(
      'No fold proposals — nothing coarse to collapse right now.\n'
    )
    return
  }

  process.stdout.write(
    `${proposals.length} fold proposal(s) — DRY RUN, nothing written:\n\n`
  )
  for (const p of proposals) {
    process.stdout.write(
      `[${sanitizeField(p.category)}] coarse card folds ${p.sourceIds.length} cards` +
        (p.excludedIds.length
          ? ` (${p.excludedIds.length} left ACTIVE by the coverage gate)`
          : '') +
        `:\n  ${sanitizeField(flatten(p.coarseContent))}\n` +
        `  folds: ${p.sourceIds.map(s => sanitizeField(s)).join(', ')}\n\n`
    )
  }
}
