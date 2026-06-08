import type { MemoryCategory } from '@prisma/client'

interface ReconcileInput {
  project: { id: string; name: string }
  candidates: Array<{ category: MemoryCategory; content: unknown; sourceMemoryIds?: string[] | undefined }>
  neighborsByCandidate: Array<
    Array<{ id: string; category: MemoryCategory; content: unknown; score: number }>
  >
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You reconcile candidate PROJECT-scope lessons against the existing PROJECT memory store.

You are given CANDIDATES (recurring lessons proposed for promotion to project scope). For each candidate you see its NEIGHBORS — the most similar existing PROJECT memories (with ids). Decide one operation per candidate. Output a flat JSON list of operations.

# Operations
- ADD — genuinely new project lesson; no neighbor covers it. Provide { category, content, sourceMemoryIds? } (keep the candidate's sourceMemoryIds — they record which task memories it came from).
- UPDATE — a neighbor says almost the same thing; refine it. Provide the neighbor's id + replacement content (SAME category). Never ADD a near-duplicate.
- SUPERSEDE — a neighbor is contradicted/outdated; replace it. Provide the neighbor's id + new content (SAME category). Same-category only.
- NOOP — already represented by a neighbor; nothing to write.

There is NO DELETE at this layer — retraction is a user action, not consolidation.

# Decision rules
- Near-duplicate → UPDATE (if it adds signal) or NOOP. Never a second ADD.
- Contradiction → SUPERSEDE that neighbor.
- No relevant neighbor → ADD.
- Only reference ids shown in that candidate's neighbor list. Never invent ids.`

export function buildLayer2ReconcilePrompt(input: ReconcileInput): BuiltPrompt {
  const blocks = input.candidates.map((c, i) => {
    const neighbors = input.neighborsByCandidate[i] ?? []
    const neighborLines = neighbors.length
      ? neighbors.map(n => `    - id=${n.id} category=${n.category} content=${JSON.stringify(n.content)}`).join('\n')
      : '    (no similar existing PROJECT memories)'
    const src = c.sourceMemoryIds?.length ? ` sourceMemoryIds=${JSON.stringify(c.sourceMemoryIds)}` : ''
    return `Candidate #${i} category=${c.category}${src}
  content=${JSON.stringify(c.content)}
  Neighbors:
${neighborLines}`
  })

  const user = `# Project: ${input.project.name}

# Candidates and their neighbors
${blocks.join('\n\n') || '(no candidates)'}

# Your output
Return { "operations": [...] } — one decision per candidate (ADD / UPDATE / SUPERSEDE / NOOP). Reference only neighbor ids shown above.`

  return { system: SYSTEM_PROMPT, user }
}
