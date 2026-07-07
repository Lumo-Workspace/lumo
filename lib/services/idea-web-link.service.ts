import { ideaWebLinkRepository } from '@/lib/repositories/idea-web-link.repository'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { assertExternalHost } from '@/lib/integrations/og-metadata/ssrf'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import {
  fetchWithFallback,
  normalizeUrl,
} from '@/lib/integrations/og-metadata/fetch-with-fallback'

// Cap stored body so a giant page can't bloat the row / agent context window.
const MAX_BODY_CHARS = 50_000

function err(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

export interface AddIdeaWebLinkInput {
  ideaRef: string
  workspaceId: string
  url: string
  actorMemberId: string
}

export const ideaWebLinkService = {
  async listForIdea(ideaId: string) {
    return ideaWebLinkRepository.listByIdea(ideaId)
  },

  async addWebLink(input: AddIdeaWebLinkInput) {
    const { ideaId, workspaceId } = await resolveIdeaRef({
      workspaceId: input.workspaceId,
      ideaRef: input.ideaRef,
    })

    const { url, domain } = normalizeUrl(input.url)
    const og = await fetchWithFallback(url)

    const payload = og.ok
      ? {
          ideaId,
          workspaceId,
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
          ideaId,
          workspaceId,
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

    return ideaWebLinkRepository.create(payload)
  },

  async refreshWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await ideaWebLinkRepository.getById(linkId)
    if (!link || link.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    const og = await fetchWithFallback(link.url)
    if (og.ok) {
      return ideaWebLinkRepository.updateFetch(linkId, {
        ok: true,
        title: og.data.title,
        description: og.data.description,
        imageUrl: og.data.imageUrl,
        faviconUrl: og.data.faviconUrl,
      })
    }
    return ideaWebLinkRepository.updateFetch(linkId, {
      ok: false,
      error: og.error,
    })
  },

  // On-demand body fetch for retrieval. Returns the already-stored body when
  // present; otherwise runs the SSRF guard, fetches, converts HTML→text, and
  // backfills the row. WebLink cards keep using OG title/desc untouched.
  async fetchBody(workspaceId: string, linkId: string) {
    const link = await ideaWebLinkRepository.getById(linkId)
    if (!link || link.workspaceId !== workspaceId) {
      throw err('not_found', 404)
    }
    if (link.body) return link.body
    await assertExternalHost(link.url) // private/SSRF targets throw here
    const res = await fetch(link.url)
    const html = await res.text()
    const body = htmlToMarkdown(html).slice(0, MAX_BODY_CHARS)
    await ideaWebLinkRepository.updateBody(linkId, body)
    return body
  },

  async unlinkWebLink(linkId: string, expectedWorkspaceId: string) {
    const link = await ideaWebLinkRepository.getById(linkId)
    if (!link || link.workspaceId !== expectedWorkspaceId) {
      throw err('not_found', 404)
    }
    await ideaWebLinkRepository.delete(linkId)
  },
}
