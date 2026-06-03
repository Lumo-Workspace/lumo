import { bigramSimilarity } from '@/lib/similarity'

/** Jaccard similarity over two tag-name sets (0 when either is empty). */
export function tagJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a.map(t => t.toLowerCase()))
  const setB = new Set(b.map(t => t.toLowerCase()))
  let inter = 0
  for (const t of setA) {
    if (setB.has(t)) inter++
  }
  const union = setA.size + setB.size - inter
  return union === 0 ? 0 : inter / union
}

/** Combined similarity: 0.7 * title bigram + 0.3 * tag Jaccard. */
export function scoreCandidate(
  target: { title: string; tags: string[] },
  candidate: { title: string; tags: string[] }
): number {
  const titleScore = bigramSimilarity(target.title, candidate.title)
  const tagScore = tagJaccard(target.tags, candidate.tags)
  return 0.7 * titleScore + 0.3 * tagScore
}
