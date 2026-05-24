import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import type { OutboundActorKind } from '@prisma/client'

interface Repo {
  owner: string
  name: string
}

interface OutboundActorResult {
  actor: OutboundActorKind
  token: string
  userId: string | null
}

const CACHE_TTL_MS = 10 * 60 * 1000
const writeCache = new Map<string, { until: number; canWrite: boolean }>()

async function canWriteRepo(token: string, repo: Repo): Promise<boolean> {
  const key = `${token.slice(0, 8)}:${repo.owner}/${repo.name}`
  const cached = writeCache.get(key)
  if (cached && cached.until > Date.now()) return cached.canWrite
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  )
  if (!res.ok) {
    writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite: false })
    return false
  }
  const body = (await res.json()) as { permissions?: { push?: boolean } }
  const canWrite = body.permissions?.push === true
  writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite })
  return canWrite
}

interface ResolveActorInput {
  workspaceId: string
  authorUserId: string
  repo: Repo
}

/** Exposed only for testing — clears the in-process write-permission cache. */
export function _clearWriteCacheForTesting() {
  writeCache.clear()
}

export const prCommentMirrorService = {
  async resolveOutboundActor(
    input: ResolveActorInput
  ): Promise<OutboundActorResult> {
    const integration =
      await githubRepository.findIntegrationByUserAndWorkspace(
        input.workspaceId,
        input.authorUserId
      )
    if (integration) {
      const token = decrypt(integration.accessToken)
      if (await canWriteRepo(token, input.repo)) {
        return { actor: 'USER_OAUTH', token, userId: input.authorUserId }
      }
    }
    // getGithubInstallationToken() takes no args (single Lumo App installation; see lib/integrations/github/auth.ts:7)
    const appToken = await getGithubInstallationToken()
    return { actor: 'BOT_APP', token: appToken, userId: null }
  },

  async runOutbound(_commentId: string, _op: 'CREATE' | 'UPDATE' | 'DELETE') {
    throw new Error('not implemented — Task 9-11')
  },

  async runInbound(_payload: unknown) {
    throw new Error('not implemented — Task 12-15')
  },

  async scheduleOutbound(
    _commentId: string,
    _op: 'CREATE' | 'UPDATE' | 'DELETE',
    _opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
  ) {
    throw new Error('not implemented — Task 16')
  },
}
