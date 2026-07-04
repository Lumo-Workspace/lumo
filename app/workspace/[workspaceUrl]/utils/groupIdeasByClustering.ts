import type { ApiIdea } from '../types'
import type { LatestClustering } from '@/lib/api-client/plan-runs'

export interface IdeaCluster {
  name: string
  ideas: ApiIdea[]
}

export interface GroupedIdeas {
  clusters: IdeaCluster[]
  /** Ideas not in the latest clustering (never grouped, or captured since). */
  ungrouped: ApiIdea[]
}

/**
 * Group the idea pool by the latest run's clustering (LUM-677). Each idea
 * renders under its cluster; ideas not referenced by the clustering — including
 * ones captured after the run — fall into the `ungrouped` bucket. Returns null
 * when there is no clustering, so the caller falls back to a flat list.
 *
 * Pure: derives entirely from the passed-in clustering (no LLM, no fetch). Empty
 * clusters (all their ideas since deleted) are dropped so the view stays tidy.
 */
export function groupIdeasByClustering(
  ideas: ApiIdea[],
  clustering: LatestClustering | null
): GroupedIdeas | null {
  if (!clustering) return null

  const byId = new Map(ideas.map(idea => [idea.id, idea]))
  const grouped = new Set<string>()

  const clusters: IdeaCluster[] = clustering.clusters
    .map(cluster => {
      const clusterIdeas: ApiIdea[] = []
      for (const id of cluster.ideaIds) {
        const idea = byId.get(id)
        if (idea && !grouped.has(id)) {
          grouped.add(id)
          clusterIdeas.push(idea)
        }
      }
      return { name: cluster.name, ideas: clusterIdeas }
    })
    .filter(cluster => cluster.ideas.length > 0)

  const ungrouped = ideas.filter(idea => !grouped.has(idea.id))

  return { clusters, ungrouped }
}
