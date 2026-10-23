/**
 * LUM-1304 — capture the real pre-merge checks model input for one PR, by
 * running the shipped `preMergeChecksService.run` with every read it makes
 * served from the CLIs instead: the PR and its diff from `gh`, the linked
 * task and its merged PRs from `lumo task show --json`. GitHub helpers and
 * the model client are swapped for `stubs/`, repositories are stubbed, so it
 * touches no database and writes nothing. The repo's stored review settings
 * are taken as the defaults, with no `.lumo.yaml`.
 *
 *   npx tsx scripts/analysis/lum1304-pre-merge-probe/capture.ts \
 *     --repo Lumo-Workspace/lumo --pr 1681 --task LUM-702 --out /abs/scratch/pr1681.json
 *
 * The output carries the PR's text and diff — keep it out of git.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// Swap the GitHub helpers and the model client for the stubs next to this
// file, before anything below imports them.
const STUBS: Record<string, string> = {
  '/lib/integrations/github/contents.ts': 'github-contents.ts',
  '/ee/security/llm/pre-merge-checks-client.ts': 'pre-merge-checks-client.ts',
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    const hit = Object.keys(STUBS).find(k => resolved.url.endsWith(k))
    return hit
      ? {
          ...resolved,
          url: pathToFileURL(`${__dirname}/stubs/${STUBS[hit]}`).href,
        }
      : resolved
  },
})

const g = globalThis as unknown as {
  __lum1304Github: unknown
  __lum1304Captured?: unknown
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  const v = i >= 0 ? process.argv[i + 1] : undefined
  if (!v) throw new Error(`missing --${name}`)
  return v
}

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function main() {
  const repo = arg('repo')
  const prNumber = Number(arg('pr'))
  const taskRef = arg('task')
  const out = arg('out')

  const meta = JSON.parse(
    run('gh', [
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'title,body,author,state,headRefOid,baseRefName',
    ])
  ) as {
    title: string
    body: string
    author: { login: string } | null
    state: string
    headRefOid: string
    baseRefName: string
  }
  const baseSha = run('gh', [
    'api',
    `repos/${repo}/compare/${meta.baseRefName}...${meta.headRefOid}`,
    '--jq',
    '.merge_base_commit.sha',
  ]).trim()
  const diff = run('gh', ['pr', 'diff', String(prNumber), '--repo', repo])
  const task = (
    JSON.parse(run('lumo', ['task', 'show', taskRef, '--json'])) as {
      task: {
        identifier: string
        title: string
        description: string | null
        pullRequests: { number: number; title: string; state: string }[]
      }
    }
  ).task
  const [teamIdentifier, taskNumber] = task.identifier.split('-')
  const workspaceId = 'lum1304-workspace'
  const pullRequestId = 'lum1304-pr'

  g.__lum1304Github = {
    fetchPrDetails: async () => ({
      title: meta.title,
      body: meta.body,
      authorLogin: meta.author?.login ?? null,
      state: meta.state.toLowerCase(),
      headSha: meta.headRefOid,
      baseRef: meta.baseRefName,
      baseSha,
      requestedReviewers: [],
    }),
    fetchPrDiff: async () => diff,
    readPrTemplate: async () => null,
    fetchRepoVisibility: async () => 'private',
    fetchRepoIssues: async () => [],
  }

  const { pullRequestRepository } =
    await import('@/lib/repositories/pull-request.repository')
  const { taskRepository } = await import('@/lib/repositories/task.repository')
  const { repoReviewSettingRepository } =
    await import('@/ee/security/repositories/repo-review-setting.repository')
  const { repoConfigService } =
    await import('@/ee/security/services/repo-config.service')
  const { prSecurityScanRepository } =
    await import('@/ee/security/repositories/pr-security-scan.repository')
  pullRequestRepository.findById = (async () => ({
    id: pullRequestId,
    taskId: 'lum1304-task',
  })) as never
  pullRequestRepository.listMergedByTask = (async () =>
    task.pullRequests
      .filter(p => p.state === 'merged')
      .map(p => ({
        workspaceId,
        repo,
        number: p.number,
        title: p.title,
      }))) as never
  taskRepository.findForRequirements = (async () => ({
    number: Number(taskNumber),
    title: task.title,
    description: task.description,
    team: { identifier: teamIdentifier },
  })) as never
  repoReviewSettingRepository.findSettings = (async () => []) as never
  repoConfigService.fileForDecision = (async () => null) as never
  prSecurityScanRepository.setPreMergeChecks = (async () => undefined) as never
  prSecurityScanRepository.findPreMergeChecks = (async () => null) as never

  const { preMergeChecksService } =
    await import('@/ee/security/services/pre-merge-checks.service')
  await preMergeChecksService.run(
    {
      scanId: 'lum1304-capture',
      pullRequestId,
      workspaceId,
      repo,
      prNumber,
      headSha: meta.headRefOid,
    },
    diff
  )
  const captured = g.__lum1304Captured as { checks: { id: string }[] } | null
  if (!captured) throw new Error('the service made no model call')
  writeFileSync(out, JSON.stringify({ repo, prNumber, input: captured }))
  process.stdout.write(
    `captured ${repo}#${prNumber}: checks=${captured.checks.map(c => c.id).join(',')}\n`
  )
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`)
  process.exitCode = 1
})
