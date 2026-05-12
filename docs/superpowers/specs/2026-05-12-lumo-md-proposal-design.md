# LUMO.md Proposal System Design

## Overview

Layer 2 of Lumo's memory system: given a task's memories, an LLM generates structured proposals to update a project-level `LUMO.md` knowledge file. This file is `@import`-ed by `CLAUDE.md` so that AI coding agents automatically receive project-learned context.

Day 1 delivers the LLM prompt + service skeleton (generate proposals, no file writes).
Day 2 delivers file writing (apply proposals to LUMO.md) + first-time onboarding flow.

## Decisions Made

| Question              | Answer                                                      |
| --------------------- | ----------------------------------------------------------- |
| Content source        | Pure task memory aggregation (Memory model only)            |
| Trigger granularity   | Per-task — one task's memories per proposal                 |
| Persistence           | New `LumoProposal` Prisma model with status tracking        |
| Operation granularity | Bullet-level — each operation targets a single bullet point |
| File format           | Pure Markdown with HTML comment source annotations          |
| LLM strategy          | Single `generateObject()` call with Zod schema output       |
| Prompt language       | English prompts, output content follows project language    |

## Data Model

### LumoProposal (new Prisma model)

```prisma
model LumoProposal {
  id              String              @id @default(cuid())
  projectId       String
  taskId          String
  status          LumoProposalStatus  @default(PENDING)
  operations      Json                // ProposalOperation[]
  lumoMdSnapshot  String?             @db.Text
  summary         String?             // one-line summary from LLM
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
  appliedAt       DateTime?

  project         Project             @relation(fields: [projectId], references: [id], onDelete: Cascade)
  task            Task                @relation(fields: [taskId], references: [id], onDelete: Cascade)
}

enum LumoProposalStatus {
  PENDING
  APPLIED
  REJECTED
  SUPERSEDED
}
```

Relations to add: `Task.lumoProposals LumoProposal[]`, `Project.lumoProposals LumoProposal[]`.

### ProposalOperation (JSON schema, stored in `operations` field)

```typescript
type ProposalOperation =
  | {
      type: 'add'
      section: string // e.g. "Traps", "Conventions"
      content: string // the bullet text
      rationale: string // why this should be added
      sourceTaskId: string // the task ID this came from
    }
  | {
      type: 'modify'
      section: string
      oldContent: string // existing bullet text to find
      newContent: string // replacement text
      rationale: string
      sourceTaskId: string
    }
  | {
      type: 'supersede'
      section: string
      content: string // existing bullet text to remove
      rationale: string
      sourceTaskId: string
    }
```

## LLM Prompt Design

### Inputs to LLM

1. **Task context** — title, description, status
2. **Task memories** — all Memory records for this task (category + content JSON)
3. **Current LUMO.md** — full file content (empty string if not yet created)

### System Prompt (English)

Role: You maintain a project-level knowledge document (LUMO.md) that provides context to AI coding agents.

Key instructions:

- LUMO.md is organized by sections (`## Traps`, `## Decisions`, `## Conventions`, `## Procedures`), each containing bullet points
- Output structured operations (add/modify/supersede), not raw file content
- Judgment criteria:
  - Does this memory have project-level value? (one-off fixes don't belong; recurring traps do)
  - Does LUMO.md already have a similar entry? If so, modify or skip to avoid duplication
  - Does new experience contradict an existing entry? If so, supersede it
- Each bullet should be concise (1-2 sentences), stating what + why
- Every operation must include a rationale
- If nothing worth updating, return empty operations array

### Output Schema (Zod)

```typescript
const ProposalOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add'),
    section: z.string(),
    content: z.string(),
    rationale: z.string(),
    sourceTaskId: z.string(),
  }),
  z.object({
    type: z.literal('modify'),
    section: z.string(),
    oldContent: z.string(),
    newContent: z.string(),
    rationale: z.string(),
    sourceTaskId: z.string(),
  }),
  z.object({
    type: z.literal('supersede'),
    section: z.string(),
    content: z.string(),
    rationale: z.string(),
    sourceTaskId: z.string(),
  }),
])

const LumoProposalOutputSchema = z.object({
  operations: z.array(ProposalOperationSchema),
  summary: z.string(),
})
```

### LLM Call

```typescript
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

const { object } = await generateObject({
  model: gateway('anthropic/claude-sonnet-4.5'),
  schema: LumoProposalOutputSchema,
  system: LUMO_PROPOSAL_SYSTEM_PROMPT,
  prompt: buildUserPrompt(task, memories, currentLumoMd),
})
```

## Service Layer

### File Structure

```
lib/
  services/
    lumo-proposal/
      lumo-proposal.service.ts    # business orchestration
      lumo-proposal.prompt.ts     # system prompt + prompt builder
  repositories/
    lumo-proposal.repository.ts   # LumoProposal CRUD
  validation/
    lumo-proposal.schema.ts       # Zod schemas
```

### Service Interface

```typescript
// lumo-proposal.service.ts
export const lumoProposalService = {
  // Day 1: generate proposal from task memories
  async generateProposal(
    taskId: string,
    currentLumoMd: string  // Day 1: passed in; Day 2+: read from file
  ): Promise<LumoProposal>,

  // Day 2: apply proposal operations to LUMO.md file
  async applyProposal(
    proposalId: string,
    lumoMdPath: string
  ): Promise<{ newContent: string; warnings: string[] }>,
}
```

### Repository

```typescript
// lumo-proposal.repository.ts
export const lumoProposalRepository = {
  async create(input: CreateLumoProposalInput): Promise<{ id: string }>,
  async findById(id: string): Promise<LumoProposal | null>,
  async findByTaskId(taskId: string): Promise<LumoProposal[]>,
  async updateStatus(id: string, status: LumoProposalStatus, appliedAt?: Date): Promise<void>,
}
```

## Proposal Apply Logic (Day 2)

### Strategy

Line-based string operations on LUMO.md (no Markdown AST parser):

1. Split by lines, identify `## heading` lines to locate sections
2. Each section spans from its heading to the next heading (or EOF)

### Operation Application

- **add**: Find `## {section}` heading, insert `- {content} <!-- from: LUM-{number} -->` after the last bullet in that section. If section doesn't exist, create it at end of file.
- **modify**: Find the line containing `oldContent` in the target section, replace with `newContent` (update `<!-- from: -->` annotation).
- **supersede**: Find the line containing `content` in the target section, delete the line.

### Edge Cases

- `modify` can't find `oldContent` → skip, add warning to result
- Section doesn't exist → auto-create (for `add` operations)
- File doesn't exist → run onboarding first

## Onboarding Flow (Day 2)

### Check Status

```typescript
checkOnboardingStatus(repoPath: string): {
  lumoMdExists: boolean
  claudeMdImported: boolean
  agentsMdExists: boolean
  agentsMdImported: boolean
}
```

Checks:

1. `{repoPath}/LUMO.md` exists?
2. `{repoPath}/CLAUDE.md` exists and contains `@import LUMO.md`?
3. `{repoPath}/AGENTS.md` exists and contains `@import LUMO.md`?

### User Choice (UI dialog)

If LUMO.md doesn't exist or isn't imported, prompt user:

- Add `@import LUMO.md` to CLAUDE.md
- Add `@import LUMO.md` to AGENTS.md
- Both

### Execute Onboarding

```typescript
performOnboarding(
  repoPath: string,
  targets: ('CLAUDE.md' | 'AGENTS.md')[]
): { created: string[]; modified: string[]; skipped: string[] }
```

1. If LUMO.md doesn't exist → create with initial template
2. For each target file:
   - Doesn't exist → create with `@import LUMO.md`
   - Exists without import → append `@import LUMO.md`
   - Already has import → skip
3. Return summary of changes

### Initial LUMO.md Template

```markdown
# LUMO.md

<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
```

## UI (Day 2, minimal)

- "Sync to LUMO.md" button in project settings or task detail page
- On click: check onboarding status → if needed, show dialog for import target selection → run onboarding → apply proposal → show result summary
- No PR integration yet (Day 3-4)

## Testing Strategy

### Day 1

**Script test** (`scripts/test-lumo-proposal.ts`):

- Read a real task's memories from DB, pass mock LUMO.md content, call `generateProposal`, print result
- Verify: operations conform to schema, rationale is meaningful, no duplicates

**Unit tests**:

- `lumo-proposal.prompt.ts` — prompt builder output format, task/memory info correctly included
- `lumo-proposal.repository.ts` — CRUD operations (mock Prisma)

**Not tested**: LLM output quality (prompt iteration concern, not automation)

### Day 2

**Unit tests**:

- `applyProposal` line operations:
  - Add to existing section
  - Add to non-existent section (auto-create)
  - Modify — successful replacement
  - Modify — oldContent not found → skip + warning
  - Supersede — line deletion
- `lumo-onboarding.service.ts` — check logic and file creation (temp directory)

**Script test** (`scripts/test-lumo-apply.ts`):

- End-to-end: generateProposal → applyProposal → print diff

## Out of Scope

- GitHub PR creation (Day 3-4)
- Automatic trigger on task completion (future)
- Multi-repo support (future)
- Conflict resolution between concurrent proposals (future)
- UI for reviewing/editing individual operations (future)
