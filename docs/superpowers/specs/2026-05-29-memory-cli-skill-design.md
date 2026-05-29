# Memory management CLI + skill guidance — design

**Task:** LUM-70 (extends the open PR #174; same branch `lumo/LUM-70-memory-management-ui`)
**Date:** 2026-05-29
**Status:** Design approved, ready for implementation plan
**Builds on:** the LUM-70 memory API (`POST/GET /api/{projects,tasks}/[id]/memories`, `PATCH/DELETE /api/memories/[memoryId]`) and the layer1/layer2 prompts (`lib/services/memory/layer{1,2}-prompt.ts`).

## Problem

LUM-70 shipped a web UI + REST API for managing Memory rows, but the people who most need to record/promote memories are **agents** (Claude Code sessions driving the `lumo` CLI). Today the only manual paths are the web UI or raw HTTP. There is:
- no `lumo memory` CLI surface,
- no `## Memory management` section in `.claude/skills/lumo/SKILL.md`,
- no agent-facing **judgment guidance** (when to record, which category, when to promote) — that logic lives only inside the layer1/layer2 LLM prompts.

This adds a CLI over the existing API, documents it in the skill, and distills the layer1/layer2 worthiness/promotion criteria into agent-facing guidance surfaced in **both** the skill and the CLI itself.

## Decisions (settled in brainstorming)

1. **Command shape (C):** scope-bound `list`/`add` nested under `task`/`project`; singleton `promote`/`rm` at top level (mirrors `/api/memories/[id]`).
2. **Guidance placement (A):** the worthiness/promotion rubric lives in `SKILL.md`.
3. **CLI also carries hints (D):** rich `--help`/descriptions **and** non-blocking post-action tips. Same wording shared across SKILL.md + help + tips.
4. **Same task/branch (B):** lands on `lumo/LUM-70-memory-management-ui`, extends PR #174. Reuses the already-merged API — **no backend changes**.
5. **Content input (A):** `--category <cat>` + per-category field flags (not raw JSON, not positional).
6. **Session-binding defaults:** the CLI is mostly agent-driven, so scope-bound commands default their target to the session-bound task when the identifier is omitted.
7. **No `edit` in CLI v1:** web UI covers editing; avoids needing a single-memory GET endpoint. Delete + re-add replaces it.
8. **No data-driven promote warning:** recurrence-count needs layer2-style cross-task analysis the API doesn't expose; the promote tip is a static reminder, not a computed `⚠ only 1 task` warning.

## Command surface

### Scope-bound (nested), identifier optional — defaults to session binding

```
lumo task memory list    [<LUM-N>]        [--category <cat>] [-n <limit>]
lumo task memory add      [<LUM-N>]        --category <cat> --<fields...>
lumo project memory list [<project-ref>]  [--category <cat>] [-n <limit>]
lumo project memory add   [<project-ref>] --category <cat> --<fields...>
```

### Singleton (top-level), id always explicit

```
lumo memory promote <memoryId>
lumo memory rm <memoryId> --yes
```

`memory edit` is intentionally NOT provided in v1 (see Decision 7).

### `--category` + field flags (Decision 5)

`--category` accepts `trap | decision | convention | procedural` (case-insensitive).

| category     | required flags        | optional flags                       | maps to content                                            |
| ------------ | --------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `trap`       | `--trigger` `--outcome` | `--workaround`                     | `{ trigger, outcome, workaround? }`                        |
| `decision`   | `--what` `--why`      | `--alternatives` `--implications`    | `{ what, why, alternatives?, implications? }`              |
| `convention` | `--rule` `--applies`  | —                                    | `{ rule, scope }` ← `--applies` maps to `content.scope`    |
| `procedural` | `--workflow` `--trigger` | `--step` (repeatable)             | `{ workflow, trigger, steps? }` ← each `--step` appends    |

- `--trigger` is shared by `trap` and `procedural` (same meaning, no conflict).
- **`--applies`** (not `--scope`) carries convention's `content.scope` field, to avoid confusion with memory scope (TASK/PROJECT). Memory scope is fixed by the command: `task memory add` → TASK, `project memory add` → PROJECT. `add` has no scope flag.
- The CLI validates required fields per category **before** any network call (friendly error on missing fields), assembles `{ category, content }`, and POSTs. The server's `parseMemoryContent` validates again (a mismatch returns 400, surfaced verbatim).

### Identifier resolution

- `<LUM-N>` → task id: reuse the existing by-identifier resolution (same as `task comment` / `task show`).
- `<project-ref>` (name or slug) → project id: resolved **client-side** by matching against `lumo project list` (the API does not server-resolve project names, consistent with `doc --project`).
- `<memoryId>`: a cuid the user/agent copies from `memory list` column 1; passed straight to `/api/memories/[id]`.

### Session-binding defaults (Decision 6)

Resolution order for scope-bound commands is **explicit arg > session binding**:

- `task memory list/add` with no `<LUM-N>`: read `$CLAUDE_CODE_SESSION_ID`, call `GET /api/sessions/<id>`, take `taskIdentifier`, resolve to task id.
- `project memory list/add` with no `<project-ref>`: resolve the bound task, then use **its project** (the binding is to a task; the project is derived from the task).
- `memory promote/rm <memoryId>`: id is always explicit — no binding shortcut.
- Neither explicit arg nor binding present → friendly error (same tone as `session status` when unbound):
  `No task bound to this session and no <LUM-N> given. Pass it explicitly or run \`lumo session attach <LUM-N>\`.`
- On `add` success, echo where it landed: `Added memory to LUM-42 "<title>" (from bound session)` so the agent confirms the target.

A shared helper `cli/src/lib/resolve-bound-task.ts` (env + `/api/sessions/<id>` → `taskIdentifier | null`) backs this; the memory commands reuse it.

### `list` output

Fixed-width rows, memoryId first (so `promote`/`rm` can reference it), like `task artifact list`:

```
cmd_xxx  TASK     TRAP        Postgres enums can't be altered mid-migration   auto
cmd_yyy  PROJECT  CONVENTION  All new schemas must use Zod                     manual
```

Source column: `manual` when `createdByMemberId` is set (human/agent-created), `auto` when null (sedimented by layer1/layer2). The CLI deliberately shows a short token rather than the creator's display name — the memory API returns only `createdByMemberId`, and resolving it to a name needs the workspace-members endpoint (the same plumbing tracked as the web "Added by X" follow-up). Surfacing the actual name is a deferred enhancement that can ride the same fix. `--category <cat>` filters client-side; `-n <limit>` caps rows.

## The guidance prompt (Decision 2 + 3)

One rubric, distilled from `layer1-prompt.ts` (worthiness) + `layer2-prompt.ts` (promotion), reused verbatim across SKILL.md, `--help`, and post-action tips.

### A. `SKILL.md` → new `## Memory management` section

**(1) Command reference** — the full surface above, with examples.

**(2) Judgment rubric** (the agent's self-check before calling a memory command):

> **When to record a memory (worthiness)**
> Record only knowledge that is *invisible in the codebase* — the *why* behind a choice, a gotcha that only surfaces at runtime, a rule that lives in people's heads, a non-obvious failure cause, a non-trivial workflow. **Skip** routine work (reading files, plain edits, normal git, successful builds) and anything a developer could learn straight from the source, git log, or docs. When unsure, don't record.
>
> **Which category**
> - `trap` — a pitfall/failure mode. Describe the PROBLEM ONLY (`--trigger` = the situation, `--outcome` = what goes wrong). Put the fix in a separate `procedural`.
> - `decision` — an engineering decision (`--what` + `--why`, optional `--alternatives`/`--implications`).
> - `convention` — a team rule (`--rule` + `--applies` = where it applies).
> - `procedural` — a reusable workflow (`--workflow` + `--trigger` + `--step`…).
>
> **TASK vs PROJECT (at add time)**
> Default to **TASK** (`lumo task memory add`) — useful only for the current task. Record directly to **PROJECT** (`lumo project memory add`) only when it helps *any* task in the project: a toolchain/environment trap, a team-wide convention, a cross-task architectural decision. When unsure → TASK.
>
> **When to promote (TASK → PROJECT)**
> `lumo memory promote <id>` only when the lesson **recurs across 2+ different tasks** AND would help a *different* task AND no equivalent PROJECT memory exists. A wrong promotion is costly (every agent sees it forever); prefer leaving it at TASK.

**(3) Trigger timing (for the bound agent):** "After a non-trivial debugging session, a pitfall you hit, or establishing a convention, consider `lumo task memory add`. When you notice a lesson recurring across multiple tasks, consider `lumo memory promote`."

**(4) Frontmatter `description`** gains trigger words: `memory`, `记忆`, `remember`, `record a memory`, `promote memory`, `沉淀`, `记一条`, `task memory`, `project memory`.

### B. CLI `--help` / descriptions

- `task memory add --help` / `project memory add --help`: list the four categories' fields **and** a condensed worthiness + category-choice blurb (shared wording with the rubric above).
- `memory promote --help`: states "only when a lesson recurs across 2+ tasks."

### C. Post-action tips (non-blocking nudges)

- After `task memory add`: `Tip: only useful for this task? If it generalizes, use \`lumo project memory add\` or \`lumo memory promote\` later.`
- After `memory promote`: `Promoted to PROJECT — every agent on this project now sees it. Promote only lessons that recur across tasks.`
- These are **static reminders** — no recurrence lookup (Decision 8).

## Implementation surface

**New command files** (`cli/src/commands/`):
- `memory-task-list.ts`, `memory-task-add.ts`, `memory-project-list.ts`, `memory-project-add.ts`, `memory-promote.ts`, `memory-rm.ts`
- task/project `list` share a row renderer; task/project `add` share content assembly — differ only in endpoint + scope resolution.

**New lib helpers** (`cli/src/lib/`):
- `resolve-bound-task.ts` — `$CLAUDE_CODE_SESSION_ID` + `GET /api/sessions/<id>` → `taskIdentifier | null`.
- `memory-content.ts` — assemble + pre-validate `{ category, content }` from flags (per-category required-field checks, `--applies`→`content.scope`, repeatable `--step`); plus the `list` row formatter.
- project ref→id: reuse an existing resolver if present, else add `resolve-project-id.ts` (client-side match against the projects list).

**Registration** (`cli/src/index.ts`):
- under the existing `task` command group: add a `memory` sub-group (`list`, `add`).
- under the `project` command group: add a `memory` sub-group (`list`, `add`). (Confirm `program.command('project')` exists — it currently backs `project list`; if it's only a single command, introduce the group.)
- top-level `program.command('memory')` with `promote`, `rm`.

**SKILL.md** (`.claude/skills/lumo/SKILL.md`): add the `## Memory management` section (per the guidance prompt) and extend the frontmatter `description` trigger words. Mandated by CLAUDE.md's CLI↔SKILL sync rule.

**CLI version**: bump `cli/package.json` version (e.g. minor bump, following the "chore: bump CLI x.y.z" precedent). No new dependencies.

**Tests** (`__tests__/cli/`, pure functions + mocked fetch, no network — mirrors `cli-create-task-schema` / `task-figma-*`):
- `memory-content`: required-field validation for all four categories, `--applies`→scope mapping, repeatable `--step`, friendly error on missing required field.
- `list` row formatting (id-first columns, source label).
- `resolve-bound-task`: bound / unbound / no-env (mock the session endpoint).
- add/promote/rm actions: mock the api layer; assert correct endpoint + payload, and the binding fallback (omitted identifier resolves to the bound task; missing binding errors).

## Out of scope (v1)

| Item | Why |
| --- | --- |
| `memory edit` in CLI | Web UI covers it; avoids a single-memory GET endpoint; delete + re-add suffices |
| Data-driven promote warning (`⚠ only 1 task`) | Needs layer2-style recurrence analysis not exposed by the API; static tip instead |
| Auto-suggest memories from the agent | A separate feature |
| Bulk operations | YAGNI |
| Any backend/API change | Pure CLI + SKILL.md; reuses the merged LUM-70 API |

## Risks

| Risk | Mitigation |
| --- | --- |
| `lumo project` may be a single command, not a group | Confirm during implementation; introduce the group if needed (small change) |
| Branch lags `main` (still on lumo/LUM-70) | Rebase/merge main before the PR merges (already noted on PR #174) |
| SKILL.md ↔ CLI behavior drift | Share one wording across rubric / help / tips |
| promote on an already-PROJECT memory | Server returns 409; CLI surfaces it verbatim |
| Shared-Prisma-client race in the worktree (observed) | Run `npx prisma generate` from the worktree before tsc; never delete schema fields to silence type errors |

## Relationship to the rest of the feature

- **API (LUM-70):** reused unchanged. The CLI is a thin client + identifier/binding resolution + guidance.
- **layer1/layer2 prompts:** the source of the distilled rubric; the manual CLI path is the human/agent override on top of the automated extraction (layer1) and promotion (layer2 on task→DONE).
- **PR:** extends #174 on the same branch (Decision B).
