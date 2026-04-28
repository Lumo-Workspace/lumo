import { compactEvents } from '@/lib/services/session-summary/compact-events'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'
import type { MemoryCategory } from '@prisma/client'

interface BuildPromptInput {
  task: {
    title: string
    description: string | null
  }
  turnEvents: RawEvent[]
  existingMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You are a memory extraction agent for an engineering project tool.

You read one Claude Code conversation turn (tool calls + assistant final message) and decide what — if anything — should be remembered about the *task*. Memories carry forward across turns and across future sessions on the same task. Only the work-relevant signal is worth keeping; routine actions are not.

You output a JSON list of operations against the existing task-scoped memory store.

# Categories (pick exactly one per ADD/UPDATE)

- TRAP — a failure mode or pitfall worth warning future-self about.
  content shape: { trigger: string, outcome: string, workaround?: string }

- DECISION — an engineering decision made in this task with a stated reason.
  content shape: { what: string, why: string }

- CONVENTION — a project-wide rule the team follows ("we use Zod for validation").
  content shape: { rule: string, scope: string }

- PROCEDURAL — a workflow / repeatable procedure ("how we run migrations").
  content shape: { workflow: string, trigger: string, steps?: string[] }

# Operations

- ADD: new memory. Provide category + content.
- UPDATE: refine an existing memory. Provide its id and a full replacement content object (same category as the existing row).
- DELETE: an existing memory was contradicted or superseded. Provide its id.
- NOOP: nothing in this turn worth recording. Output a single { type: "NOOP" } if the turn is unremarkable.

# Quality rules

- Skip routine work: \`ls\`, \`cat\`, \`Read\`, plain file edits, normal git ops, successful builds. NOT memory-worthy.
- Memorable: a tool failure with a non-obvious cause; a user instruction that establishes a rule; a decision the user explicitly justified; a non-trivial workflow; a contradiction of a prior memory.
- Be parsimonious: prefer NOOP if you're unsure. Quality > quantity. Do not invent.
- Content strings must be specific and standalone — readable cold by a future agent who never saw this turn. Avoid pronouns referring to "this turn" or "we just".
- All content string fields must be non-empty. Workarounds and step lists are optional; if you don't have one, omit the field rather than passing an empty string.
- If a turn confirms an existing memory, prefer NOOP — do not duplicate. UPDATE is for genuine refinements.`

export function buildLayer1Prompt(input: BuildPromptInput): BuiltPrompt {
  const compact = compactEvents(input.turnEvents, { maxToolCalls: 80 })

  const memoryLines = input.existingMemories.length
    ? input.existingMemories
        .map(
          m =>
            `  - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
        )
        .join('\n')
    : '  (none)'

  const examples = `# Examples

Example 1 — TRAP from a tool failure
Turn (excerpt):
  [12:00:01] Bash "npx prisma migrate dev --name add_status" ERR — stderr: P3009: enum can't add value mid-migration
Existing memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "TRAP",
      "content": {
        "trigger": "Adding a value to a Postgres enum inside the same Prisma migration that uses it",
        "outcome": "Prisma error P3009 — enum can't be altered and read in the same transaction",
        "workaround": "Split into two migrations: one adds the enum value, the next uses it"
      } } ] }

Example 2 — CONVENTION from a user instruction
Turn (excerpt):
  [turn end] "Per user: 'all new schemas need to use Zod' — applied to OrgInvite schema."
Existing memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "CONVENTION",
      "content": {
        "rule": "All new request/response schemas must be defined with Zod",
        "scope": "this project, all new schemas going forward"
      } } ] }

Example 3 — NOOP on routine work
Turn (excerpt):
  [09:30:00] Read src/app/page.tsx (120 lines)
  [09:30:02] Bash "ls components/" OK — stdout: button.tsx card.tsx ...
  [turn end] "I've reviewed the structure."
Existing memories: (none)
Output:
  { "operations": [ { "type": "NOOP" } ] }

Example 4 — UPDATE refining an existing TRAP
Turn (excerpt):
  [10:15:00] Bash "npx prisma migrate dev" ERR — stderr: P3009: ...
  [turn end] "Same enum-mid-migration trap. Tried 'prisma migrate resolve' — also fails."
Existing memories:
  - id=mem_abc category=TRAP content={"trigger":"Adding enum value mid-migration","outcome":"P3009","workaround":"Split into two migrations"}
Output:
  { "operations": [
    { "type": "UPDATE", "id": "mem_abc",
      "content": {
        "trigger": "Adding a value to a Postgres enum inside the same Prisma migration that uses it",
        "outcome": "Prisma error P3009. \`prisma migrate resolve\` does not unstick this — only a clean two-migration split works",
        "workaround": "Split into two migrations: one adds the enum value, the next uses it"
      } } ] }

Example 5 — DELETE + ADD when a memory is contradicted
Turn (excerpt):
  [turn end] "Update: per the team, drop the rule about server-actions-only — REST routes are fine for new endpoints. Going forward use REST."
Existing memories:
  - id=mem_xyz category=CONVENTION content={"rule":"New endpoints must use Server Actions, not REST","scope":"this project"}
Output:
  { "operations": [
    { "type": "DELETE", "id": "mem_xyz" },
    { "type": "ADD", "category": "CONVENTION",
      "content": {
        "rule": "New endpoints may use REST routes; Server Actions are no longer required",
        "scope": "this project, applies to all new endpoints"
      } } ] }`

  const description = input.task.description?.trim() || '(no description)'

  const userPrompt = `# Task context
Title: ${input.task.title}
Description: ${description}

# Existing task memories
${memoryLines}

# Turn (compacted Claude Code event log)
${compact.text || '(empty turn)'}

${examples}

# Your output
Return a JSON object matching the operations schema. If nothing in the turn is memory-worthy, return { "operations": [{ "type": "NOOP" }] }.`

  return { system: SYSTEM_PROMPT, user: userPrompt }
}
