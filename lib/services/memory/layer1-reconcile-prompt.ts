import type { MemoryCategory } from '@prisma/client'

interface ReconcileInput {
  task: { title: string; description: string | null }
  candidates: Array<{ category: MemoryCategory; scope?: 'TASK' | 'PROJECT'; content: unknown }>
  neighborsByCandidate: Array<
    Array<{ id: string; category: MemoryCategory; content: unknown; score: number }>
  >
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You reconcile newly-extracted candidate memories against the existing task memory store.

You are given a list of CANDIDATES (new facts just extracted from a coding turn). For each candidate you are shown its NEIGHBORS — the most similar existing memories already on file (with their ids). Decide, per candidate, exactly one operation. Output a flat JSON list of operations across all candidates.

# Operations
- ADD — the candidate is genuinely new; no neighbor already says it. Provide { category, content, scope? } (keep the candidate's category/content/scope).
- UPDATE — a neighbor says ALMOST the same thing and the candidate refines or extends it. Provide the neighbor's id + a full replacement content object (SAME category as that neighbor). Use this for near-duplicates — never emit a second ADD for something a neighbor already covers.
- SUPERSEDE — a neighbor is now CONTRADICTED or replaced by the candidate (the old fact is wrong/outdated). Provide the neighbor's id + the new content (SAME category as that neighbor). SUPERSEDE is only for same-category contradiction; if the replacement is a different category, emit DELETE on the neighbor + ADD the candidate instead.
- DELETE — a neighbor is obsolete and the candidate merely confirms it should go (rare). Provide the neighbor's id.
- NOOP — the candidate is already fully represented by a neighbor; nothing to write. Emitting nothing for a candidate is equivalent — prefer NOOP explicitly when a neighbor already covers it.

# Decision rules
- Near-duplicate (a neighbor already says it) → UPDATE if the candidate adds signal, else NOOP. NEVER ADD.
- Contradiction (candidate says the opposite of a neighbor) → SUPERSEDE that neighbor (same category) — do not leave both.
- No relevant neighbor → ADD.
- Only reference an id that appears in that candidate's neighbor list. Never invent ids.
- Content shapes per category are unchanged (TRAP/DECISION/CONVENTION/PROCEDURAL). Keep the same terse, plain-words writing style as the candidates.`

export function buildLayer1ReconcilePrompt(input: ReconcileInput): BuiltPrompt {
  const description = input.task.description?.trim() || '(no description)'
  const blocks = input.candidates.map((c, i) => {
    const neighbors = input.neighborsByCandidate[i] ?? []
    const neighborLines = neighbors.length
      ? neighbors
          .map(
            n =>
              `    - id=${n.id} category=${n.category} content=${JSON.stringify(n.content)}`
          )
          .join('\n')
      : '    (no similar existing memories)'
    return `Candidate #${i} category=${c.category}${c.scope ? ` scope=${c.scope}` : ''}
  content=${JSON.stringify(c.content)}
  Neighbors:
${neighborLines}`
  })

  const user = `# Task context
Title: ${input.task.title}
Description: ${description}

# Candidates and their neighbors
${blocks.join('\n\n') || '(no candidates)'}

# Your output
Return { "operations": [...] } — one decision per candidate (ADD / UPDATE / SUPERSEDE / DELETE / NOOP). Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
