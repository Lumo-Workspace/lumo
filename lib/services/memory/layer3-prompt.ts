import type { MemoryCategory } from '@prisma/client'
import type { Layer2Fact } from './layer2-extract'

interface BuildPromptInput {
  distilledFacts: Layer2Fact[]
  existingProjectMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You are a project-memory merge agent.

You are given two lists:
1. Distilled facts — newly proposed for the project memory (just promoted from a task that finished).
2. Existing project memories — the active project-level facts already on file.

For each distilled fact, decide one of three operations: ADD, UPDATE, or NOOP. There is no DELETE — the merge agent never removes existing project memory; deprecation is a manual editorial act, never automated.

# Operations

- ADD: emit when the distilled fact contains genuinely new information that no existing project memory already covers. Provide category + content.

- UPDATE: emit when the distilled fact strictly REFINES an existing memory of the same category — adds detail, clarifies scope, makes a specific instance explicit — without changing the existing meaning. Provide the existing memory id and a full replacement content object. The replacement must be a strict superset of meaning: nothing the existing memory said is contradicted or weakened.

- NOOP: emit when the distilled fact is already covered, OR when it conflicts with an existing memory, OR when you are unsure. NOOP is the safe default. Conflict NEVER triggers ADD or UPDATE — it triggers NOOP, period. The team will reconcile contradictions manually.

# CONSERVATIVE BIAS — non-negotiable

- When unsure → NOOP. Project memory is shared across the whole project; a wrong UPDATE silently corrupts a fact every future agent reads.
- A "conflict" includes any disagreement of fact, scope, or recommendation between the distilled fact and an existing memory. Examples of conflict: distilled "use yup for validation" vs existing "use zod for validation"; distilled "deploy via Vercel" vs existing "deploy via Railway".
- Never dual-write. If you NOOP because of a conflict, do NOT also emit ADD for the new fact — that would create contradictory rows.
- UPDATE is rare. Use it only when the new content is unambiguously a tighter, more specific version of the existing content (same category, same direction of advice, just more detail).
- Do not invent: if the distilled fact's category does not match any existing memory's category, you cannot UPDATE — only ADD or NOOP applies.

# Output

A JSON array of operations. Each distilled fact produces exactly one operation. The output array length must equal the input distilled facts length.`

export function buildLayer3Prompt(input: BuildPromptInput): BuiltPrompt {
  const factLines = input.distilledFacts
    .map(
      (f, i) =>
        `  [${i}] category=${f.category} content=${JSON.stringify(f.content)}`
    )
    .join('\n')

  const existingLines = input.existingProjectMemories.length
    ? input.existingProjectMemories
        .map(
          m =>
            `  - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
        )
        .join('\n')
    : '  (none)'

  const examples = `# Examples

Example 1 — ADD when no overlap
Distilled facts:
  [0] category=CONVENTION content={"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas"}
Existing project memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "CONVENTION",
      "content": {"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas"} } ] }

Example 2 — NOOP when already covered
Distilled facts:
  [0] category=CONVENTION content={"rule":"Use Zod for request schemas","scope":"all API endpoints"}
Existing project memories:
  - id=mem_a category=CONVENTION content={"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas"}
Output:
  { "operations": [ { "type": "NOOP" } ] }

Example 3 — NOOP on conflict (NEVER auto-overwrite)
Distilled facts:
  [0] category=CONVENTION content={"rule":"Use yup for request schemas","scope":"all API endpoints"}
Existing project memories:
  - id=mem_a category=CONVENTION content={"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas"}
Output:
  { "operations": [ { "type": "NOOP" } ] }
(The distilled fact contradicts mem_a — emit NOOP. Do NOT also emit ADD: that would create a contradictory pair of project rules.)

Example 4 — UPDATE that strictly refines (rare, only when meaning is preserved)
Distilled facts:
  [0] category=TRAP content={"trigger":"Adding a value to a Postgres enum inside the same Prisma migration that uses it","outcome":"Prisma error P3009 — and 'prisma migrate resolve' does not unstick this","workaround":"Split into two migrations: one adds the value, the next uses it"}
Existing project memories:
  - id=mem_b category=TRAP content={"trigger":"Adding a value to a Postgres enum inside the same Prisma migration that uses it","outcome":"Prisma error P3009","workaround":"Split into two migrations"}
Output:
  { "operations": [
    { "type": "UPDATE", "id": "mem_b",
      "content": {"trigger":"Adding a value to a Postgres enum inside the same Prisma migration that uses it","outcome":"Prisma error P3009 — and 'prisma migrate resolve' does not unstick this","workaround":"Split into two migrations: one adds the value, the next uses it"} } ] }
(Same category, same trigger, same direction; new content adds the 'prisma migrate resolve' detail without changing prior meaning.)

Example 5 — multiple facts, mixed ops
Distilled facts:
  [0] category=CONVENTION content={"rule":"All new schemas use Zod","scope":"all API endpoints"}
  [1] category=PROCEDURAL content={"workflow":"Provision a Neon dev branch","trigger":"new developer onboarding","steps":["scripts/neon-create-branch.sh","copy DATABASE_URL"]}
Existing project memories:
  - id=mem_a category=CONVENTION content={"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas"}
Output:
  { "operations": [
    { "type": "NOOP" },
    { "type": "ADD", "category": "PROCEDURAL",
      "content": {"workflow":"Provision a Neon dev branch","trigger":"new developer onboarding","steps":["scripts/neon-create-branch.sh","copy DATABASE_URL"]} } ] }`

  const userPrompt = `# Distilled facts (in order)
${factLines || '  (none)'}

# Existing project memories
${existingLines}

${examples}

# Your output
Return a JSON object { "operations": [ ... ] } with exactly one operation per distilled fact, in the same order. When unsure, NOOP.`

  return { system: SYSTEM_PROMPT, user: userPrompt }
}
