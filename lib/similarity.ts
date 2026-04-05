/**
 * Compute bigram-based similarity between two strings.
 * Uses containment check first (score = 1.0 if one contains the other),
 * then falls back to Dice coefficient over character bigrams.
 */
export function bigramSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()

  if (!na || !nb) return 0

  const bigramsA = toBigrams(na)
  const bigramsB = toBigrams(nb)

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  // Containment check (only meaningful when both strings have bigrams)
  if (na.includes(nb) || nb.includes(na)) return 1

  let shared = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) shared++
  }

  return (2 * shared) / (bigramsA.size + bigramsB.size)
}

function toBigrams(s: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2))
  }
  return set
}

export interface SimilarTaskMatch<T> {
  task: T
  score: number
}

/**
 * Find tasks similar to the given title within a specific project.
 * Returns matches sorted by score descending.
 */
export function findSimilarTasks<
  T extends { id: string; title: string; projectId: string },
>(
  title: string,
  tasks: T[],
  projectId: string,
  options: { threshold: number; maxResults: number }
): SimilarTaskMatch<T>[] {
  const trimmed = title.trim()
  if (trimmed.length < 3) return []

  const { threshold, maxResults } = options

  const matches: SimilarTaskMatch<T>[] = []

  for (const task of tasks) {
    if (task.projectId !== projectId) continue
    const score = bigramSimilarity(trimmed, task.title)
    if (score >= threshold) {
      matches.push({ task, score })
    }
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, maxResults)
}
