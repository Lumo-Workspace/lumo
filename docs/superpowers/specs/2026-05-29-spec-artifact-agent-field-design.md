# Spec Artifact `agent` Field — Design

**Date:** 2026-05-29
**Status:** Approved (design)

## Summary

Add a new **`agent`** field to `TaskArtifact`, orthogonal to the existing
`source` field. `source` records the **spec-generation framework**
(Superpowers / Spec Kit / BMad …, free-form string). `agent` records the
**coding tool that ran the framework** (Claude Code / Codex / Cursor …), as a
**required Prisma enum**.

In the task-detail "规格" (spec) layer, each artifact row gains an **agent
badge** (small circular two-letter avatar in the tool's brand color + label).
The group header shows a per-agent summary: a single agent when all artifacts
share one, or stacked avatars + "跨 agent" when they differ.

## Concept: `source` vs `agent`

| Field    | Meaning                           | Type                 | Example values                    |
| -------- | --------------------------------- | -------------------- | --------------------------------- |
| `source` | spec-generation **framework**     | free string (exists) | `Superpowers`, `Spec Kit`, `BMad` |
| `agent`  | **coding tool** running framework | enum (new, required) | `CLAUDE_CODE`, `CODEX`, `CURSOR`  |

The mockup header "跨 agent · Superpowers · 4 个产物" captures both: `source`
is still Superpowers; the `agent` dimension spans Claude Code + Codex.

## Enum values (6 mainstream tools)

| enum             | label          | initials | brand color (tweakable) | CLI token (case-insensitive)       |
| ---------------- | -------------- | -------- | ----------------------- | ---------------------------------- |
| `CLAUDE_CODE`    | Claude Code    | CC       | clay `#D97757`          | `claude-code`                      |
| `CODEX`          | Codex          | Cx       | blue `#2563EB`          | `codex`                            |
| `CURSOR`         | Cursor         | Cu       | slate `#475569`         | `cursor`                           |
| `GEMINI_CLI`     | Gemini CLI     | Gm       | violet `#7C3AED`        | `gemini-cli` (alias `gemini`)      |
| `GITHUB_COPILOT` | GitHub Copilot | Co       | dark `#1F2937`          | `github-copilot` (alias `copilot`) |
| `WINDSURF`       | Windsurf       | Ws       | teal `#0D9488`          | `windsurf`                         |

The enum is extensible later; adding a value means a new badge color + 16
locale labels + tests. No `OTHER` fallback for now.

## Decisions

- **Required**, consistent with `source` (made required in LUM-113).
- **Migration backfill**: new column declared `NOT NULL DEFAULT 'CLAUDE_CODE'`,
  so existing rows are backfilled to `CLAUDE_CODE` in a single migration step.
  Dev: `prisma migrate dev`. Prod: CI `prisma migrate deploy` (call out in PR
  description — non-destructive, default-backfill).
- **CLI `--agent`**: required on `artifact add`, optional on `artifact update`.
  Input normalized (lowercase, spaces→hyphens) and mapped to the enum; invalid
  values error before any network call, listing valid tokens.

## Changes by layer

Data flow: `Component → API Client → API Route → Service → Repository → Prisma`.

### 1. Prisma (`prisma/schema.prisma`)

```prisma
enum TaskArtifactAgent {
  CLAUDE_CODE
  CODEX
  CURSOR
  GEMINI_CLI
  GITHUB_COPILOT
  WINDSURF
}

model TaskArtifact {
  // …
  agent TaskArtifactAgent @default(CLAUDE_CODE)
}
```

Migration SQL: create enum type, `ALTER TABLE task_artifacts ADD COLUMN agent
… NOT NULL DEFAULT 'CLAUDE_CODE'`.

### 2. Validation (`lib/validation/task-artifact.ts`)

- `createArtifactBodySchema`: add `agent: z.nativeEnum(TaskArtifactAgent)` (required).
- `updateArtifactBodySchema`: add `agent: z.nativeEnum(TaskArtifactAgent)` to
  the partial object; it counts toward the "at least one field" refine.

### 3. Repository (`lib/repositories/task-artifact.repository.ts`)

- `CreateTaskArtifactInput`: add `agent: TaskArtifactAgent`.
- `UpdateTaskArtifactInput`: add `agent?: TaskArtifactAgent`.
- `create` passes `agent`; `updateById` adds `agent` to the patch when present.

### 4. Service (`lib/services/task-artifact.service.ts`)

- `AddArtifactInput`: add `agent: TaskArtifactAgent`.
- `UpdateArtifactInput`: add `agent?: TaskArtifactAgent`.
- `addArtifact` / `updateArtifact` pass it through.

### 5. API routes (`app/api/tasks/[id]/artifacts/…`)

- POST `route.ts`: pass `agent: parsed.data.agent` into `addArtifact`.
- PATCH `[artifactId]/route.ts`: already forwards `parsed.data` — no change once
  the schema includes `agent`.

### 6. API client (`lib/api-client/task-artifacts.ts`)

- `CreateArtifactPayload`: add `agent: TaskArtifactAgent`. (Update payload type
  gains optional `agent` too.)

### 7. UI

- **New** `AgentBadge` component (small circular two-letter avatar + brand color
  - label). Single source of truth for enum → {label, initials, color}; reused
    by row badges and header stack.
- `SpecArtifactGroup.tsx`:
  - Props `Pick` adds `'agent'`.
  - Each row renders `<AgentBadge agent={a.agent} />` on the right (mockup style).
  - Header: dedupe agents — show the single agent, or stacked avatars + "跨
    agent" when >1 distinct. Existing `source` summary text stays.
  - `ManualAddForm`: add an agent selector (the 6 options, default
    `CLAUDE_CODE`); include `agent` in the create payload (currently hardcodes
    `source: 'manual'`).
- Task context injection (`lib/services/task-context.service.ts`,
  `renderArtifactSection`): include the agent label in the artifact heading,
  e.g. `## [spec] Title · Claude Code`. Update the artifact type to carry `agent`.

### 8. CLI (`cli/src/commands/`)

- `task-artifact-add.ts`: add `--agent <value>` (**required**). Normalize +
  validate against the token table; error listing valid tokens if missing/invalid.
- `task-artifact-update.ts`: add `--agent <value>` (optional), same normalization.
- `task-artifact-list.ts`: add an agent column to the row output.
- `task-artifact-show.ts`: add an `Agent:` line to the header.
- **`.claude/skills/lumo/SKILL.md`**: update the artifact command docs (flags,
  required `--agent`, valid tokens) — mandated by CLAUDE.md CLI-sync rule.

### 9. i18n (`lib/i18n/`, all 16 locales)

Add: `taskArtifact.agent.CLAUDE_CODE` / `CODEX` / `CURSOR` / `GEMINI_CLI` /
`GITHUB_COPILOT` / `WINDSURF`, `taskArtifact.selectAgent`,
`taskArtifact.crossAgent` ("跨 agent"). Real translations per language — no
English fallback for non-English locales.

### 10. Tests (`__tests__/`)

- repository: create/update writes & reads `agent`.
- service: passthrough + default.
- validation: required on create, enum rejection of bad values, optional on update.
- API: POST with `agent`, 400 when missing/invalid.
- CLI: `add` requires `--agent`; token normalization (`claude-code`, `gemini`,
  `copilot`); invalid token error; `update --agent`.

## Out of scope

- Per-agent icons/logos (use two-letter avatars, not SVG brand marks).
- Filtering/grouping artifacts by agent in the UI.
- `OTHER` / free-form agent value.

## Open / tweakable

- Brand colors above are first-pass; adjust to match the real mockup palette.
- Cursor / GitHub Copilot are both dark-ish — keep slate vs near-black distinct,
  or recolor during UI implementation.
