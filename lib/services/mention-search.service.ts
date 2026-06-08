import { mentionSearchRepository } from '@/lib/repositories/mention-search.repository'
import { slugify } from '@/lib/utils/slugify'
import type { MentionSearchItem } from '@/types/mention'

/**
 * 统一实体搜索:并行查四类,映射成带应用内相对 href 的 MentionSearchItem[]。
 * 人不在此(走客户端缓存)。空白 query 直接返回 []。
 */
export const mentionSearchService = {
  async search(
    workspaceId: string,
    workspaceSlug: string,
    query: string,
    perKind: number
  ): Promise<MentionSearchItem[]> {
    const q = query.trim()
    if (!q) return []

    const [tasks, sprints, projects, milestones] = await Promise.all([
      mentionSearchRepository.searchTasks(workspaceId, q, perKind),
      mentionSearchRepository.searchSprints(workspaceId, q, perKind),
      mentionSearchRepository.searchProjects(workspaceId, q, perKind),
      mentionSearchRepository.searchMilestones(workspaceId, q, perKind),
    ])

    const items: MentionSearchItem[] = []

    for (const t of tasks) {
      const identifier = `${t.team.identifier}-${t.number}`
      items.push({
        kind: 'task',
        id: t.id,
        label: identifier,
        sublabel: t.title,
        status: t.status,
        href: `/workspace/${workspaceSlug}/tasks/${identifier}`,
      })
    }
    for (const s of sprints) {
      items.push({
        kind: 'sprint',
        id: s.id,
        label: `Sprint ${s.number}`,
        sublabel: s.name,
        status: s.status,
        href: `/workspace/${workspaceSlug}/sprints/${s.number}`,
      })
    }
    for (const p of projects) {
      items.push({
        kind: 'project',
        id: p.id,
        label: p.name,
        href: `/workspace/${workspaceSlug}/projects/${slugify(p.name)}`,
      })
    }
    for (const ms of milestones) {
      items.push({
        kind: 'milestone',
        id: ms.id,
        label: ms.name,
        href: `/workspace/${workspaceSlug}/projects/${slugify(ms.project.name)}/milestones/${ms.slug}`,
      })
    }
    return items
  },
}
