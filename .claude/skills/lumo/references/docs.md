# Document Management

## Document Management

### `lumo doc create [title] [flags]` — create a new document

Use this when the user wants to write a new document from the terminal. Title is positional and optional. When omitted, the doc title defaults to empty (server renders as "Untitled" via i18n).

| Flag               | Type                | Notes                                                                                                            |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--content <text>` | string              | Inline markdown body.                                                                                            |
| `--file <path>`    | string              | Read markdown body from file.                                                                                    |
| (stdin)            | —                   | Pipe markdown; treated as content when stdin is not a TTY.                                                       |
| `--scope <scope>`  | enum                | `personal` (default) or `workspace`. Maps to PRIVATE / WORKSPACE.                                                |
| `--project <ref>`  | string              | Project name or slug to file under. Default null. (Note: v1 does not server-resolve names; pass a cuid or omit.) |
| `--task <LUM-N>`   | string              | Bind to this task immediately after create.                                                                      |
| `--tag <name>`     | string (repeatable) | Attach tag by name. Creates tag if missing. Max 20 per call.                                                     |
| `--tag-id <cuid>`  | string (repeatable) | Attach tag by id. Combines with `--tag`. Max 20 per call.                                                        |
| `--parent <doc>`   | string              | cuid or case-insensitive title. Files the new doc under this parent. Omit for root.                              |

The three content channels (`--content`, `--file`, stdin) are mutually exclusive — specify at most one. **`--file` is sandboxed:** the CLI rejects a path that resolves outside the current project directory (parent-traversal, absolute, escaping symlinks) or matches a sensitive-file denylist (`.env*`, private keys, `*.pem`/`*.key`, `credentials`, `.ssh`/`.aws` contents, …). Pass only project-local, non-secret files; there is no override flag.

Examples:

```bash
lumo doc create "RFC: doc CLI" --scope workspace --file scratch/rfc.md --task LUM-66
lumo doc create "RFC: tags" --tag rfc --tag draft
lumo doc create "Design spec" --tag-id clm_abc123 --tag draft
lumo doc create "Sub-doc" --parent "RFC"
```

Success output:

```
Created cmd_xxx "RFC: doc CLI"  https://www.uselumo.ai/workspace/lumo/documents/rfc-doc-cli-42
Tags: rfc, draft
```

The cuid (`cmd_xxx`) is still printed as a stable identifier you can pass back into other `lumo doc ...` commands; the URL switched to the per-workspace slug shape (`slugify(title)-<number>`) and the cuid is no longer a valid web URL.

The `Tags:` line is omitted when no tags were attached.

### When to suggest `doc create`

- User says "write a doc", "起一篇 RFC", "新建文档", or describes a deliverable that should live as a document.
- After a discussion that needs a write-up, offer to create the doc with a title and the right scope.

### `lumo doc update <doc> [flags]` — update a document

`<doc>` accepts a cuid or a case-insensitive title. Ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag                     | Type                | Notes                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title <text>`         | string              | New title (cannot be empty).                                                                                                                                                                                                                                          |
| `--content <text>`       | string              | Replace content (inline).                                                                                                                                                                                                                                             |
| `--file <path>`          | string              | Replace content from file.                                                                                                                                                                                                                                            |
| (stdin)                  | —                   | Pipe to replace content.                                                                                                                                                                                                                                              |
| `--scope <scope>`        | enum                | `personal` / `workspace`.                                                                                                                                                                                                                                             |
| `--project <ref>`        | string              | Project name/slug. `--project ""` clears the filing.                                                                                                                                                                                                                  |
| `--tag <name>`           | string (repeatable) | **Bulk replace** the tag set by name. Creates tag if missing. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                         |
| `--tag-id <cuid>`        | string (repeatable) | **Bulk replace** the tag set by id. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                                                                                                                   |
| `--add-tag <name>`       | string (repeatable) | Attach tag by name (find-or-create). Max 20.                                                                                                                                                                                                                          |
| `--add-tag-id <cuid>`    | string (repeatable) | Attach tag by id. Max 20.                                                                                                                                                                                                                                             |
| `--remove-tag <name>`    | string (repeatable) | Detach tag by name. `--remove-tag <name>` resolves the name via find-or-create on the workspace. If the name was unknown, a new Tag row is created (orphan, no attachments) before the detach runs as a no-op. Use `--remove-tag-id <cuid>` to avoid orphans. Max 20. |
| `--remove-tag-id <cuid>` | string (repeatable) | Detach tag by id. Unknown ids are a no-op (no side effects). Max 20.                                                                                                                                                                                                  |

`--tag` / `--tag-id` (bulk replace) are mutually exclusive with `--add-tag` / `--add-tag-id` / `--remove-tag` / `--remove-tag-id`. The CLI errors before any network call if both families are mixed.

Like `doc create`, `--file` is sandboxed: the CLI rejects paths that resolve outside the project directory or match the sensitive-file denylist (`.env*`, private keys, `credentials`, …). No override flag.

Examples:

```bash
lumo doc update "RFC: doc CLI" --scope personal
lumo doc update cmd_xxx --title "RFC v2"
lumo doc update cmd_xxx --file rfc-v2.md
lumo doc update RFC --add-tag urgent --remove-tag draft
lumo doc update cmd_xxx --tag final --tag approved   # replace entire tag set
lumo doc update RFC --tag final --add-tag oops
# Error: --tag/--tag-id are mutually exclusive with --add-tag/--add-tag-id/--remove-tag/--remove-tag-id
```

### When to suggest `doc update`

- User wants to revise an existing doc.
- After running `lumo doc list` or `doc show`, if the user wants to change a doc's scope, title, or content.

### `lumo doc show <doc>` — print one document's detail

Prints a key:value header (id, title, scope, project, created/updated timestamps, mentioned tasks) and the content rendered back to markdown.

```bash
lumo doc show "RFC: doc CLI"
```

Note: the markdown rendered by `doc show` is best-effort. Round-trip via `doc show > tmp.md && doc update --file tmp.md` is NOT guaranteed to be a no-op.

Use when the user wants the current state or content of a doc without loading full task context.

### `lumo doc list [flags]` — list documents

Default behavior: lists every document the current user can see, as fixed-width rows: `<cuid>  <SCOPE>  <project|->  <title>`.

| Flag              | Type    | Notes                                                                                  |
| ----------------- | ------- | -------------------------------------------------------------------------------------- |
| `--scope <scope>` | enum    | `personal`, `workspace`, or `all`. Default `all`.                                      |
| `--project <ref>` | string  | Filter by project.                                                                     |
| `--task <LUM-N>`  | string  | Only docs bound to this task. Routes through `GET /api/tasks/<id>/documents`.          |
| `--limit <n>`     | int     | Cap output to the first N rows.                                                        |
| `--tree`          | boolean | Render as an indented tree (two spaces per depth level) instead of the flat row table. |

`--tree` plus the existing filters work together: the CLI fetches with the filters applied, then builds the tree from whatever rows came back. Docs whose parent is **not** in the result (e.g. filtered out by `--task LUM-N`) render as top-level rows. `--limit N --tree` truncates the flat list to N rows _before_ the tree is built, so a deeply nested subtree may not appear contiguously.

When `--task` is combined with `--scope` / `--project`, those become client-side filters on the task-scoped result.

Examples:

```bash
lumo doc list --scope workspace
lumo doc list --task LUM-42
lumo doc list --scope workspace --tree
```

### When to suggest `doc list`

- The user asks "what docs do I have", "show me workspace docs", "what's on LUM-42".
- Before suggesting `doc update` or `doc delete` when no doc ID is in context — run `doc list` first to surface candidates.

### `lumo doc move <doc> [flags]` — move a doc under a different parent or to root

Reparents a doc. `<doc>` accepts a cuid or a case-insensitive title; ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag             | Type    | Notes                                            |
| ---------------- | ------- | ------------------------------------------------ |
| `--parent <doc>` | string  | New parent doc (cuid or case-insensitive title). |
| `--root`         | boolean | Move to top level (`parentId = null`).           |

`--parent` and `--root` are **mutually exclusive** and one of them is **required**. CLI errors before any network call if both or neither is supplied.

The new `sortOrder` is computed CLI-side as `max(sibling.sortOrder) + 1` — the moved doc lands at the end of its new sibling list. Reordering among siblings (`--before` / `--after`) is not yet supported; for now use the Web UI to reorder.

Examples:

```bash
lumo doc move "Sub-doc" --parent "Roadmap"
lumo doc move "Sub-doc" --root
lumo doc move cmd_xxx --parent cmd_yyy
```

Output:

```
Moved cmd_xxx "Sub-doc" → "Roadmap"
Moved cmd_xxx "Sub-doc" → root
```

### When to suggest `doc move`

- User says "move doc X under Y", "把文档 X 挂到 Y 下", "reparent X to root", "promote X to top level".
- After `doc create`, if the user realizes the new doc should live elsewhere in the tree — suggest `doc move` rather than recreating.

### `lumo doc delete <doc> --yes` — delete a document

Requires `--yes`; no interactive prompt (agent-friendly).

```bash
lumo doc delete cmd_xxx --yes
```

### `lumo doc bind <doc> <task>` — bind a doc to a task

Adds an explicit DocumentMention row. Survives content edits in the Web UI. If a CONTENT-derived mention already exists for the same pair, it's upgraded to EXPLICIT so a later `unbind` can remove it.

Output:

```
Bound cmd_xxx ↔ LUM-42
Bound cmd_xxx ↔ LUM-42 (upgraded from content)   # when upgrading a CONTENT row
Already bound cmd_xxx ↔ LUM-42                   # idempotent
```

### `lumo doc unbind <doc> <task>` — unbind a doc from a task

Removes EXPLICIT mentions only. A purely CONTENT-derived mention can't be unbound from CLI — fails with 409 and a message instructing the user to remove the @LUM-N from the doc body in the Web UI.

```bash
lumo doc unbind cmd_xxx LUM-42
```

### `lumo doc share <doc> <member> [--role viewer|editor|manager]` — share with a workspace member

Adds (or updates) a DocumentShare row for the given member. `<member>` resolves the same way as `task --assignee`: `me`, an email, or a display name (case-insensitive). Role defaults to `viewer`.

**Auto-promotion**: when invoked on a PRIVATE doc, server-side transactionally flips the doc's visibility to SHARED before upserting the share row. No flag needed — sharing a doc is treated as expressing the intent that it should be SHARED.

Examples:

```bash
lumo doc share "RFC" alice@example.com --role editor
lumo doc share cmd_xxx "Alice Wong" --role manager
lumo doc share cmd_xxx me                        # share with yourself (rare; mostly for testing)
```

Output:

```
Shared cmd_xxx ↔ Alice Wong (EDITOR)
```

A second invocation with a different role updates the existing row in place (upsert semantics).

### `lumo doc unshare <doc> <member>` — remove a member's share

Idempotent. If the member has no share row, prints `Not shared with <name>` and exits 0.

```bash
lumo doc unshare "RFC" alice@example.com
# → Unshared cmd_xxx ↔ Alice Wong
```

Unshare does **not** flip visibility back to PRIVATE — that has to be done explicitly via `lumo doc update --scope personal`.

### `lumo doc share-list <doc>` — list current shares

Prints fixed-width rows: `<displayName>  <ROLE>`. Empty output means the doc has no shares (it may still be WORKSPACE-visible).

```bash
lumo doc share-list "RFC"
# Alice Wong   EDITOR
# Bob Chan     VIEWER
```

### When to suggest the doc share commands

- User says "share doc X with Y", "give Y access to X", "把文档分享给 Y"
- After `doc create --scope personal`, if the user mentions teammates needing access, suggest `doc share` rather than `doc update --scope workspace` when only specific members should see it
- Before `doc unshare`, run `doc share-list` if the user hasn't named a specific member

### `lumo doc import-gdoc <url> [--scope personal|workspace] [--task LUM-N]` — import a Google Doc

One-way import of a Google Doc into Lumo. The doc is exported from Google as markdown and turned into a native Lumo document (markdown → HTML), storing the source `googleDocId` and importer so it can be re-synced later (`lumo doc sync`). `<url>` accepts a Google Doc URL or a bare doc id.

| Flag              | Type   | Notes                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| `--scope <scope>` | enum   | `personal` (→ PRIVATE) or `workspace` (→ WORKSPACE). Omit to use the server default scope. |
| `--task <LUM-N>`  | string | Bind the imported doc to this task immediately after import.                               |

**Over-share note:** once imported, the content follows **Lumo's** sharing model (PRIVATE / SHARED / WORKSPACE) and is **no longer gated by Google permissions**. Importing a `workspace`-scoped doc can therefore expose it to everyone in the workspace even if the Google Doc was restricted — the command prints this reminder on success.

Requires a connected Google Drive integration; connect it in the Web UI at `/settings/integrations`. There is no CLI `google auth` command.

```bash
lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit"
lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit" --scope workspace --task LUM-127
```

Output:

```
Imported cmd_xxx "Quarterly Plan"  https://www.uselumo.ai/workspace/lumo/documents/quarterly-plan-42
Note: imported content follows Lumo sharing and is no longer gated by Google permissions.
Bound cmd_xxx ↔ LUM-127
```

The `Bound ... ↔ LUM-N` line appears only when `--task` is supplied.

### When to suggest `doc import-gdoc`

- User pastes a Google Doc URL or says "import this Google Doc", "pull this gdoc into Lumo", "把这篇 Google 文档导入".
- User wants a Google Doc tracked alongside Lumo tasks/docs — suggest import (with `--task LUM-N` if a task is in context) and remind them about the over-share semantics for `--scope workspace`.

### `lumo doc sync <doc>` — re-sync an imported doc from Google

Re-imports a previously imported Google Doc and **overwrites the Lumo body** with the current Google content. **One-way and destructive** — any edits made to the doc inside Lumo are discarded; Google is the source of truth for synced docs.

Sync always runs as the **importer** (owner model): it re-exports using the importer's stored Google token, not the token of whoever runs the command. If the importer has lost access to the Google Doc, sync fails with a clear error.

`<doc>` accepts a doc cuid or a case-insensitive title; ambiguous titles fail with a candidate list — re-run with the cuid.

```bash
lumo doc sync cmd_xxx
lumo doc sync "Quarterly Plan"
```

Output:

```
Synced cmd_xxx "Quarterly Plan" from Google
```

### When to suggest `doc sync`

- User says "re-sync the Google Doc", "pull the latest from Google", "refresh the imported doc", "更新一下从 Google 导入的文档".
- After the user mentions the Google Doc changed upstream. Warn first that local Lumo edits to that doc will be overwritten (one-way, destructive).

### Out of scope (CLI v1)

The CLI does **not** currently support:

- `--from-editor` (interactive $EDITOR).
- Lossless markdown round-trip.
- Reordering siblings within the same parent (`--before` / `--after`); use the Web UI for that.

### When to suggest session binding for docs

If user creates a doc with `--task LUM-N` and the current Claude Code session is not bound, suggest `lumo session attach LUM-N` so subsequent hook events also tag that task.
