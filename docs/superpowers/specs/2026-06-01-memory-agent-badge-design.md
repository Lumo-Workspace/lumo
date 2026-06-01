# Memory agent badge — design (LUM-136)

## Problem

Sedimented memories currently show a generic attribution chip — "由 Claude 沉淀"
(`memory.source.auto`) in the memory tab, and a "沉淀记忆" sparkles label
(`agentRun.memorySedimented`) in the Agent Run timeline. Spec artifacts, by
contrast, show the **producing agent's brand icon + name** via the shared
`AgentBadge` component. We want memories to show the same agent icon + name so
the attribution is concrete and visually consistent with artifacts.

## Goal

A sedimented memory displays the producing agent (icon + localized name) using
the **same `AgentBadge` component artifacts already use** — one shared
component, no memory-specific variant. Human-created memories keep their
"由 X 添加" attribution unchanged.

## Decisions (settled during brainstorming)

1. **Real `agent` field** on the `Memory` model (not a frontend-only swap), so
   the source is data-driven and future-proof for non-Claude agents.
2. **CLI accepts an optional `--agent`** on `memory add` so other agents can
   record their provenance; everything else defaults to `CLAUDE_CODE`.
3. **One shared component.** Reuse `AgentBadge` exactly as artifacts do — same
   enum, icon map, label, and size. No new component, no compact fork.

## Data model

Add to the `Memory` model (`prisma/schema.prisma`), reusing the existing
`TaskArtifactAgent` enum (`CLAUDE_CODE | CODEX | CURSOR | GEMINI_CLI |
GITHUB_COPILOT | WINDSURF`):

```prisma
agent TaskArtifactAgent @default(CLAUDE_CODE)
```

- The default backfills every existing row to `CLAUDE_CODE` on migrate — which
  is accurate, since all current auto-sedimented memories come from Claude Code.
  No data backfill script needed.
- Migration = add-column-with-default → non-destructive. PR description must
  note "requires `prisma migrate deploy` on next deploy". Frontend must tolerate
  a missing/unknown value (deploy-race safety) — see Rendering.

## Write paths

- **CLI** (`cli/src/commands/`): `lumo task memory add` and
  `lumo project memory add` gain an optional `--agent <enum>`. Accepts the same
  values + aliases as `task artifact add` (`claude-code | codex | cursor |
gemini-cli | github-copilot | windsurf`; `gemini` → `GEMINI_CLI`, `copilot` →
  `GITHUB_COPILOT`; case-insensitive). Default `claude-code` when omitted.
  → **Must update `.claude/skills/lumo/SKILL.md`** Memory section to document the
  flag (per the CLI/Skills sync rule in CLAUDE.md).
- **API route** (`app/api/.../memories`): POST body accepts optional `agent`,
  validated by a Zod enum, defaulting to `CLAUDE_CODE`.
- **Service** (`lib/services/memory-management.service.ts`): `createForTask` /
  `createForProject` accept and pass through `agent` (default `CLAUDE_CODE`).
- **Layer 1 / Layer 2 extraction** (`lib/services/memory/`): no code change —
  they don't pass `agent`, so the Prisma `@default(CLAUDE_CODE)` applies. These
  are Claude-Code-produced by definition.

## Read paths

- `MemoryRow` (`lib/api-client/memories.ts`) gains `agent: TaskArtifactAgent`;
  the memories repository `select` includes `agent`.
- The Agent Run timeline memory item type (`AgentRunMemoryItem`) and its source
  `select` gain `agent`, so `InlineMemoryCard` has it.

## Rendering (reuse `AgentBadge`, no new component)

- **`MemoryCard`**: `MemoryCardItem` gains `agent`. The default branch (when
  `showSedimentedLabel` is on and no explicit `source` is passed) renders
  `<AgentBadge agent={item.agent} />` in place of the `Sparkles` + "沉淀记忆"
  label. This covers the Agent Run timeline path (`InlineMemoryCard`).
- **`MemoryListItem`** (memory tab):
  - auto-sedimented (`createdByMemberId` is null) → pass
    `source={<AgentBadge agent={memory.agent} />}` so it flows through the
    existing `source` slot, which fades on hover to free the corner for the
    action menu.
  - human-created (`createdByMemberId` set) → unchanged "由 X 添加" text.
- **Deploy-race / dirty-data safety**: `AgentBadge` (or its caller) falls back
  to `CLAUDE_CODE` when the value is missing or not in `AGENT_META`, so a row
  read before the column exists can't crash on `AGENT_META[undefined]`.
- **i18n**: reuse the existing `taskArtifact.agent.*` labels (all six names
  already translated in every locale). `memory.source.auto` ("由 Claude 沉淀")
  loses its only use — remove the key from every locale file.
  `memory.source.byMember` stays.

## Design trade-off

The memory card is intentionally grayscale ("order via typography, not color" —
a single 7px category dot is its whole color budget). The agent badge adds a
small brand-color spot (icon + ~10% alpha circle). This is accepted on purpose:
the explicit goal is visual parity with artifacts, so consistency wins. The
badge is the unmodified `AgentBadge`, identical in size to the artifact rows.

## Testing

- `MemoryCard`: renders the agent badge in the default branch; renders for each
  agent enum value; unknown/missing agent falls back to `CLAUDE_CODE`.
- `MemoryListItem`: auto memory → agent badge; member memory → "由 X 添加".
- Service: `createForTask` / `createForProject` default `agent` to
  `CLAUDE_CODE` and honor an explicit value.
- API route: Zod accepts a valid agent, rejects garbage, defaults when absent.
- CLI: `--agent` parsing, alias resolution (`gemini`/`copilot`), default.
- Repository: memory `select` returns `agent`.

## Out of scope

- Backfilling a "true" agent onto historical memories (all are Claude Code).
- Surfacing agent in any filter/sort.
- Per-agent styling beyond what `AgentBadge` already provides.
