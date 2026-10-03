import type { MemoryCategory } from '@prisma/client'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'

interface ReconcileInput {
  project: { id: string; name: string }
  candidates: Array<{
    category: MemoryCategory
    content: unknown
    sourceMemoryIds?: string[] | undefined
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

const SYSTEM_PROMPT = `You reconcile candidate PROJECT-scope lessons against the existing PROJECT memory store.

You are given CANDIDATES (recurring lessons proposed for promotion to project scope). For each candidate you see its NEIGHBORS — the most similar existing PROJECT memories (with ids). Decide one operation per candidate. Output a flat JSON list of operations.

# Output shape (READ THIS)
Return a JSON object \`{ "operations": [ ... ] }\`. Each element of the array MUST use the key \`"type"\` (NOT \`"operation"\`) to name the op. Concrete literal shapes — copy these key names exactly:
- ADD:       {"type":"ADD","category":"CONVENTION","content":{...}}
- UPDATE:    {"type":"UPDATE","id":"<neighbor-id>","content":{...}}
- SUPERSEDE: {"type":"SUPERSEDE","id":"<neighbor-id>","content":{...}}
- NOOP:      {"type":"NOOP"}
Do NOT emit \`{"operation":...}\` — an element keyed "operation" is dropped and its write is lost.

# Operations
- ADD — genuinely new project lesson; no neighbor covers it. Provide { type:"ADD", category, content, sourceMemoryIds? } (keep the candidate's sourceMemoryIds — they record which task memories it came from).
- UPDATE — a neighbor already covers this topic and the candidate REFINES, extends, or sharpens it (same underlying lesson, more detail or a corrected nuance). Fold it into that neighbor: provide { type:"UPDATE", id:<neighbor-id>, content } (SAME category). A refinement of an existing neighbor is an UPDATE, never a fresh ADD.
- SUPERSEDE — a neighbor is contradicted/outdated; replace it. Provide { type:"SUPERSEDE", id:<neighbor-id>, content } (SAME category). Same-category only.
- NOOP — already represented by a neighbor; nothing to write. Provide { type:"NOOP" }.

There is NO DELETE at this layer — retraction is a user action, not consolidation.

# Decision rules
- A neighbor already covers this topic →
  - candidate adds NEW signal (refines/extends the same lesson) → UPDATE that neighbor. Do NOT mistake a refinement for a brand-new lesson.
  - candidate adds nothing → NOOP.
  - NEVER a second ADD when a neighbor already covers it.
- Contradiction → SUPERSEDE that neighbor.
- No relevant neighbor at all → ADD.
- Only reference ids shown in that candidate's neighbor list. Never invent ids.

${DERIVED_CONTENT_NO_CODE_RULE}`

export function buildLayer2ReconcilePrompt(input: ReconcileInput): BuiltPrompt {
  const blocks = input.candidates.map((c, i) => {
    const neighbors = input.neighborsByCandidate[i] ?? []
    const neighborLines = neighbors.length
      ? neighbors
          .map(
            n =>
              `    - id=${n.id} category=${n.category} content=${JSON.stringify(n.content)}`
          )
          .join('\n')
      : '    (no similar existing PROJECT memories)'
    const src = c.sourceMemoryIds?.length
      ? ` sourceMemoryIds=${JSON.stringify(c.sourceMemoryIds)}`
      : ''
    return `Candidate #${i} category=${c.category}${src}
  content=${JSON.stringify(c.content)}
  Neighbors:
${neighborLines}`
  })

  const user = `# Project: ${input.project.name}

# Candidates and their neighbors
${blocks.join('\n\n') || '(no candidates)'}

# Your output
Return { "operations": [...] } — one decision per candidate. Each element is keyed "type" (e.g. {"type":"UPDATE","id":"...","content":{...}} or {"type":"NOOP"}), never "operation". Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
