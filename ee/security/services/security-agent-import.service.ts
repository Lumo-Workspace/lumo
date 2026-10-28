/**
 * LUM-1321 — `lumo security import`: a security review the developer ran in
 * Claude Code or Codex joins the PR scan through the same durable SARIF
 * ingest run a CI push starts (diff-aware, redacted, replaces this tool's
 * earlier rows on the head).
 *
 * The workflow drops a report it cannot place silently (it has no one to
 * answer); a person is waiting here, so every such refusal is made first,
 * with a reason. Every run's tool name is rewritten to the agent's slug, so
 * the rows are always `ext:<agent>:…` — recognised by `isAgentReviewRuleId`:
 * advisory unless the workspace policy lists an `AGENT_REVIEW` entry
 * (LUM-1328), and never able to replace a CI scanner's rows.
 */
import { gzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { gitProviderFor } from '@/lib/integrations/git-provider/resolve'
import { parseSarif } from '@/ee/security/security-scan/sarif'
import { loadSecurityLayers } from './security-workspace-switches.service'
import { checkSarifIngestRateLimit } from './security-sarif-rate-limit'
import { deleteBlob, putPrivateSarifBlob } from './security-sarif-blob'
import { startSecuritySarifIngest } from './security-sarif-ingest-start'
import { expectedSarifPathname } from '@/ee/security/validation/security-sarif'
import type { AgentImportBody } from '@/ee/security/validation/security-agent-import'
import type { AgentReviewTool } from '@/shared/src/security-scan'

export interface AgentImportCaller {
  workspaceId: string
  memberId: string
}

export interface AgentImportResult {
  runId: string
  repository: string
  prNumber: number
  headSha: string
  tool: AgentReviewTool
  /** Results in the report; the ingest keeps those on the PR's changed lines. */
  results: number
  /** LUM-1330: the name the caller sent, when it was a renamed repository's
   *  old name (`repository` is the current one). */
  renamedFrom?: string
}

function fail(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/** A copy of the document with every run's tool named `tool`. */
function renameTool(
  sarif: Record<string, unknown>,
  tool: AgentReviewTool
): Record<string, unknown> {
  const runs = Array.isArray(sarif['runs']) ? sarif['runs'] : []
  return {
    ...sarif,
    runs: runs.map((run: unknown) => {
      const r = (run ?? {}) as Record<string, unknown>
      const t = (r['tool'] ?? {}) as Record<string, unknown>
      const driver = (t['driver'] ?? {}) as Record<string, unknown>
      return { ...r, tool: { ...t, driver: { ...driver, name: tool } } }
    }),
  }
}

/**
 * The CI push's pathname with a random suffix (`pathnameMatches` shape), so
 * a second import of the same head never overwrites a report still being
 * read.
 */
function importPathname(body: AgentImportBody): string {
  const base = expectedSarifPathname(body).slice(0, -'.sarif.gz'.length)
  return `${base}-${randomBytes(12).toString('hex')}.sarif.gz`
}

/**
 * LUM-1330 — the PR in the repository the caller named. A name renamed away
 * (a clone keeps the old remote) means its current name first: a rename can
 * leave a stale row under the old name (LUM-879 keeps it when the new name
 * already had that number), and that row is no longer importable.
 */
async function findImportTarget(workspaceId: string, body: AgentImportBody) {
  const current = await gitProviderFor(null).resolveRenamedRepository(
    workspaceId,
    body.repository
  )
  if (current !== null) {
    const renamed = await pullRequestRepository.findForSecurityImport(
      workspaceId,
      current,
      body.prNumber
    )
    if (renamed) return { pr: renamed, renamedFrom: body.repository }
  }
  const pr = await pullRequestRepository.findForSecurityImport(
    workspaceId,
    body.repository,
    body.prNumber
  )
  return pr ? { pr, renamedFrom: null } : null
}

export const securityAgentImportService = {
  async import(
    caller: AgentImportCaller,
    body: AgentImportBody
  ): Promise<AgentImportResult> {
    await checkSarifIngestRateLimit(
      `member:${caller.workspaceId}:${caller.memberId}`
    )
    const ref = `${body.repository}#${body.prNumber}`
    const found = await findImportTarget(caller.workspaceId, body)
    if (!found)
      throw fail(
        404,
        `No GitHub pull request ${ref} in this workspace (if the repository was renamed, pass its current owner/name with --repo)`
      )
    const { pr, renamedFrom } = found
    if (pr.state !== 'open')
      throw fail(
        409,
        `Pull request ${ref} is ${pr.state}; import into an open one`
      )
    if (pr.headSha && pr.headSha !== body.headSha)
      throw fail(
        409,
        `Pull request ${ref} head is ${pr.headSha.slice(0, 7)}, not ${body.headSha.slice(0, 7)}: push your commits (just pushed? wait a few seconds for Lumo to see it), or review the PR head`
      )
    const confirmed = await gitProviderFor(pr).loadConfirmedRepositories(
      caller.workspaceId
    )
    if (confirmed(pr.repo) === null)
      throw fail(
        409,
        `Repository ${pr.repo} is not confirmed in this workspace`
      )
    if (!(await loadSecurityLayers(caller.workspaceId)).scan)
      throw fail(409, 'Security scanning is turned off for this workspace')

    const doc = renameTool(body.sarif, body.tool)
    const results = parseSarif(doc).reduce(
      (n, run) => n + run.results.length,
      0
    )
    const blob = await putPrivateSarifBlob(
      importPathname({ ...body, repository: pr.repo }),
      gzipSync(JSON.stringify(doc))
    )
    const runId = await startSecuritySarifIngest({
      url: blob.url,
      pathname: blob.pathname,
      workspaceId: caller.workspaceId,
      repository: pr.repo,
      headSha: body.headSha,
      prNumber: pr.number,
      tool: body.tool,
    })
    if (!runId) {
      // Nothing will read it; the orphan sweep is only the backstop.
      try {
        await deleteBlob(blob.url)
      } catch {
        // the daily sweep removes it
      }
      throw fail(503, 'Could not start the import; try again')
    }
    return {
      runId,
      repository: pr.repo,
      prNumber: pr.number,
      headSha: body.headSha,
      tool: body.tool,
      results,
      ...(renamedFrom ? { renamedFrom } : {}),
    }
  },
}
