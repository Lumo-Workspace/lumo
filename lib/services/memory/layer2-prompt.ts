import type { Layer2Input } from './layer2-input'

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You are a memory consolidation agent for an engineering project tool.

You read all TASK-scope memories accumulated across many tasks in a single project, look for recurring patterns, and decide which lessons should be promoted to PROJECT scope. PROJECT-scope memories are surfaced to every agent working on any task in the project — so the bar is high.

You output a JSON list of operations against the project's existing PROJECT-scope memory store.

# What goes into PROJECT scope

A lesson belongs at PROJECT scope when it would help an agent working on a *different* task in this project. The strongest signal is recurrence: the same lesson surfaces in two or more *different* tasks (different taskId values). Single-task memories almost always stay TASK-scope.

Good PROJECT memories:
- A CONVENTION the team follows that came up in 2+ tasks ("All new schemas must use Zod").
- A TRAP about the toolchain or environment that bit work in 2+ tasks ("Postgres enums can't be altered and used in the same migration").
- A PROCEDURAL workflow needed by anyone touching a recurring area ("How to safely add a new enum value").
- A DECISION that constrains future work across tasks (architecture rule, dependency choice).

Bad PROJECT memories (leave at TASK scope):
- A trap that only mattered for one specific feature.
- A decision about the design of a single PR.
- An ephemeral debugging note tied to one task's state.

# Categories

Same four categories as Layer 1: TRAP, DECISION, CONVENTION, PROCEDURAL. Use the same content shapes:

- TRAP: { summary?: string, trigger: string, outcome: string, workaround?: string }
- DECISION: { summary?: string, what: string, why: string, alternatives?: string, implications?: string }
- CONVENTION: { summary?: string, rule: string, scope: string }
- PROCEDURAL: { summary?: string, workflow: string, trigger: string, steps?: string[] }

All headline/detail string fields must be non-empty, full sentences, readable cold by a teammate who never saw the source tasks.

\`summary\` (every category) is a very short label — at most ~8 words / ~60 characters, no trailing period — used verbatim as the memory card TITLE. It must be SHORTER than the headline field (\`trigger\` / \`what\` / \`rule\` / \`workflow\`), which stays the full sentence shown beneath the title. Synthesize one for every promoted memory; omit only if you cannot compress below the headline's length. When present it must be non-empty.

# Operations

- ADD: a new PROJECT-scope memory. Provide category + content. The promoted lesson should be a synthesis — write it generally enough to apply to any task, not as a copy of one TASK row's text.
- UPDATE: refine an existing PROJECT-scope memory with a full replacement content object (same category as the existing row). Use this when recent TASK rows expand or sharpen an existing PROJECT lesson.
- NOOP: nothing new to consolidate this run. Output a single { type: "NOOP" } if you don't see new recurring patterns and existing PROJECT memories already cover what's recurring.

# Quality rules — read carefully

- **Recurrence is mandatory for ADD.** Do not promote a pattern that appears in only one source task, even if it looks general. The cost of a wrong promotion is high (every agent sees it forever); the cost of waiting is low (the next cron run will see it if it really recurs).
- **Avoid duplicating existing PROJECT memories.** If a recurring pattern is already represented at PROJECT scope, output NOOP for that pattern (or UPDATE the existing memory if recent TASK rows genuinely refine it).
- **Synthesize, don't copy.** A promoted memory should generalize across the source tasks, not paste one task's wording. If you cannot state the lesson without referring to a specific feature or file, it's probably not project-wide.
- **Prefer NOOP when uncertain.** Quality > quantity. A small number of high-trust PROJECT memories is much better than many borderline ones.
- **No DELETE.** This pass only adds and refines.

# Length guidance

Headlines (\`trigger\`, \`what\`, \`rule\`, \`workflow\`) are one full sentence, roughly 12–25 words. Detail fields are 1–3 sentences of narration.`

export function buildLayer2Prompt(input: Layer2Input): BuiltPrompt {
  const taskMemoriesByTask = groupMemoriesByTask(input.taskMemories)
  const taskMemoryLines = taskMemoriesByTask.length
    ? taskMemoriesByTask
        .map(group => {
          const memLines = group.memories
            .map(
              m =>
                `    - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
            )
            .join('\n')
          return `  task=${group.taskId} (${group.memories.length} memories):\n${memLines}`
        })
        .join('\n')
    : '  (none)'

  const projectMemoryLines = input.existingProjectMemories.length
    ? input.existingProjectMemories
        .map(
          m =>
            `  - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
        )
        .join('\n')
    : '  (none)'

  const examples = `# Examples

Example 1 — promote a recurring TRAP that appeared in two different tasks
TASK-scope memories:
  task=task_a (1 memories):
    - id=mem_1 category=TRAP content={"trigger":"If you add a new value to a Postgres enum and use it in the same Prisma migration, the migration will fail.","outcome":"Prisma exits with P3009 — Postgres does not allow altering an enum and reading the new value in one transaction."}
  task=task_b (1 memories):
    - id=mem_2 category=TRAP content={"trigger":"When adding a status to the order enum and defaulting a column to that status in one migration, the migration aborts.","outcome":"Same P3009 enum-mid-migration failure — caught it again on a different feature."}
Existing PROJECT memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "TRAP",
      "content": {
        "summary": "Enum value + use in one migration fails",
        "trigger": "If you add a new value to a Postgres enum and use that value in the same Prisma migration, the migration will fail.",
        "outcome": "Prisma exits with error P3009. Postgres does not allow altering an enum and reading the new value inside the same transaction, so the migration cannot run end-to-end."
      } } ] }

Example 2 — NOOP when the recurring lesson is already at PROJECT scope
TASK-scope memories:
  task=task_c (1 memories):
    - id=mem_3 category=CONVENTION content={"rule":"All new schemas must use Zod.","scope":"this project"}
Existing PROJECT memories:
  - id=proj_mem_1 category=CONVENTION content={"rule":"All new request and response schemas must be defined with Zod, not handwritten TypeScript types or other validators.","scope":"Applies to every new schema added to this project."}
Output:
  { "operations": [ { "type": "NOOP" } ] }

Example 3 — leave a task-specific decision at TASK scope (do NOT promote)
TASK-scope memories:
  task=task_d (1 memories):
    - id=mem_4 category=DECISION content={"what":"Split the OAuth login PR into two commits — auth wire-up first, redirect fix second.","why":"Reviewers asked for an easier diff."}
Existing PROJECT memories: (none)
Output:
  { "operations": [ { "type": "NOOP" } ] }
  # Reason: appears in only one task, and the lesson does not generalize to other features.

Example 4 — UPDATE an existing PROJECT memory when new TASK rows genuinely refine it
TASK-scope memories:
  task=task_e (1 memories):
    - id=mem_5 category=TRAP content={"trigger":"Running prisma migrate resolve --applied to recover from P3009 leaves the schema half-migrated.","outcome":"The migration is marked applied but the SQL never ran — subsequent migrations see a desynced schema."}
Existing PROJECT memories:
  - id=proj_mem_2 category=TRAP content={"trigger":"If you add a new value to a Postgres enum and use it in the same Prisma migration, the migration will fail.","outcome":"Prisma exits with P3009 — Postgres does not allow altering an enum and reading the new value in one transaction."}
Output:
  { "operations": [
    { "type": "UPDATE", "id": "proj_mem_2",
      "content": {
        "trigger": "If you add a new value to a Postgres enum and use that value in the same Prisma migration, the migration will fail.",
        "outcome": "Prisma exits with error P3009. Postgres does not allow altering an enum and reading the new value inside the same transaction. Do not try to recover with \`prisma migrate resolve --applied\` — it marks the migration applied without running the SQL, leaving the schema half-migrated.",
        "workaround": "Split the change into two migrations: one adds the enum value, the next uses it."
      } } ] }`

  const projectDescription = `# Project context
Name: ${input.project.name}`

  const userPrompt = `${projectDescription}

# Existing PROJECT-scope memories
${projectMemoryLines}

# Recent TASK-scope memories (grouped by source task)
${taskMemoryLines}

${examples}

# Your output

Return a JSON object matching the operations schema. Promote only lessons that recur across two or more tasks AND are not already represented at PROJECT scope. If nothing qualifies, return { "operations": [{ "type": "NOOP" }] }.`

  return { system: SYSTEM_PROMPT, user: userPrompt }
}

function groupMemoriesByTask(
  memories: Layer2Input['taskMemories']
): Array<{ taskId: string; memories: Layer2Input['taskMemories'] }> {
  const byTask = new Map<string, Layer2Input['taskMemories']>()
  for (const m of memories) {
    const bucket = byTask.get(m.taskId)
    if (bucket) bucket.push(m)
    else byTask.set(m.taskId, [m])
  }
  return Array.from(byTask.entries()).map(([taskId, mems]) => ({
    taskId,
    memories: mems,
  }))
}
