# LUM-78 — CLI doc tags (and task tags): add/remove

**Status**: Approved — ready for implementation plan
**Task**: [LUM-78](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-78)
**Milestone**: Doc CLI follow-ups (target 2026-06-13)

## Problem

`Document` has both a legacy `tags: String[]` field and a Tag relation via `DocumentTag`. `Task` has only the Tag relation via `TaskTag`. The Web UI manages tags on both, but the CLI doesn't expose any tag operations on `doc create/update` or `task create/update`. We need to close that gap.

## Goals

- `lumo doc create` and `lumo task create` accept tags by name and by id.
- `lumo doc update` and `lumo task update` additionally support incremental add/remove.
- Tag creation by name is idempotent (find-or-create).
- Service layer rejects bulk-replace and incremental updates in the same request.
- The CLI never writes the legacy `Document.tags: String[]` field — it walks the Tag relation only.

## Non-Goals

- No changes to Web UI behavior or to legacy `Document.tags` semantics for non-CLI callers.
- No Tag CRUD command on the CLI (rename, recolor, delete). Those stay in the Web UI for v1.
- No migration of legacy `Document.tags: String[]` into the Tag relation — separate concern, out of scope.

## Design Decisions

| Question | Decision |
|---|---|
| Write legacy `Document.tags`? | No. CLI is relation-only. |
| `--tag` + `--add-tag/--remove-tag` in `update`? | Mutually exclusive; CLI errors before any network call. Server schema enforces the same rule as defense in depth. |
| Where is name→id resolution? | CLI-side. Server schemas accept ids only (`tagIds`, `addTagIds`, `removeTagIds`). |
| How does CLI resolve names → ids? | New endpoint `POST /api/tags/resolve` that wraps `tagRepository.findOrCreateMany`. |

## CLI Surface

### Create commands

`lumo doc create` and `lumo task create` gain:

| Flag | Repeatable | Notes |
|---|---|---|
| `--tag <name>` | yes | Find-or-create by name within current workspace. |
| `--tag-id <cuid>` | yes | Attach by id. |

The two are additive — the final set is the union of resolved names and explicit ids, deduped.

### Update commands

`lumo doc update` and `lumo task update` gain everything above, plus:

| Flag | Repeatable | Notes |
|---|---|---|
| `--add-tag <name>` | yes | Find-or-create by name and attach. |
| `--add-tag-id <cuid>` | yes | Attach by id. |
| `--remove-tag <name>` | yes | Detach. Unknown names → silent no-op (idempotent). |
| `--remove-tag-id <cuid>` | yes | Detach. Unknown ids → silent no-op. |

### UX rules

- **Mutex (update only)**: `--tag` / `--tag-id` (bulk) cannot be combined with `--add-tag*` / `--remove-tag*` (incremental). Same invocation triggers a CLI-side error before any HTTP call. Server schema enforces the same rule.
- **Count cap**: each flag family is capped at 20 entries to match the existing zod `.max(20)` constraints (`tagIds`, `tags`).
- **Empty/whitespace name**: rejected at CLI parse time.
- **Output**: success line gains a `Tags: a, b, c` row when the resulting tag set is non-empty; omitted when empty.

### Examples

```bash
lumo doc create "RFC: tags" --tag rfc --tag draft
lumo doc update RFC --add-tag urgent
lumo doc update RFC --remove-tag draft --remove-tag-id cmd_xxx
lumo task create "Investigate" --tag-id cmd_existing_tag
lumo task update LUM-42 --tag triage   # bulk replace: result is exactly {triage}
```

## Server Changes

### New endpoint

```
POST /api/tags/resolve
  body: { names: string[] }      // max 20 after dedupe; each name trimmed; empty-after-trim rejected with 400
  200:  { tags: Array<{ id, name, color }> }   // one entry per input name, in input order
```

- Workspace-scoped via the authenticated session.
- Implementation: thin wrapper calling existing `tagRepository.findOrCreateMany(workspaceId, names)`.
- Rationale: existing `POST /api/tags` returns 409 on duplicate name (used by Web UI); CLI needs idempotent find-or-create. A dedicated route avoids changing the existing endpoint's contract.

### Zod schemas (`lib/validation/schemas.ts`)

Shared fragment:

```ts
const tagsIncremental = {
  addTagIds: z.array(z.string().cuid()).max(20).optional(),
  removeTagIds: z.array(z.string().cuid()).max(20).optional(),
};
```

Changes:

- `createDocumentSchema` += `tagIds`
- `createTaskSchema` += `tagIds`
- `cliCreateTaskSchema` += `tagIds`
- `updateDocumentSchema` += `addTagIds`, `removeTagIds` (already has `tagIds`); add `.refine(...)` rejecting `tagIds && (addTagIds || removeTagIds)`
- `updateTaskSchema` += same
- `cliUpdateTaskSchema` += `tagIds`, `addTagIds`, `removeTagIds` + same refine

### Repository (`lib/repositories/tag.repository.ts`)

New helpers, all idempotent:

```ts
addTaskTags(taskId: string, tagIds: string[]): Promise<void>
removeTaskTags(taskId: string, tagIds: string[]): Promise<void>
addDocumentTags(documentId: string, tagIds: string[]): Promise<void>
removeDocumentTags(documentId: string, tagIds: string[]): Promise<void>
```

- `add*` uses `createMany({ skipDuplicates: true })`.
- `remove*` uses `deleteMany({ tagId: { in: ids } })`.

Existing `findOrCreateMany`, `syncTaskTags`, `syncDocumentTags` are untouched.

### Service (`lib/services/document.service.ts`, `lib/services/task-state.service.ts`, `lib/services/task.service.ts`)

- `createDocument`: after the document row is created, if `data.tagIds?.length`, call `syncDocumentTags(id, tagIds)`.
- `createTask` (create path): after the task is created, if `data.tagIds?.length`, call `syncTaskTags(id, tagIds)`.
- `updateDocument`:
  - if `data.tagIds` present → `syncDocumentTags` (existing behavior)
  - else if `addTagIds` or `removeTagIds` present → `addDocumentTags` then `removeDocumentTags`
  - else → no tag work
- `updateTask`: parallel branching.

Order for `add` then `remove` is fixed; same-call `--add-tag x --remove-tag x` will result in `x` being absent (remove wins). This is a degenerate input the CLI does not need to special-case.

### Response shape

`POST /api/documents`, `PATCH /api/documents/:id`, `POST /api/tasks`, `PATCH /api/tasks/:id`, and the CLI-by-identifier variants all return the entity with its tag relation already joined (verify in implementation — extend `select` if not). CLI reads the final tag list from the response, so add/remove output reflects the post-mutation set, not the requested delta.

## CLI Implementation Notes

- New helper `cli/src/lib/tag-resolver.ts` exporting `resolveTagRefs({ names, ids }): Promise<string[]>`:
  - Trim and dedupe names locally.
  - If `names.length > 0`: `POST /api/tags/resolve { names }`, take `tags[].id`.
  - Concat with explicit `ids`, dedupe, return.
- Command files (`doc-create`, `doc-update`, `task-create`, `task-update`) call the resolver before building the wire payload.
- Success formatter helpers (`formatCreatedTaskLine`, `formatUpdatedTaskLine`, doc equivalents) gain optional `tags?: Array<{ name: string }>` arg and append `Tags: <comma-list>` when non-empty.

## Test Plan

| Layer | File | Cases |
|---|---|---|
| Repo | `__tests__/lib/repositories/tag.repository.test.ts` (extend) | `addTaskTags` idempotency (re-add same id is no-op), `removeTaskTags` of unknown id does not throw, same for document variants |
| Service | `__tests__/lib/services/tag.service.test.ts` (extend) | Optional thin `resolveTagsByName` wrapper if introduced — covers trim + dedupe |
| Service | `__tests__/document.service.test.ts` (extend) | `createDocument` with `tagIds` calls `syncDocumentTags`; `updateDocument` with both `tagIds` and `addTagIds` rejected; `updateDocument` with only `addTagIds` + `removeTagIds` calls add then remove |
| Service | `__tests__/lib/services/task-state.service.test.ts` (extend) | Same for tasks |
| API | `__tests__/api/tags/resolve.test.ts` (new) | Auth required; workspace isolation; max 20; empty names array OK (returns `[]`); dup names dedup; whitespace-only names rejected |
| CLI | `__tests__/cli/commands/doc-create.test.ts`, `doc-update.test.ts` (extend) | flag parsing; mutex error exits non-zero with `mutually exclusive` in stderr; resolver call mocked + payload contains correct `tagIds`; output `Tags:` row when present |
| CLI | `__tests__/cli/commands/task-create.test.ts`, `task-update.test.ts` (extend) | Parallel to doc commands |

Out of scope for tests:

- Web UI tag flow
- Legacy `Document.tags: String[]` write path

## Out of Scope (Future Work)

- Tag CRUD via CLI (`lumo tag list/create/rename/delete`)
- `--from-editor` interactive tag entry
- Migrating `Document.tags: String[]` into the Tag relation
- Bulk tag rename across many documents/tasks
