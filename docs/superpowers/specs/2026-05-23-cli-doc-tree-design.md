# CLI doc tree — `lumo doc move` + `--parent` on create

**Task**: LUM-80
**Date**: 2026-05-23
**Status**: Design approved, ready for implementation plan

## Goal

Give the `lumo` CLI first-class support for the Document tree (`parentId` + `sortOrder`) that already exists in the database and Web UI. Today the CLI can only create docs at workspace root and has no way to reorganize.

After this change:

- `lumo doc create "Sub-doc" --parent "RFC"` files Sub-doc under RFC
- `lumo doc move "Sub-doc" --parent "Roadmap"` reparents
- `lumo doc move "Sub-doc" --root` moves to top-level
- `lumo doc list --tree` shows the hierarchy

## Non-goals

- Re-ordering among siblings (`--before <sibling>` / `--after <sibling>`). Deferred to a follow-up task.
- New tree endpoint or schema migration. The only server-side touch is widening one Prisma `select:` (see § Server-side touch).
- Lossless markdown round-trip, `--from-editor`, or other doc-CLI v1 gaps unrelated to the tree.

## Current surfaces (already on main)

| Surface                                                                                                           | Location                                                                           | Status          |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| `Document` model with `parentId` (nullable self-ref) + `sortOrder` (Float)                                        | `prisma/schema.prisma:893`                                                         | ready           |
| `POST /api/documents` accepts `parentId` (nullable, optional)                                                     | `lib/validation/schemas.ts:300`, `app/api/documents/route.ts:45,80`                | ready           |
| `PATCH /api/documents/[id]/move` accepts `{ parentId: cuid \| null, sortOrder: number }` with subtree-cycle check | `app/api/documents/[id]/move/route.ts`, schema `lib/validation/schemas.ts:346`     | ready           |
| `GET /api/documents` honors `parentId` and `rootOnly` query params; returns `parentId` and `sortOrder` per row    | `app/api/documents/route.ts:14-21`, service `lib/services/document.service.ts:150` | ready           |
| `lookupDocId()` resolves cuid or case-insensitive title with ambiguity error                                      | `cli/src/lib/resolve-doc-id.ts`, `cli/src/lib/resolve-doc.ts`                      | reusable        |
| CLI uses Commander.js; doc subcommands registered in `cli/src/index.ts:273-400`                                   | `cli/src/index.ts`, `cli/src/commands/doc-*.ts`                                    | extension point |

One minor server-side widening is needed for `--task --tree` to work — see § Server-side touch below. Everything else lives in `cli/`.

## Command surface

### `lumo doc create [title] [flags]` — add `--parent`

| Flag             | Type         | Notes                                                                                                              |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `--parent <doc>` | string (new) | cuid or case-insensitive title; resolved via `lookupDocId()` and sent as `parentId` in `POST /api/documents` body. |

- Flag is fully orthogonal to existing `--content` / `--file` / stdin / `--scope` / `--project` / `--task` / `--tag` / `--tag-id`.
- Resolution failure or ambiguity → CLI error, no network call beyond the lookup itself.
- Success output is unchanged: `Created cmd_xxx "Title"  https://www.uselumo.ai/workspace/<slug>/documents/cmd_xxx`. The tags line, when present, also renders unchanged.

### `lumo doc move <doc> [flags]` — new subcommand

| Flag             | Type    | Notes                                  |
| ---------------- | ------- | -------------------------------------- |
| `--parent <doc>` | string  | cuid or case-insensitive title.        |
| `--root`         | boolean | Move to top-level (`parentId = null`). |

Rules:

- `--parent` and `--root` are **mutually exclusive** and one of them is **required**.
  - Neither → CLI error before any network call: `Specify --parent <doc> or --root`.
  - Both → CLI error before any network call: `--parent and --root are mutually exclusive`.
- `<doc>` and `--parent <doc>` are resolved via the existing `lookupDocId()`. Resolution failure / ambiguity → CLI error.
- `sortOrder` is computed CLI-side as `max(sibling.sortOrder) + 1` (empty siblings → `0`). Siblings are fetched via:
  - `GET /api/documents?parentId=<id>` when moving under a parent,
  - `GET /api/documents?rootOnly=true` when moving to root.
- The PATCH call is `PATCH /api/documents/<docId>/move` with body `{ parentId, sortOrder }`.
- Subtree-cycle prevention already runs server-side; CLI surfaces the 400 message as-is.

Output (single line):

- `Moved cmd_xxx "Sub-doc" → "Parent title"` for `--parent`
- `Moved cmd_xxx "Sub-doc" → root` for `--root`

### `lumo doc list [flags]` — add `--tree`

| Flag     | Type    | Notes                                                          |
| -------- | ------- | -------------------------------------------------------------- |
| `--tree` | boolean | Render the result as an indented tree instead of a flat table. |

- No server change. CLI reuses the existing `GET /api/documents` (or `GET /api/tasks/<id>/documents` when `--task` is set) with the current `--scope` / `--project` / `--task` / `--limit` filters.
- After fetching the flat result, CLI builds a tree client-side by grouping on `parentId` and sorting siblings by `sortOrder` ascending.
- **Orphan handling**: any doc whose `parentId` points at a doc not present in the filtered result becomes a virtual root in the output. This preserves filter semantics — e.g. `lumo doc list --task LUM-42 --tree` shows only docs tied to LUM-42, with parents-outside-the-set rendered as their own roots.
- Row format keeps the existing fixed-width columns: `<cuid>  <SCOPE>  <project|->  <indent><title>`. Indent is `'  '` (two spaces) per depth level, applied only inside the title column so the first three columns stay aligned.
- `--limit` and `--tree` together: `--limit` is applied to the flat list _before_ the tree is built (documented in SKILL.md so the truncation behavior is explicit).

## File plan

**CLI** (new / changed files under `cli/`):

| File                              | Action | Purpose                                                                                                  |
| --------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `cli/src/commands/doc-move.ts`    | new    | `docMove(reference, opts)` handler.                                                                      |
| `cli/src/commands/doc-create.ts`  | edit   | Accept new `parent` option, resolve to cuid via `lookupDocId()`, include `parentId` in request body.     |
| `cli/src/commands/doc-list.ts`    | edit   | Accept new `tree` option, branch to `renderDocTree()` instead of the flat row formatter.                 |
| `cli/src/lib/doc-tree.ts`         | new    | Pure functions `buildTree(rows)` and `flattenWithDepth(tree)` for tree assembly and rendering.           |
| `cli/src/lib/get-doc-siblings.ts` | new    | `getNextSortOrder(apiUrl, token, parentId \| null)` — calls the list endpoint, returns next `sortOrder`. |
| `cli/src/index.ts`                | edit   | Register `doc move`, add `--parent` to `doc create`, add `--tree` to `doc list`.                         |

**Server** (the only non-CLI file touched):

| File                                  | Action | Purpose                                                                                                                                                           |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/repositories/misc.repository.ts` | edit   | Widen `findDocumentMentionsByTask`'s `document.select` to also return `parentId`, `sortOrder`, `visibility`, and the related `project: { select: { id, name } }`. |

The pure-function split on the CLI side (`doc-tree.ts`, `get-doc-siblings.ts`) keeps command handlers thin and gives future CLI test infra something straightforward to drive without mocking the fetch surface.

## Server-side touch

`GET /api/tasks/<id>/documents` currently selects only `id`, `title`, `emoji`, `updatedAt` ([`lib/repositories/misc.repository.ts:178-200`](lib/repositories/misc.repository.ts:178)). For `lumo doc list --task LUM-N --tree` to render a hierarchy, the payload must also expose `parentId` and `sortOrder`. While widening the `select`, also pull in `visibility` and `project` so:

1. The CLI can render the same `<cuid>  <SCOPE>  <project|->  <title>` columns it does for the unfiltered list.
2. The current `lumo doc list --task LUM-N --scope <s>` and `--project <p>` filters — which today reference `r.visibility` and `r.project?.name` on a payload that contains neither ([`cli/src/commands/doc-list.ts:73-82`](cli/src/commands/doc-list.ts:73)) — start working.

This widening is purely additive. The only Web consumer, `taskDocumentsClient.list` ([`lib/api-client/task-documents.ts:3-14`](lib/api-client/task-documents.ts:3)), declares a `TaskDocumentResource` type with just `id/title/emoji/updatedAt` — extra fields in the response are dropped at the type layer and ignored at runtime, so no UI behavior changes.

The existing CLI filter code at [`cli/src/commands/doc-list.ts:73-82`](cli/src/commands/doc-list.ts:73) — which already references `r.visibility` and `r.project?.name` — does not need to change. Today it silently no-ops on task-scoped queries (the fields are `undefined`); after this widening, it starts working as a side benefit. We deliberately do not refactor that code beyond what the test plan implies; it's already correct on its face.

No schema or migration changes.

## Verification strategy

The `cli/` package has no Jest setup today — every prior CLI task (LUM-43, LUM-48, LUM-65, LUM-66, LUM-78, LUM-79, LUM-83, LUM-84) shipped without unit tests, the CLI relies on end-to-end commands hit against a real workspace. This task continues that convention; bootstrapping CLI test infra (Jest config, fetch-mock helpers, mock credentials) is a meaningful chunk of work that belongs in its own follow-up.

Verification for this task is the `Acceptance verification` block at the end of this doc, plus these targeted manual checks before opening the PR:

- `--parent` + `--root` both set on `doc move` → CLI errors before any network call.
- Neither flag on `doc move` → CLI errors before any network call.
- `doc move "Ambiguous Title" --root` where two docs share the title → CLI prints candidate list, exit 1.
- `doc move "Sub-doc" --parent "Sub-doc"` (attempted self-parenting) → server 400 surfaced, exit 1.
- `doc list --task LUM-N --tree` where one of the matched docs has a parent outside the LUM-N set → that doc renders as a top-level row, depth 0.
- `doc list --tree --limit 2` against a workspace with >2 docs → exactly 2 logical rows (in pre-order); the second row may or may not be indented depending on whether it's a child of the first.

A separate follow-up task should bootstrap CLI Jest infra so future doc-tree refinements (`--before` / `--after`, sortOrder rebalancing) can land with unit-test coverage for the pure helpers in `cli/src/lib/doc-tree.ts`.

## Error mapping

| Condition                                                               | Behavior                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<doc>` or `--parent <doc>` not found                                   | CLI prints the resolver's "Document not found" line, exit 1. No network call beyond the lookup.         |
| `<doc>` or `--parent <doc>` ambiguous title                             | CLI prints candidate list (existing `resolveDoc()` behavior), exit 1.                                   |
| `--parent` and `--root` both set                                        | CLI prints `--parent and --root are mutually exclusive`, exit 1. No network call.                       |
| Neither `--parent` nor `--root` on `doc move`                           | CLI prints `Specify --parent <doc> or --root`, exit 1. No network call.                                 |
| Server 400 on move (ancestor cycle, parent not in same workspace, etc.) | CLI prints the server's `error` message verbatim, exit 1.                                               |
| 401 from any request                                                    | CLI prints `API key invalid or revoked. Run 'lumo auth login' to re-auth.`, exit 1 (existing behavior). |

## SKILL.md updates

`.claude/skills/lumo/SKILL.md` (project skill, gates agent behavior) must be updated in the same PR:

- `lumo doc create` section: add `--parent <doc>` row to the flag table and one example with `--parent`.
- `lumo doc list` section: add `--tree` row to the flag table and an example showing indented output; document the `--limit` + `--tree` interaction.
- New `lumo doc move <doc> [flags]` section: command-level description, `--parent` / `--root` flags, the mutual-exclusion rule, the sortOrder = max+1 behavior, output format examples, "when to suggest" bullets.
- Frontmatter `description` triggers: add "doc tree", "move doc", "reparent doc", "doc 树", "移动文档", "文档树" to the keyword list so the skill activates on those phrases.

## Out of scope (explicit)

- `--before <sibling>` / `--after <sibling>` on `doc move`. Sibling ordering is append-only in this iteration; sortOrder Floats give us cheap room to add an insert-between later without touching this code path.
- Scope-cross checks (e.g. preventing a `personal` doc from being parented under a `workspace` doc). If the server doesn't enforce this today, this task does not introduce it.
- Bulk move (`lumo doc move A B C --parent X`). Single-doc move only.
- Tree visuals beyond two-space indent (box-drawing characters, emoji, color). Cosmetic upgrade for later.

## Acceptance verification

These commands run against a real workspace cover the task's acceptance criteria:

```bash
# create a parent and a child
lumo doc create "RFC" --scope workspace
lumo doc create "Sub-doc" --parent "RFC" --scope workspace

# move the child to a different parent
lumo doc create "Roadmap" --scope workspace
lumo doc move "Sub-doc" --parent "Roadmap"

# move the child back to root
lumo doc move "Sub-doc" --root

# render the tree
lumo doc list --scope workspace --tree

# render the tree limited to one task's docs (exercises the server-side widening)
lumo doc bind "Sub-doc" LUM-80
lumo doc list --task LUM-80 --tree
```

Expected: `Sub-doc` shows under `RFC` after step 2, under `Roadmap` after step 3, at top level after step 4, and `--tree` indents children under their parents in the final listing. The `--task LUM-80 --tree` invocation must render with proper SCOPE / project columns and respect the parent/child relationship of any docs in the bound set.
