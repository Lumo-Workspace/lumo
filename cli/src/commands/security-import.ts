import { readFileSync, statSync } from 'fs'
import { readCredentials, type Credentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import {
  AGENT_REVIEW_TOOLS,
  detectAgentTool,
  toImportSarif,
  type AgentReviewTool,
} from '../lib/agent-review-format'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'
import { EXIT_ERROR, EXIT_USAGE } from '../lib/exit-codes'
import { emitJson, withVersion } from '../lib/json-output'
import { isMissingPluginRoute, missingPluginMessage } from '../lib/plugin-route'
import { sanitizeField } from '../lib/sanitize'
import {
  detectBranch,
  detectRepo,
  loadScanContext,
  originUrl,
  renamedRemoteLines,
  type ScanContextDeps,
} from '../lib/scan-context'
import { gitOutput } from '../lib/worktree'

/**
 * LUM-1321 — `lumo security import <file>`: attach a security review the
 * developer ran in Claude Code or Codex to the branch's open PR scan. The
 * file is SARIF 2.1.0 or the Lumo JSON (`lib/agent-review-format.ts`). The
 * server keeps the results on lines the PR changed; they are advisory and
 * never block DONE. Importing again for the same tool and head replaces the
 * earlier import.
 */

export const SECURITY_IMPORT_PATH = '/api/workspaces/me/security-scan/import'

/** The server refuses a larger body (413); checked before reading. */
const MAX_FILE_BYTES = 1024 * 1024

export interface SecurityImportOptions {
  tool?: string
  repo?: string
  pr?: string
  json?: boolean
}

export interface SecurityImportDeps extends ScanContextDeps {
  env?: Record<string, string | undefined>
  cwd?: string
}

interface ImportResponse {
  runId: string
  repository: string
  prNumber: number
  headSha: string
  tool: AgentReviewTool
  results: number
  /** LUM-1330: the name sent, when the server followed a rename. */
  renamedFrom?: string
}

function parsePr(value: string): number | null {
  return /^[1-9]\d*$/.test(value) ? Number(value) : null
}

export async function securityImportCommand(
  file: string,
  opts: SecurityImportOptions,
  deps: SecurityImportDeps = {}
): Promise<number> {
  const env = deps.env ?? process.env
  const tool = opts.tool?.toLowerCase() ?? detectAgentTool(env)
  if (tool === null) {
    console.error(
      `Error: pass --tool (${AGENT_REVIEW_TOOLS.join(' | ')}): this shell is not a Claude Code or Codex session`
    )
    return EXIT_USAGE
  }
  if (!(AGENT_REVIEW_TOOLS as readonly string[]).includes(tool)) {
    console.error(
      `Error: invalid --tool "${tool}" (allowed: ${AGENT_REVIEW_TOOLS.join(', ')})`
    )
    return EXIT_USAGE
  }
  if (opts.repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) {
    console.error(`Error: invalid --repo "${opts.repo}" (expected owner/name)`)
    return EXIT_USAGE
  }
  const prArg = opts.pr === undefined ? null : parsePr(opts.pr)
  if (opts.pr !== undefined && prArg === null) {
    console.error(`Error: invalid --pr "${opts.pr}" (a pull request number)`)
    return EXIT_USAGE
  }

  let text: string
  try {
    const stat = statSync(file)
    if (!stat.isFile()) throw new Error('not a file')
    if (stat.size > MAX_FILE_BYTES) {
      console.error(`Error: ${file} is larger than 1 MiB`)
      return EXIT_ERROR
    }
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`Error: cannot read ${file}`)
    return EXIT_ERROR
  }

  const cwd = deps.cwd ?? process.cwd()
  const root = gitOutput(['rev-parse', '--show-toplevel'], cwd)
  const converted = toImportSarif(text, root)
  if (!converted.ok) {
    console.error(`Error: ${file}: ${converted.error}`)
    return EXIT_ERROR
  }

  const creds: Credentials | null = (deps.readCredentials ?? readCredentials)()
  if (!creds) {
    console.error(errNotLoggedIn())
    return EXIT_ERROR
  }
  const repo = opts.repo ?? detectRepo(root)
  if (!repo) {
    console.error('Error: no GitHub origin remote — pass --repo owner/name')
    return EXIT_ERROR
  }
  const head = gitOutput(['rev-parse', 'HEAD'], root)

  let prNumber = prArg
  if (prNumber === null) {
    const branch = detectBranch(root)
    const loaded = await loadScanContext({ repo, branch, offline: false }, deps)
    if (loaded.source !== 'live') {
      console.error(
        `Error: could not find the branch's pull request: ${loaded.note ?? 'no server context'} (or pass --pr <number>)`
      )
      return EXIT_ERROR
    }
    const pr = loaded.context?.pullRequest ?? null
    if (!pr) {
      console.error(
        `Error: no open pull request for ${branch ?? 'this commit'} in ${repo} — push and open one, or pass --pr <number>`
      )
      return EXIT_ERROR
    }
    if (pr.headSha && pr.headSha !== head) {
      console.error(
        `Error: ${repo}#${pr.number} head is ${pr.headSha.slice(0, 7)}, your HEAD is ${head.slice(0, 7)} — push first (just pushed? wait a few seconds for Lumo to see it): the import is checked against the PR's own diff`
      )
      return EXIT_ERROR
    }
    prNumber = pr.number
  }

  const payload = JSON.stringify({
    repository: repo,
    prNumber,
    headSha: head,
    tool,
    sarif: converted.sarif,
  })
  // The server caps the request body, which is larger than the file once a
  // Lumo JSON list becomes SARIF.
  if (Buffer.byteLength(payload, 'utf8') > MAX_FILE_BYTES) {
    console.error(
      `Error: ${file} is larger than 1 MiB once converted to SARIF — shorten the details or drop findings (each import replaces the previous one, so splitting does not work)`
    )
    return EXIT_ERROR
  }
  const url = `${trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))}${SECURITY_IMPORT_PATH}`
  let res: Response
  try {
    res = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API (${msg})`)
    return EXIT_ERROR
  }
  if (isMissingPluginRoute(res)) {
    console.error(missingPluginMessage('security import', 'security'))
    return EXIT_ERROR
  }
  if (res.status === 401) {
    console.error(errAuth())
    return EXIT_ERROR
  }
  if (res.status !== 202) {
    const body = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail = typeof body?.error === 'string' ? body.error : null
    console.error(
      `Error: ${detail ? sanitizeField(detail) : httpFailed('security import', res.status)}`
    )
    return EXIT_ERROR
  }
  const out = (await res.json()) as ImportResponse

  if (opts.json) {
    emitJson(withVersion(out))
    return 0
  }
  const ref = `${sanitizeField(out.repository)}#${out.prNumber}`
  if (out.renamedFrom)
    for (const line of renamedRemoteLines(
      out.renamedFrom,
      out.repository,
      // An explicit --repo named the old name, not the remote.
      opts.repo === undefined ? originUrl(root) : null
    ))
      console.log(line)
  console.log(
    `Imported ${out.results} result${out.results === 1 ? '' : 's'} from ${out.tool} into ${ref} @ ${out.headSha.slice(0, 7)}`
  )
  console.log(
    `Replaces earlier ${out.tool} imports on this head. Lumo keeps the results on lines this PR changed; they are advisory and never block DONE.`
  )
  console.log(
    `The import runs in the background — see it in \`lumo pr show ${out.prNumber}\` in a minute.`
  )
  return 0
}
