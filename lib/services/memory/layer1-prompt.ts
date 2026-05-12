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

# Writing style — read this first

Write for a teammate who joins the project tomorrow and never saw this conversation. They should understand each memory in 5 seconds without opening the codebase.

- Use plain, complete sentences. No jargon-headlines, no log-style noun phrases.
- BAD: "Session.taskId vs payload.task_id divergence mid-session"
- GOOD: "If you read the task ID from the Session row, you'll get the wrong task when the user switched tasks mid-session."
- Always answer "what would actually happen to me?" — describe the situation, not just the symptom name.
- Spell out acronyms and identifiers on first use. \`Session.taskId\` is fine; \`P3009\` should appear with a one-line explanation of what it means.
- Detail fields should narrate: *what happens → why it's a problem → what to do instead*. Don't just restate the headline with more words.

# Categories (pick exactly one per ADD/UPDATE)

- TRAP — a failure mode or pitfall worth warning future-self about. A TRAP describes the PROBLEM ONLY — what goes wrong and why. It must NOT include the solution. If you also know the fix, emit a separate PROCEDURAL memory for the workaround.
  content shape: { trigger: string, outcome: string }
  - \`trigger\`: a full sentence describing the situation that causes the problem ("When you ...").
  - \`outcome\`: what goes wrong, in plain terms. Include the error name/code if any, but explain it.

- DECISION — an engineering decision made in this task. Treat it as a mini-ADR: a future reader must be able to understand the *forces* that drove the choice, what was rejected, and what the team is now committed to. A decision without these is just a changelog entry.
  content shape: { what: string, why: string, alternatives?: string, implications?: string }
  - \`what\`: a full sentence stating the decision ("We chose to ..."). State the PRINCIPLE, not the specific identifier. BAD: "API endpoints use POST /api/tasks/[id]/lumo-proposals". GOOD: "The sync workflow uses a two-call API to decouple generation from application." If you can only state a decision by quoting a function name, endpoint path, or variable name, it is too low-level — skip it.
  - \`why\`: the *forces* that drove the decision — the problem, constraint, or tension that demanded a choice. NOT a recap of what was implemented or how. Ask: "what was the situation that made this decision necessary?" If the user / turn does not state real driving forces, omit the DECISION (NOOP) instead of inventing them.
  - \`alternatives\` (optional but strongly preferred): the other option(s) seriously considered and why each was rejected. Without this, future readers re-litigate the choice. Omit only if no alternative was actually weighed.
  - \`implications\` (optional but strongly preferred): what this decision commits the team to going forward — capabilities given up, future constraints introduced, follow-up work needed. Omit only if there are genuinely no notable consequences.

- CONVENTION — a project-wide rule the team follows.
  content shape: { rule: string, scope: string }
  - \`rule\`: a full sentence stating the rule ("All new ... must ...").
  - \`scope\`: where it applies and any exceptions.

- PROCEDURAL — a workflow / repeatable procedure.
  content shape: { workflow: string, trigger: string, steps?: string[] }
  - \`workflow\`: a short sentence naming what the procedure accomplishes ("How to run a database migration").
  - \`trigger\`: a full sentence describing when to use it ("Whenever you ...").
  - \`steps\`: ordered, plain-English steps a teammate can follow.

# Operations

- ADD: new memory. Provide category + content.
- UPDATE: refine an existing memory. Provide its id and a full replacement content object (same category as the existing row).
- DELETE: an existing memory was contradicted or superseded. Provide its id.
- NOOP: nothing in this turn worth recording. Output a single { type: "NOOP" } if the turn is unremarkable.

# Quality rules

- Skip routine work: \`ls\`, \`cat\`, \`Read\`, plain file edits, normal git ops, successful builds. NOT memory-worthy.
- Memorable: a tool failure with a non-obvious cause; a user instruction that establishes a rule; a decision the user explicitly justified; a non-trivial workflow; a contradiction of a prior memory.
- Be parsimonious: prefer NOOP if you're unsure. Quality > quantity. Do not invent.
- Self-check before every ADD: "Could a developer learn this by reading the current source code, git log, or existing docs?" If yes, it is NOT memory-worthy — skip it. Memories exist for knowledge that is invisible in the codebase: the *why* behind a choice, the gotcha that only surfaces at runtime, the rule that exists in people's heads but not in code.
- Each field must be specific and standalone — readable cold by a future agent who never saw this turn. Avoid "this turn", "we just", "the above".
- All content string fields must be non-empty. \`workaround\` and \`steps\` are optional; if you don't have one, omit the field rather than passing an empty string.
- If a turn confirms an existing memory, prefer NOOP — do not duplicate. UPDATE is for genuine refinements.

# Length guidance

Headlines (\`trigger\`, \`what\`, \`rule\`, \`workflow\`) are one full sentence, roughly 12–25 words. They should be readable on their own.

Detail fields (\`outcome\`, \`why\`, \`scope\`, \`steps\`, \`workaround\`) are 1–3 sentences of narration. File paths, line numbers, error codes belong here.

Avoid: noun-phrase fragments, "X vs Y" headlines, semicolon-chains, "(parenthetical)" cramming. If your headline reads like a log line or a slide title, rewrite it as a sentence.`

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

Example 1 — TRAP from a tool failure (problem only, workaround goes to PROCEDURAL)
Turn (excerpt):
  [12:00:01] Bash "npx prisma migrate dev --name add_status" ERR — stderr: P3009: enum can't add value mid-migration
Existing memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "TRAP",
      "content": {
        "trigger": "If you add a new value to a Postgres enum and use that value in the same Prisma migration, the migration will fail.",
        "outcome": "Prisma exits with error P3009. Postgres does not allow altering an enum and reading the new value inside the same transaction, so the migration cannot run end-to-end."
      } },
    { "type": "ADD", "category": "PROCEDURAL",
      "content": {
        "workflow": "How to safely add a new Postgres enum value in Prisma",
        "trigger": "Whenever you need to add a value to an existing enum and use it in the same change.",
        "steps": ["Create a first migration that only adds the new enum value.", "Create a second migration that uses the value (e.g. sets it as a column default or backfills rows)."]
      } } ] }

Example 2 — CONVENTION from a user instruction
Turn (excerpt):
  [turn end] "Per user: 'all new schemas need to use Zod' — applied to OrgInvite schema."
Existing memories: (none)
Output:
  { "operations": [
    { "type": "ADD", "category": "CONVENTION",
      "content": {
        "rule": "All new request and response schemas must be defined with Zod, not handwritten TypeScript types or other validators.",
        "scope": "Applies to every new schema added to this project from now on. Existing schemas can be migrated opportunistically but are not required to change immediately."
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
  - id=mem_abc category=TRAP content={"trigger":"If you add a new value to a Postgres enum and use that value in the same Prisma migration, the migration will fail.","outcome":"Prisma exits with error P3009..."}
Output:
  { "operations": [
    { "type": "UPDATE", "id": "mem_abc",
      "content": {
        "trigger": "If you add a new value to a Postgres enum and use that value in the same Prisma migration, the migration will fail.",
        "outcome": "Prisma exits with error P3009. Running \`prisma migrate resolve\` does NOT unstick the migration — it only marks it applied without actually running it, so the schema ends up half-migrated. Do not try to recover with \`migrate resolve\`."
      } } ] }

Example 5 — Plain-language headline (contrastive)
Turn (excerpt):
  [turn end] "Hit it again: Session.taskId is immutable per first-event-wins in session.repository.ts, but hook payload.task_id reflects ~/.lumo/current-task.json live. Use payload.task_id at query time."
Existing memories: (none)

BAD output (headline is a noun-phrase log line; detail is too terse to be useful):
  { "type": "ADD", "category": "TRAP",
    "content": {
      "trigger": "Session.taskId vs payload.task_id divergence mid-session",
      "outcome": "Data inconsistency between recorded and actual task"
    } }

GOOD output (headline is a full sentence; detail explains what happens and why):
  { "operations": [
    { "type": "ADD", "category": "TRAP",
      "content": {
        "trigger": "If you read the current task ID from the Session row while the user switches tasks mid-session, you will get the wrong task.",
        "outcome": "Session.taskId is set once on the first event (first-event-wins, see session.repository.ts) and never updated. But each hook payload's task_id reflects the live ~/.lumo/current-task.json. Code that trusts Session.taskId will silently route later events to the original task instead of the user's current one."
      } } ] }

Example 6 — DELETE + ADD when a memory is contradicted
Turn (excerpt):
  [turn end] "Update: per the team, drop the rule about server-actions-only — REST routes are fine for new endpoints. Going forward use REST."
Existing memories:
  - id=mem_xyz category=CONVENTION content={"rule":"New endpoints must use Server Actions, not REST","scope":"this project"}
Output:
  { "operations": [
    { "type": "DELETE", "id": "mem_xyz" },
    { "type": "ADD", "category": "CONVENTION",
      "content": {
        "rule": "New endpoints may be implemented as REST routes. The earlier rule requiring Server Actions has been dropped.",
        "scope": "Applies to all new endpoints in this project. Existing Server Action endpoints can stay; there is no requirement to migrate them."
      } } ] }

Example 7 — DECISION done right (contrastive)
Turn (excerpt):
  [turn end] "Decided: switch task memory writes from soft-delete (archivedAt column) to hard-delete. Originally we picked soft-delete to preserve audit history, but in practice no UI or query ever consumed archived rows — they only forced every read to filter \`archivedAt: null\`, which we forgot in two places and leaked stale rows. Considered keeping soft-delete behind a read helper, but the maintenance cost was the actual problem, not the filter syntax. Going forward L1 DELETE is irreversible, and if audit becomes important we'll need a separate event log."

BAD output (\`why\` recaps the implementation; no alternatives, no implications):
  { "type": "ADD", "category": "DECISION",
    "content": {
      "what": "Removed the archivedAt column and converted archive operations to hard deletes",
      "why": "Schema, repository, and service layers were all updated. archive() was renamed to delete() and archivedAt: null filters were removed everywhere."
    } }

GOOD output (\`why\` describes the forces; alternatives names what was rejected and why; implications spells out the new constraint):
  { "operations": [
    { "type": "ADD", "category": "DECISION",
      "content": {
        "what": "Switched task memory writes from soft-delete (archivedAt) to hard-delete.",
        "why": "Soft-delete was originally chosen to preserve audit history, but no UI or query consumed archived rows. The cost was real: every read needed an archivedAt: null filter, and we missed it in two places, leaking stale memories.",
        "alternatives": "Considered keeping soft-delete behind a shared read helper that always applies the filter. Rejected because the maintenance burden is the actual problem — wrapping every query site doesn't make the schema simpler, only adds another abstraction to remember.",
        "implications": "Layer 1 DELETE is now irreversible — we lose the ability to inspect what was retracted and when. If audit visibility becomes important, the team will need to add a separate event log table; the soft-delete column is no longer available as a fallback."
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
