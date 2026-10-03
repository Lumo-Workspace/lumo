import type { MemoryCategory } from '@prisma/client'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'

interface ReconcileInput {
  task: { title: string; description: string | null }
  candidates: Array<{
    category: MemoryCategory
    scope?: 'TASK' | 'PROJECT' | undefined
    content: unknown
  }>
  neighborsByCandidate: Array<
    Array<{
      id: string
      category: MemoryCategory
      content: unknown
      score: number
    }>
  >
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You reconcile newly-extracted candidate memories against the existing task memory store.

You are given a list of CANDIDATES (new facts just extracted from a coding turn). For each candidate you are shown its NEIGHBORS — the most similar existing memories already on file (with their ids). Decide, per candidate, exactly one operation. Output a flat JSON list of operations across all candidates.

# Output shape (READ THIS)
Return a JSON object \`{ "operations": [ ... ] }\`. Each element of the array MUST use the key \`"type"\` (NOT \`"operation"\`) to name the op. Concrete literal shapes — copy these key names exactly:
- ADD:       {"type":"ADD","category":"CONVENTION","scope":"TASK","content":{...}}
- UPDATE:    {"type":"UPDATE","id":"<neighbor-id>","content":{...}}
- SUPERSEDE: {"type":"SUPERSEDE","id":"<neighbor-id>","content":{...}}
- DELETE:    {"type":"DELETE","id":"<neighbor-id>"}
- NOOP:      {"type":"NOOP"}
Do NOT emit \`{"operation":...}\` — an element keyed "operation" is dropped and its write is lost.

# Operations
- ADD — the candidate is genuinely new; no neighbor already says it. Provide { type:"ADD", category, content, scope? } (keep the candidate's category/content/scope).
- UPDATE — a neighbor already covers this topic and the candidate REFINES, extends, or sharpens it (more detail, an extra condition, a corrected nuance — but the SAME underlying fact). Fold it into that neighbor: provide { type:"UPDATE", id:<neighbor-id>, content } with a full replacement content object (SAME category as that neighbor). A refinement of an existing neighbor is an UPDATE, never a fresh ADD.
- SUPERSEDE — a neighbor is now CONTRADICTED or replaced by the candidate (the old fact is wrong/outdated). Provide { type:"SUPERSEDE", id:<neighbor-id>, content } with the new content (SAME category as that neighbor). SUPERSEDE is only for same-category contradiction; if the replacement is a different category, emit DELETE on the neighbor + ADD the candidate instead.
- DELETE — a neighbor is obsolete and the candidate merely confirms it should go (rare). Provide { type:"DELETE", id:<neighbor-id> }.
- NOOP — the candidate is already fully represented by a neighbor; nothing to write. Provide { type:"NOOP" }. Emitting nothing for a candidate is equivalent — prefer NOOP explicitly when a neighbor already covers it.

# Decision rules
- A neighbor already covers this topic →
  - candidate adds NEW signal (refines/extends/sharpens the same fact) → UPDATE that neighbor. This is the common case; do NOT mistake a refinement for a brand-new fact.
  - candidate adds nothing → NOOP.
  - NEVER ADD when a neighbor already covers the topic — that creates a near-duplicate.
- Contradiction (candidate says the opposite of a neighbor) → SUPERSEDE that neighbor (same category) — do not leave both.
- No relevant neighbor at all → ADD.
- Only reference an id that appears in that candidate's neighbor list. Never invent ids.
- Content shapes per category are unchanged (TRAP/DECISION/CONVENTION/PROCEDURAL). Keep the same terse, plain-words writing style as the candidates.

${DERIVED_CONTENT_NO_CODE_RULE}`

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
Return { "operations": [...] } — one decision per candidate. Each element is keyed "type" (e.g. {"type":"UPDATE","id":"...","content":{...}} or {"type":"NOOP"}), never "operation". Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
