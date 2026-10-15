/**
 * LUM-1158 — thin `gh api` / `git` wrappers for the benchmark scripts.
 * Uses the developer's logged-in `gh`; nothing here stores a token.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const MAX_BUFFER = 256 * 1024 * 1024

export function gh(args: readonly string[]): string {
  return execFileSync('gh', ['api', ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function ghJson<T>(
  apiPath: string,
  params: Record<string, string> = {}
): T {
  const flags = Object.entries(params).flatMap(([k, v]) => ['-f', `${k}=${v}`])
  const method = flags.length ? ['-X', 'GET'] : []
  return JSON.parse(gh([...method, apiPath, ...flags])) as T
}

/** Every page of a list endpoint, flattened. */
export function ghList<T>(apiPath: string): T[] {
  const sep = apiPath.includes('?') ? '&' : '?'
  const pages = JSON.parse(
    gh(['--paginate', '--slurp', `${apiPath}${sep}per_page=100`])
  ) as T[][]
  return pages.flat()
}

/** A diff from the compare / commit endpoints. */
export function ghDiff(apiPath: string): string {
  return gh(['-H', 'Accept: application/vnd.github.diff', apiPath])
}

/** A searched PR with the repository facts the sample filters on. */
export interface SearchItem {
  url: string
  number: number
  repo: string
  stars: number
  fork: boolean
  license: string | null
  authorIsBot: boolean
  changedLines: number
  mergedAt: string | null
  base: string
  head: string
}

const SEARCH_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        url number additions deletions mergedAt baseRefOid headRefOid
        author { __typename }
        repository { nameWithOwner stargazerCount isFork licenseInfo { spdxId } }
      }
    }
  }
}`

interface SearchNode {
  url?: string
  number: number
  additions: number
  deletions: number
  mergedAt: string | null
  baseRefOid: string
  headRefOid: string
  author: { __typename: string } | null
  repository: {
    nameWithOwner: string
    stargazerCount: number
    isFork: boolean
    licenseInfo: { spdxId: string } | null
  }
}

type SearchPage = {
  data: {
    search: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: SearchNode[]
    }
  }
}

/** One GraphQL search page; retries rate limits and the API's 502/504s. */
async function searchPage(
  query: string,
  after: string | null
): Promise<SearchPage> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const cursor = after ? ['-f', `after=${after}`] : []
      return JSON.parse(
        gh([
          'graphql',
          '-f',
          `query=${SEARCH_QUERY}`,
          '-f',
          `q=${query}`,
          ...cursor,
        ])
      ) as SearchPage
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (
        !/rate limit|403|429|502|503|504|unexpected EOF|ECONNRESET|timed? ?out/i.test(
          msg
        )
      )
        throw e
      await new Promise(r => setTimeout(r, 15_000 * (attempt + 1)))
    }
  }
  // Never read a failed search as an empty day: that would thin the sample silently.
  throw new Error(`search still failing after retries: ${query}`)
}

/**
 * Up to 100 PRs of a search through GraphQL (2 pages of 50: 100 at once
 * times out), with the repo's stars/license and the PR's size inline — one
 * call instead of two REST calls per candidate.
 */
export async function searchPrs(query: string): Promise<SearchItem[]> {
  const nodes: SearchNode[] = []
  let after: string | null = null
  for (let page = 0; page < 2; page++) {
    const res: SearchPage = await searchPage(query, after)
    nodes.push(...res.data.search.nodes)
    if (!res.data.search.pageInfo.hasNextPage) break
    after = res.data.search.pageInfo.endCursor
  }
  return nodes
    .filter(n => n.url)
    .map(n => ({
      url: n.url!,
      number: n.number,
      repo: n.repository.nameWithOwner,
      stars: n.repository.stargazerCount,
      fork: n.repository.isFork,
      license: n.repository.licenseInfo?.spdxId ?? null,
      authorIsBot: n.author?.__typename === 'Bot',
      changedLines: n.additions + n.deletions,
      mergedAt: n.mergedAt,
      base: n.baseRefOid,
      head: n.headRefOid,
    }))
}

function git(cwd: string, args: readonly string[]): string {
  // LFS repos: keep pointer files instead of needing git-lfs to smudge them.
  const lfsOff = [
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.required=false',
  ]
  return execFileSync('git', [...lfsOff, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * A detached worktree of `repo` at `sha` under `<root>/co/<key>` (the LUM-988
 * verifier's layout). Re-running skips what exists.
 */
export function checkoutAt(
  root: string,
  repo: string,
  sha: string,
  key: string
): string {
  const dest = path.join(root, 'co', key)
  if (existsSync(dest)) return dest
  const repoDir = path.join(root, 'repos', repo.replace('/', '_'))
  if (!existsSync(repoDir)) {
    mkdirSync(repoDir, { recursive: true })
    git(repoDir, ['init', '-q'])
    git(repoDir, ['remote', 'add', 'origin', `https://github.com/${repo}.git`])
  }
  git(repoDir, ['fetch', '-q', '--depth', '1', 'origin', sha])
  mkdirSync(path.join(root, 'co'), { recursive: true })
  git(repoDir, ['worktree', 'add', '-q', '--detach', dest, sha])
  return dest
}
