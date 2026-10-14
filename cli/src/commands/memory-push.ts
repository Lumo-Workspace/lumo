import { codexMemoryStoreError } from '../lib/codex-hooks'
import { isCodexShell } from '../lib/session-id'
import { unlinkSync } from 'node:fs'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { resolveMemoryDir } from '../lib/claude-memory-dir'
import { collectUpsyncCandidates, projectMemoriesEndpoint } from '../lib/upsync'
import { errNotLoggedIn, httpFailed } from '../lib/errors'

interface PushOptions {
  project?: string
  dir?: string
  dryRun?: boolean
}

/**
 * `lumo memory push` — upsync (P3): promote locally-authored memories
 * (`<memory-dir>/outbox/*.json`, each `{ category, content }`) to the team. Each
 * is POSTed to the **existing** create-project-memory endpoint, so it goes
 * through the same canonicalize → dedup → reconcile-on-write pipeline (LUM-538)
 * as `lumo project memory add` — no parallel upsync path. Pushed files are
 * removed from the outbox on success.
 */
export async function memoryPush(options: PushOptions): Promise<number | void> {
  if (!options.dir && isCodexShell()) {
    console.error(codexMemoryStoreError('lumo memory push'))
    return 1
  }
  const dir = resolveMemoryDir(process.cwd(), undefined, options.dir)
  const candidates = collectUpsyncCandidates(dir)
  if (candidates.length === 0) {
    console.log(
      `No upsync candidates in ${dir}/outbox — drop {category, content} JSON files there to promote them.`
    )
    return
  }

  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const apiUrl = resolveAuthedApiUrl(creds.apiUrl)
  const base = trimTrailingSlash(apiUrl)

  let projectId: string
  if (options.project) {
    projectId = await resolveProjectId(base, creds.token, options.project)
  } else {
    const bound = await resolveBoundTaskIdentifier(apiUrl, creds.token)
    if (!bound) {
      console.error(
        'Error: no --project given and no task bound to this session.\nPass --project <ref>, or run `lumo session attach <LUM-N>`.'
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

  if (options.dryRun) {
    console.log(
      sanitizeField(
        `[dry-run] would push ${candidates.length} memory(ies) to project ${projectId} via the existing create-project-memory pipeline`
      )
    )
    for (const c of candidates) {
      console.log(sanitizeField(`  - ${c.category}: ${c.file}`))
    }
    return
  }

  const url = projectMemoriesEndpoint(base, projectId)
  let pushed = 0
  for (const c of candidates) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: c.category, content: c.content }),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
      return 1
    }
    if (!res.ok) {
      console.error(
        sanitizeField(`✗ ${c.file}: ${httpFailed('push', res.status)}`)
      )
      continue
    }
    try {
      unlinkSync(c.file)
    } catch {
      // best-effort cleanup; a re-push is idempotent via reconcile-on-write
    }
    pushed++
    const body = (await res.json().catch(() => ({}))) as { outcome?: string }
    console.log(
      sanitizeField(`✓ ${c.category} → ${body.outcome ?? 'pushed'} (${c.file})`)
    )
  }
  console.log(
    sanitizeField(`Pushed ${pushed}/${candidates.length} to the team.`)
  )
}
