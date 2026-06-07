import { prisma } from '@/lib/db/prisma'
import type { LineageFragmentType } from '@prisma/client'
import { memoryManifestLine } from '@/lib/memory/render'

/** Map keyed `${fragmentType}::${fragmentId}` → human-readable source label. */
export type SourceLabelMap = Map<string, string>

function key(type: string, id: string): string {
  return `${type}::${id}`
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve human-readable labels for lineage fragments, one batched query per
 * fragment type that appears (≤ 7 queries total — not a per-edge N+1). Source
 * rows that were deleted are simply absent from the returned map; the lineage
 * service renders a fallback for those. `fragmentId`s passed here are already
 * canonical (LUM-280 resolution happens in the service).
 */
export const lineageSourceRepository = {
  async labelsByType(
    refsByType: Map<LineageFragmentType, string[]>
  ): Promise<SourceLabelMap> {
    const out: SourceLabelMap = new Map()
    const ids = (t: LineageFragmentType): string[] => refsByType.get(t) ?? []

    const memIds = ids('MEMORY')
    if (memIds.length > 0) {
      const rows = await prisma.memory.findMany({
        where: { id: { in: memIds } },
        select: { id: true, scope: true, category: true, content: true },
      })
      for (const r of rows) {
        // memoryManifestLine returns "- [scope] headline…"; drop the bullet.
        const line = memoryManifestLine({
          id: r.id,
          scope: r.scope,
          category: r.category,
          content: r.content,
        }).replace(/^- /, '')
        out.set(key('MEMORY', r.id), line)
      }
    }

    const slackIds = ids('SLACK_CONTEXT')
    if (slackIds.length > 0) {
      const rows = await prisma.taskSlackContext.findMany({
        where: { id: { in: slackIds } },
        select: { id: true, slackChannelName: true, permalink: true },
      })
      for (const r of rows) {
        out.set(
          key('SLACK_CONTEXT', r.id),
          r.slackChannelName ? `#${r.slackChannelName}` : truncate(r.permalink)
        )
      }
    }

    const webIds = ids('WEB_LINK')
    if (webIds.length > 0) {
      const rows = await prisma.taskWebLink.findMany({
        where: { id: { in: webIds } },
        select: { id: true, title: true, url: true },
      })
      for (const r of rows) {
        out.set(key('WEB_LINK', r.id), truncate(r.title ?? r.url))
      }
    }

    const figmaIds = ids('FIGMA')
    if (figmaIds.length > 0) {
      const rows = await prisma.taskFigmaLink.findMany({
        where: { id: { in: figmaIds } },
        select: { id: true, fileName: true, frameName: true },
      })
      for (const r of rows) {
        out.set(
          key('FIGMA', r.id),
          r.frameName ? `${r.fileName} / ${r.frameName}` : r.fileName
        )
      }
    }

    const prIds = ids('PR')
    if (prIds.length > 0) {
      const rows = await prisma.pullRequest.findMany({
        where: { id: { in: prIds } },
        select: { id: true, number: true, title: true },
      })
      for (const r of rows) {
        out.set(key('PR', r.id), `#${r.number} ${truncate(r.title)}`)
      }
    }

    const todoIds = ids('PR_REVIEW_TODO')
    if (todoIds.length > 0) {
      const rows = await prisma.prCommentMirror.findMany({
        where: { id: { in: todoIds } },
        select: { id: true, filePath: true, comment: { select: { body: true } } },
      })
      for (const r of rows) {
        const loc = r.filePath ? `${r.filePath}: ` : ''
        out.set(
          key('PR_REVIEW_TODO', r.id),
          truncate(loc + stripHtml(r.comment.body))
        )
      }
    }

    const sessionIds = ids('SESSION')
    if (sessionIds.length > 0) {
      const rows = await prisma.session.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, summaryType: true },
      })
      for (const r of rows) {
        out.set(
          key('SESSION', r.id),
          `Session ${r.id.slice(0, 8)}${r.summaryType ? ` (${r.summaryType})` : ''}`
        )
      }
    }

    return out
  },
}
