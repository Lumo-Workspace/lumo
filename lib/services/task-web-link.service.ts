import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'
import { fetchOpenGraph } from '@/lib/integrations/og-metadata/fetch'
import { fetchOpenGraphChromium } from '@/lib/integrations/og-metadata/fetch-chromium'
import { shouldEscalateToChromium } from '@/lib/integrations/og-metadata/should-escalate'
import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import type { FetchResult } from '@/lib/integrations/og-metadata/fetch'

// Cap stored body so a giant page can't bloat the row / agent context window.
const MAX_BODY_CHARS = 50_000

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

function normalizeUrl(raw: string): { url: string; domain: string } {
  const u = new URL(raw.trim())
  u.protocol = u.protocol.toLowerCase()
  u.hostname = u.hostname.toLowerCase()
  u.hash = ''
  return { url: u.toString(), domain: u.hostname }
}

// Single entrypoint: try fast, escalate to chromium on block signal.
async function fetchWithFallback(url: string): Promise<FetchResult> {
  const fast = await fetchOpenGraph(url)
  if (fast.ok) return fast
  if (!shouldEscalateToChromium(fast.error)) return fast
  console.info(
    `[og] escalating to chromium: ${new URL(url).hostname} reason=${fast.error}`
  )
  return fetchOpenGraphChromium(url)
}

export interface AddWebLinkInput {
  taskId: string
  workspaceId: string
  url: string
  actorMemberId: string
}

export const taskWebLinkService = {
  async listForTask(taskId: string) {
    return taskWebLinkRepository.listByTask(taskId)
  },

  async addWebLink(input: AddWebLinkInput) {
    const { url, domain } = normalizeUrl(input.url)
    const og = await fetchWithFallback(url)

    const payload = og.ok
      ? {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: og.data.title ?? null,
          description: og.data.description ?? null,
          note: null,
          imageUrl: og.data.imageUrl ?? null,
          faviconUrl: og.data.faviconUrl ?? null,
          fetchedAt: new Date(),
          fetchError: null,
          createdById: input.actorMemberId,
        }
      : {
          taskId: input.taskId,
          workspaceId: input.workspaceId,
          url,
          domain,
          title: null,
          description: null,
          note: null,
          imageUrl: null,
          faviconUrl: null,
          fetchedAt: null,
          fetchError: og.error,
          createdById: input.actorMemberId,
        }

    return taskWebLinkRepository.create(payload)
  },

  async refreshWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    const og = await fetchWithFallback(link.url)
    if (og.ok) {
      return taskWebLinkRepository.updateFetch(linkId, {
        ok: true,
        title: og.data.title,
        description: og.data.description,
        imageUrl: og.data.imageUrl,
        faviconUrl: og.data.faviconUrl,
      })
    }
    return taskWebLinkRepository.updateFetch(linkId, {
      ok: false,
      error: og.error,
    })
  },

  // On-demand body fetch for retrieval. Returns the already-stored body when
  // present; otherwise runs the SSRF guard, fetches, converts HTML→text, and
  // backfills the row. WebLink cards keep using OG title/desc untouched.
  async fetchBody(workspaceId: string, linkId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== workspaceId) {
      throw err('not_found', 404)
    }
    if (link.body) return link.body
    await assertExternalHost(link.url) // private/SSRF targets throw here
    const res = await fetch(link.url)
    const html = await res.text()
    const body = htmlToMarkdown(html).slice(0, MAX_BODY_CHARS)
    await taskWebLinkRepository.updateBody(linkId, body)
    return body
  },

  async unlinkWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await taskWebLinkRepository.getById(linkId)
    if (!link || link.task.project.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    await taskWebLinkRepository.delete(linkId)
  },
}
