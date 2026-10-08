/**
 * LUM-886 — live probe: does every narrowed installation-token permission set
 * actually reach the GitHub endpoints its callers hit, and does the committed
 * production App permission list still match the live App?
 *
 * 1. Reads `GET /apps/uselumo` (through `gh`) and compares its
 *    permissions with `PRODUCTION_APP_PERMISSIONS`; every set in
 *    `REPO_TOKEN_PERMISSIONS` must fit inside the live list.
 * 2. Mints one token per set through the App configured in env (locally the
 *    dev App, lumo-agent-test — the production App's key is not on this
 *    machine) for ONE repository, with exactly that set, and calls every
 *    read endpoint the set's callers use. Write endpoints are not exercised:
 *    the write set is checked by listing through the same token (GitHub
 *    refuses the mint itself when a permission is not granted, which is the
 *    failure this task guards against).
 * 3. Negative control: the pull-request token must NOT read file contents,
 *    so the narrowing is proven to take effect.
 * 4. LUM-890: mints each `INSTALLATION_TOKEN_PERMISSIONS` set installation-wide
 *    (no repository narrowing), exactly as `createInstallationToken` does, and
 *    calls the endpoints its callers use: the installation's repository list,
 *    and the collaborator-permission / user lookups of the access recheck
 *    (asked about the `gh` user's login). Negative control: that token must
 *    NOT read pull requests or file contents. The PR backfill's list call is
 *    checked under `pullRequestRead`, the per-repository set it now mints.
 * Every token is revoked when its checks finish.
 *
 * Exits 1 on any failure.
 *
 *   npx tsx scripts/analysis/lum886-token-permissions/probe.ts [owner/repo]
 *
 * Default repository: Lumo-Workspace/lumo. Needs GITHUB_APP_ID and
 * GITHUB_APP_PRIVATE_KEY: read from the environment, else `.env.local` in the
 * cwd, else `.env.local` of the main checkout (worktrees have none).
 */
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import type { RepoTokenPermissions } from '@/lib/integrations/github/auth'

function loadEnv() {
  if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) return
  const candidates = [path.resolve('.env.local')]
  try {
    const common = execSync(
      'git rev-parse --path-format=absolute --git-common-dir',
      { encoding: 'utf8' }
    ).trim()
    candidates.push(path.join(path.dirname(common), '.env.local'))
  } catch {
    // not in a git checkout — rely on cwd only
  }
  const found = candidates.find(p => fs.existsSync(p))
  if (found) config({ path: found, quiet: true })
}

const GH = 'https://api.github.com'
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lumo-lum886-probe',
}

let failures = 0
function report(ok: boolean, label: string, detail: string) {
  if (!ok) failures++
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}\n`)
}

async function get(
  url: string,
  token: string | null,
  accept?: string
): Promise<Response> {
  return fetch(url, {
    headers: {
      ...HEADERS,
      ...(accept && { Accept: accept }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })
}

async function main() {
  loadEnv()
  const repository = process.argv[2] ?? 'Lumo-Workspace/lumo'
  const [owner, name] = repository.split('/') as [string, string]

  const {
    REPO_TOKEN_PERMISSIONS,
    INSTALLATION_TOKEN_PERMISSIONS,
    PRODUCTION_APP_PERMISSIONS,
    isWithinPermissions,
  } = await import('@/lib/integrations/github/token-permissions')
  const {
    createInstallationToken,
    createRepoTokenForInstallation,
    getGithubAppJwt,
    revokeInstallationToken,
  } = await import('@/lib/integrations/github/auth')

  // 1 — the committed production list vs the live App.
  // Unauthenticated, GET /apps/{slug} omits `permissions`; `gh` supplies a
  // user token, which is enough.
  const live = JSON.parse(
    execSync('gh api apps/uselumo --jq .permissions', { encoding: 'utf8' })
  ) as Record<string, string>
  const liveJson = JSON.stringify(Object.entries(live ?? {}).sort())
  const committedJson = JSON.stringify(
    Object.entries(PRODUCTION_APP_PERMISSIONS).sort()
  )
  report(
    liveJson === committedJson,
    'production App permission list',
    liveJson === committedJson
      ? 'committed list matches GET /apps/uselumo'
      : `live ${liveJson} ≠ committed ${committedJson}`
  )
  for (const [set, perms] of Object.entries({
    ...REPO_TOKEN_PERMISSIONS,
    ...INSTALLATION_TOKEN_PERMISSIONS,
  })) {
    const ok = isWithinPermissions(perms, (live ?? {}) as never)
    report(ok, `${set} ⊆ live production App`, JSON.stringify(perms))
  }

  // 2 — mint each set for one repository and hit its endpoints.
  const jwt = await getGithubAppJwt()
  const instRes = await get(`${GH}/repos/${repository}/installation`, jwt)
  if (!instRes.ok) {
    report(false, 'installation lookup', `HTTP ${instRes.status}`)
    process.exit(1)
  }
  const inst = (await instRes.json()) as {
    id: number
    app_slug: string
    permissions: Record<string, string>
  }
  process.stdout.write(
    `      minting through ${inst.app_slug} installation ${inst.id} on ${repository}\n`
  )

  const minted: string[] = []
  /**
   * One repository (as `getRepoToken` mints), or the whole installation
   * through the real `createInstallationToken` (LUM-890).
   */
  async function mint(
    permissions: RepoTokenPermissions,
    scope: 'repository' | 'installation' = 'repository'
  ): Promise<string> {
    const token =
      scope === 'repository'
        ? await createRepoTokenForInstallation(inst.id, repository, permissions)
        : await createInstallationToken(inst.id, permissions)
    minted.push(token)
    return token
  }

  const repoBase = `${GH}/repos/${owner}/${name}`
  // A recently merged PR — it has a diff, files, a head commit with CI.
  const pulls = (await (
    await get(
      `${repoBase}/pulls?state=closed&per_page=10`,
      await mint(REPO_TOKEN_PERMISSIONS.pullRequestRead)
    )
  ).json()) as Array<{
    number: number
    head: { sha: string }
    merged_at: string | null
  }>
  const pr = pulls.find(p => p.merged_at)
  if (!pr) {
    report(false, 'fixture', 'no merged PR found to probe against')
    process.exit(1)
  }
  process.stdout.write(
    `      probing PR #${pr.number} @ ${pr.head.sha.slice(0, 12)}\n`
  )

  async function expect(
    set: string,
    token: string,
    label: string,
    url: string,
    want: 'ok' | 'denied',
    accept?: string
  ) {
    const res = await get(url, token, accept)
    const ok = want === 'ok' ? res.ok : res.status === 403 || res.status === 404
    report(ok, `${set}: ${label}`, `HTTP ${res.status} (want ${want})`)
  }

  try {
    const contents = await mint(REPO_TOKEN_PERMISSIONS.contentsRead)
    await expect(
      'contentsRead',
      contents,
      'GET contents/{path}',
      `${repoBase}/contents/package.json`,
      'ok'
    )
    await expect('contentsRead', contents, 'GET repo', repoBase, 'ok')
    await expect(
      'contentsRead',
      contents,
      'GET git/ref/heads/main',
      `${repoBase}/git/ref/heads/main`,
      'ok'
    )

    const pull = `${repoBase}/pulls/${pr.number}`
    await expect(
      'contentsRead',
      contents,
      'GET pulls/{n} (diff)',
      pull,
      'ok',
      'application/vnd.github.v3.diff'
    )

    const prRead = await mint(REPO_TOKEN_PERMISSIONS.pullRequestRead)
    await expect('pullRequestRead', prRead, 'GET pulls/{n} (json)', pull, 'ok')
    await expect(
      'pullRequestRead',
      prRead,
      'GET pulls/{n}/files',
      `${pull}/files?per_page=100`,
      'ok'
    )
    await expect(
      'pullRequestRead',
      prRead,
      'GET commits/{sha}/pulls',
      `${repoBase}/commits/${pr.head.sha}/pulls`,
      'ok'
    )
    // The install / re-verify PR backfill (listRecentPullRequests), LUM-890.
    await expect(
      'pullRequestRead',
      prRead,
      'GET pulls?state=all (PR backfill)',
      `${repoBase}/pulls?state=all&per_page=100&sort=updated&direction=desc`,
      'ok'
    )
    await expect(
      'pullRequestRead',
      prRead,
      'negative: GET contents/{path}',
      `${repoBase}/contents/package.json`,
      'denied'
    )

    const prWrite = await mint(REPO_TOKEN_PERMISSIONS.pullRequestWrite)
    await expect(
      'pullRequestWrite',
      prWrite,
      'GET issues/{n}/comments',
      `${repoBase}/issues/${pr.number}/comments`,
      'ok'
    )
    await expect(
      'pullRequestWrite',
      prWrite,
      'GET pulls/{n}/comments',
      `${pull}/comments`,
      'ok'
    )
    await expect(
      'pullRequestWrite',
      prWrite,
      'GET pulls/{n}/reviews',
      `${pull}/reviews`,
      'ok'
    )
    await expect(
      'pullRequestWrite',
      prWrite,
      'negative: GET contents/{path}',
      `${repoBase}/contents/package.json`,
      'denied'
    )

    // 4 — LUM-890: installation-wide tokens.
    const repoList = await mint(
      INSTALLATION_TOKEN_PERMISSIONS.repositoryList,
      'installation'
    )
    const listRes = await get(
      `${GH}/installation/repositories?per_page=100&page=1`,
      repoList
    )
    const listed = listRes.ok
      ? ((
          (await listRes.json()) as {
            repositories?: Array<{ full_name?: string }>
          }
        ).repositories ?? [])
      : []
    report(
      listRes.ok &&
        listed.some(
          r => r.full_name?.toLowerCase() === repository.toLowerCase()
        ),
      'repositoryList: GET /installation/repositories',
      `HTTP ${listRes.status}, ${listed.length} repositories, ${repository} ${
        listed.some(
          r => r.full_name?.toLowerCase() === repository.toLowerCase()
        )
          ? 'listed'
          : 'MISSING'
      }`
    )
    await expect(
      'repositoryList',
      repoList,
      'negative: GET pulls/{n}',
      pull,
      'denied'
    )

    const login = execSync('gh api user --jq .login', {
      encoding: 'utf8',
    }).trim()
    const access = await mint(
      INSTALLATION_TOKEN_PERMISSIONS.collaboratorAccess,
      'installation'
    )
    const permRes = await get(
      `${repoBase}/collaborators/${encodeURIComponent(login)}/permission`,
      access
    )
    const permission = permRes.ok
      ? ((await permRes.json()) as { permission?: string }).permission
      : undefined
    report(
      permRes.ok && typeof permission === 'string',
      'collaboratorAccess: GET collaborators/{login}/permission',
      `HTTP ${permRes.status}, ${login} → ${permission ?? 'no answer'}`
    )
    await expect(
      'collaboratorAccess',
      access,
      'GET users/{login}',
      `${GH}/users/${encodeURIComponent(login)}`,
      'ok'
    )
    await expect(
      'collaboratorAccess',
      access,
      'negative: GET pulls/{n}',
      pull,
      'denied'
    )
    await expect(
      'collaboratorAccess',
      access,
      'negative: GET contents/{path}',
      `${repoBase}/contents/package.json`,
      'denied'
    )
  } finally {
    await Promise.all(minted.map(t => revokeInstallationToken(t)))
  }

  process.stdout.write(
    failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(error => {
  process.stderr.write(
    `probe crashed: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(1)
})
