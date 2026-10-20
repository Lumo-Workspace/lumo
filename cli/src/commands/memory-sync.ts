import { codexMemoryStoreError } from '../lib/codex-hooks'
import { isCodexShell } from '../lib/session-id'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { sanitizeField } from '../lib/sanitize'
import { resolveProjectId } from '../lib/resolve'
import { resolveBoundTaskIdentifier } from '../lib/resolve-bound-task'
import { resolveBoundProjectId } from '../lib/resolve-project'
import { resolveMemoryDir } from '../lib/claude-memory-dir'
import { applySync, type SyncBundle } from '../lib/apply-sync'
import { shouldRunAnchorCheck, runAnchorCheck } from '../lib/anchor-staleness'
import { errAuth, errHttp, errNotLoggedIn } from '../lib/errors'

interface SyncOptions {
  project?: string
  dir?: string
  dryRun?: boolean
  clean?: boolean
  /** commander `--no-anchor-check` sets this to false; default runs the check. */
  anchorCheck?: boolean
}

/**
 * `lumo memory sync` — downsync team memory into the local Claude Code memory
 * store (`~/.claude/projects/<enc>/memory/team/*.md`, the full index in
 * `team/INDEX.md`, and a short managed MEMORY.md block that points at it). Runs alongside session-start injection (retiring injection is
 * LUM-540). Only ever touches files it owns; dev-authored memory is never
 * clobbered. `--dry-run` prints the plan; `--clean` removes everything sync owns.
 */
export async function memorySync(options: SyncOptions): Promise<number | void> {
  if (!options.dir && isCodexShell()) {
    console.error(codexMemoryStoreError('lumo memory sync'))
    return 1
  }
  const dir = resolveMemoryDir(process.cwd(), undefined, options.dir)

  // --clean is purely local — no project, no network, no login required.
  if (options.clean) {
    const summary = applySync(
      dir,
      { projectId: '', entries: [] },
      { clean: true, dryRun: options.dryRun }
    )
    console.log(
      sanitizeField(
        `${options.dryRun ? '[dry-run] ' : ''}cleaned ${summary.removed.length} team memory file(s) from ${dir}`
      )
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

  let res: Response
  try {
    res = await fetch(
      `${base}/api/projects/${encodeURIComponent(projectId)}/memories/sync-bundle`,
      { headers: { Authorization: `Bearer ${creds.token}` } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${apiUrl} (${msg})`)
    return 1
  }
  if (res.status === 401) {
    console.error(errAuth())
    return 1
  }
  if (!res.ok) {
    console.error(errHttp('memory sync', res.status))
    return 1
  }

  const { bundle } = (await res.json()) as { bundle: SyncBundle }
  const summary = applySync(dir, bundle, { dryRun: options.dryRun })

  const prefix = options.dryRun ? '[dry-run] ' : ''
  console.log(sanitizeField(`${prefix}memory sync → ${dir}`))
  console.log(
    sanitizeField(
      `${prefix}+${summary.added.length} added · ~${summary.updated.length} updated · -${summary.removed.length} removed` +
        (summary.skippedDrift.length
          ? ` · ⚠ ${summary.skippedDrift.length} drift-skipped (locally edited)`
          : '')
    )
  )
  if (summary.skippedDrift.length) {
    console.log(
      sanitizeField(
        `  drift-skipped: ${summary.skippedDrift.join(', ')} — local edits preserved (upsync candidates)`
      )
    )
  }

  // Code-anchor staleness (LUM-547): now that the team memory is local, check
  // each memory's code anchors against this repo and report stale candidates to
  // the server (feeds the P4a retire pool; never archives — human confirms).
  // Best-effort: a detection/report failure never fails the sync.
  if (shouldRunAnchorCheck(options)) {
    try {
      const { candidates, report } = await runAnchorCheck({
        cwd: process.cwd(),
        base,
        token: creds.token,
        projectId,
        entries: bundle.entries,
      })
      if (candidates.length > 0 && report.ok) {
        console.log(
          sanitizeField(
            `anchor check → ${candidates.length} stale-anchor candidate(s) reported for human review`
          )
        )
      } else if (candidates.length > 0 && !report.ok) {
        console.log(
          sanitizeField(
            `anchor check → found ${candidates.length} stale candidate(s) but reporting failed (HTTP ${report.status ?? '?'})`
          )
        )
      }
    } catch {
      // detection is advisory — swallow and leave the sync result intact.
    }
  }
}
