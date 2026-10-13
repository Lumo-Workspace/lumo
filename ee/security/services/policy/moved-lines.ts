/**
 * LUM-1114 — code a PR only moves is not code it adds.
 *
 * A code rule judges the PR's ADDED lines. When a file is rewritten (a table
 * turned into cards, a function extracted into a new module) the untouched old
 * code shows up as `-` at its old position and `+` at its new one, and a rule
 * the old code already broke fires as if the PR introduced it (LUM-718: an
 * existing `new Date(task.updatedAt)` that only moved down a few lines).
 *
 * Pairs each added line with a removed line of the same content anywhere in the
 * PR (whitespace-insensitive, multiset — a line added twice but removed once
 * still counts as added once) and rewrites the pair as one context line, so the
 * deterministic diff-regex pass and the semantic judge (which ignores context
 * lines) both see only what the PR really adds. Pure; hunk headers are left as
 * they are — nothing downstream reads their counts.
 */

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

function isAdded(line: string): boolean {
  return line.startsWith('+') && !line.startsWith('+++ ')
}

function isRemoved(line: string): boolean {
  return line.startsWith('-') && !line.startsWith('--- ')
}

export function neutralizeMovedLines(diff: string): string {
  const lines = diff.split('\n')
  const removed = new Map<string, number>()
  for (const line of lines) {
    if (!isRemoved(line)) continue
    const key = normalize(line.slice(1))
    if (key) removed.set(key, (removed.get(key) ?? 0) + 1)
  }
  if (removed.size === 0) return diff

  // Pass 1: each added line takes one matching removed line, if any is left.
  const paired = new Map<string, number>()
  const out = lines.map(line => {
    if (!isAdded(line)) return line
    const key = normalize(line.slice(1))
    const left = removed.get(key) ?? 0
    if (!key || left === 0) return line
    removed.set(key, left - 1)
    paired.set(key, (paired.get(key) ?? 0) + 1)
    return ` ${line.slice(1)}`
  })

  // Pass 2: drop the removed lines that were paired.
  return out
    .filter(line => {
      if (!isRemoved(line)) return true
      const key = normalize(line.slice(1))
      const n = paired.get(key) ?? 0
      if (n === 0) return true
      paired.set(key, n - 1)
      return false
    })
    .join('\n')
}
