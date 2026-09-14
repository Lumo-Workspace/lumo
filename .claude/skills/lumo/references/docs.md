# Document Management

Document **CRUD, listing, tree/move, sharing, and Google import/sync**. For the surgical live-doc edit path — `doc show --raw/--section`, `doc patch`, `doc append`, `doc diff`, `doc rebuild-source` — see [doc-editing.md](doc-editing.md). The content-channels and table-authoring conventions below apply to those editing commands too.

## Content channels: prefer stdin / `--content`

`doc create` / `doc update` / `doc patch` / `doc append` all take the body from one of three mutually-exclusive channels. **For agent write-back, prefer stdin or `--content`** — pipe the markdown you already hold in memory, or pass it inline:

```bash
printf '%s' "$body" | lumo doc update cmd_xxx                                 # stdin — best for multi-line / generated content
lumo doc append cmd_xxx --section "F 待办队列" --content "- [ ] 评估 XYZ 论文"   # --content — short inline edits
```

`--file` is the **fallback for content that already lives in an authoritative file on disk** (e.g. a repo-tracked `docs/live-docs/<file>.md` source you are editing). It is **not** the default channel: `--file` is sandboxed — the CLI rejects any path outside the current project directory or matching the sensitive-file denylist (`.env*`, keys, `credentials`, …), with no override. So feeding it generated content forces you to first write a scratch file _inside the repo_ just to pass it — an extra step that is the real-world friction that gets `--file` rejected. Pipe via stdin instead and skip the temp file; reach for `--file` only when the file _is_ the source of truth you're editing.

## Markdown tables: keep them compact (no alignment padding)

When you author or edit a markdown doc that contains tables (live-docs, registers, reports), write the cells **compact — one space around each pipe, no column-alignment padding**:

```
| col | meaning |
| --- | --- |
| a | first |
```

not the aligned form (`| col   | meaning |` padded so columns line up). Two reasons, both about local editability:

- **prettier re-pads tables.** A compact table gets re-aligned and a padded one churns the diff on every prettier run — so repo-tracked live-doc sources under `docs/live-docs/` are in `.prettierignore` to stay byte-stable (see the live-docs README).
- **the Edit tool's exact-match fails on padding.** Incremental edits match on exact cell text; alignment whitespace makes that match fragile (measured to fail). Compact cells edit reliably.

This is a pure authoring convention — the server stores your markdown **byte-for-byte** (`sourceMarkdown`), so `doc show --raw` and `doc diff` stay byte-exact; there is **no** server-side table normalization to lean on. The structure guard compares _rendered_ structure and is whitespace-insensitive, so compactness buys local editability, not a verify pass.

## `lumo doc create [title] [flags]` — create a new document

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

The cuid (`cmd_xxx`) is still printed as a stable identifier you can pass back into other `lumo doc ...` commands; the URL switched to the per-workspace slug shape (`slugify(title)-<number>`) and the cuid is no longer a valid web URL. The `Tags:` line is omitted when no tags were attached.

### When to suggest `doc create`

- User says "write a doc", "draft an RFC", "new document" (in any language), or describes a deliverable that should live as a document.
- After a discussion that needs a write-up, offer to create the doc with a title and the right scope.

## `lumo doc update <doc> [flags]` — update a document

`<doc>` accepts a cuid or a case-insensitive title. Ambiguous titles fail with a candidate list — re-run with the cuid.

| Flag                     | Type                | Notes                                                                                                                                                                       |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--title <text>`         | string              | New title (cannot be empty).                                                                                                                                                |
| `--content <text>`       | string              | Replace content (inline).                                                                                                                                                   |
| `--file <path>`          | string              | Replace content from file.                                                                                                                                                  |
| (stdin)                  | —                   | Pipe to replace content. Empty / whitespace-only stdin (a non-TTY shell with nothing piped — the common agent case) is treated as **no content channel**, not a body clear. |
| `--scope <scope>`        | enum                | `personal` / `workspace`.                                                                                                                                                   |
| `--project <ref>`        | string              | Project name/slug. `--project ""` clears the filing.                                                                                                                        |
| `--tag <name>`           | string (repeatable) | **Bulk replace** the tag set by name. Creates tag if missing. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                               |
| `--tag-id <cuid>`        | string (repeatable) | **Bulk replace** the tag set by id. Max 20. Mutually exclusive with `--add-tag*` / `--remove-tag*`.                                                                         |
| `--add-tag <name>`       | string (repeatable) | Attach tag by name (find-or-create). Max 20.                                                                                                                                |
| `--add-tag-id <cuid>`    | string (repeatable) | Attach tag by id. Max 20.                                                                                                                                                   |
| `--remove-tag <name>`    | string (repeatable) | Detach tag by name (find-or-create; an unknown name creates an orphan Tag row before the no-op detach — use `--remove-tag-id` to avoid orphans). Max 20.                    |
| `--remove-tag-id <cuid>` | string (repeatable) | Detach tag by id. Unknown ids are a no-op. Max 20.                                                                                                                          |
| `--allow-shrink`         | boolean             | Let a body update through even when it drops tables/rows/headings versus the stored body (see structure guard below).                                                       |

A **metadata-only update leaves the body untouched**: when no content channel is supplied (`--title`/`--scope`/`--project`/tag flags only), the body is omitted from the PATCH — it does not get blanked and the structure guard cannot fire. To deliberately clear or replace the body you must supply a content channel explicitly (`--content ""` to clear, which then hits the structure guard as a shrink → pair with `--allow-shrink`).

Optimistic concurrency: `--if-revision <n>` only applies the update if the doc body is still at revision `n` (from `doc show`). Mismatch → 409 conflict, nothing written — re-read, rebase, retry. `--if-revision` alone is not an update (still errors "no fields to update"); same for `--allow-shrink`.

**Structure guard, built into the server:** a body update whose new render has **fewer `table` / `tr` / heading elements than the stored body** is rejected with **422** before anything is written — the error names each shrunk category with old→new counts (e.g. `table 1→0, tr 4→0`). This is the `verify-live-doc.ts` reconciliation moved into the write path, so table flattening and stale-base section loss fail loudly. When the deletion is intentional, re-run with `--allow-shrink`. On a 422: don't reach for `--allow-shrink` reflexively — first check whether your edit base is stale (`doc show <doc> --raw`) and rebase. Only markdown-path writes are guarded; web-editor edits and `doc sync` (Google authority) are not.

`--tag` / `--tag-id` (bulk replace) are mutually exclusive with `--add-tag` / `--add-tag-id` / `--remove-tag` / `--remove-tag-id`. The CLI errors before any network call if both families are mixed. Like `doc create`, `--file` is sandboxed.

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

- User wants to revise an existing doc **as a whole** (title, scope, or a full-body rewrite).
- For a small edit inside one section, prefer `doc patch` / `doc append` ([doc-editing.md](doc-editing.md)) — full `doc update` has the maximum clobber radius.
- When replacing the body from a previously fetched base, pass `--if-revision` so a concurrent edit fails loudly (409) instead of being overwritten.
- When the update intentionally deletes a section or table, pass `--allow-shrink` up front; otherwise expect (and want) the 422 structure guard on accidental structure loss.

## `lumo doc list [flags]` — list documents

Default behavior: lists every document the current user can see, as fixed-width rows: `<cuid>  <SCOPE>  <project|->  <title>`.

| Flag              | Type    | Notes                                                                                  |
| ----------------- | ------- | -------------------------------------------------------------------------------------- |
| `--scope <scope>` | enum    | `personal`, `workspace`, or `all`. Default `all`.                                      |
| `--project <ref>` | string  | Filter by project.                                                                     |
| `--task <LUM-N>`  | string  | Only docs bound to this task. Routes through `GET /api/tasks/<id>/documents`.          |
| `--limit <n>`     | int     | Cap output to the first N rows.                                                        |
| `--tree`          | boolean | Render as an indented tree (two spaces per depth level) instead of the flat row table. |

`--tree` plus filters work together: the CLI fetches with filters applied, then builds the tree from whatever rows came back. Docs whose parent is **not** in the result render as top-level rows. `--limit N --tree` truncates the flat list to N rows _before_ the tree is built. When `--task` is combined with `--scope` / `--project`, those become client-side filters on the task-scoped result.

```bash
lumo doc list --scope workspace
lumo doc list --task LUM-42
lumo doc list --scope workspace --tree
```

### When to suggest `doc list`

- The user asks "what docs do I have", "show me workspace docs", "what's on LUM-42".
- Before suggesting `doc update` or `doc delete` when no doc ID is in context — run `doc list` first to surface candidates.

## `lumo doc move <doc> [flags]` — move a doc under a different parent or to root

Reparents a doc. `<doc>` accepts a cuid or a case-insensitive title; ambiguous titles fail with a candidate list.

| Flag             | Type    | Notes                                            |
| ---------------- | ------- | ------------------------------------------------ |
| `--parent <doc>` | string  | New parent doc (cuid or case-insensitive title). |
| `--root`         | boolean | Move to top level (`parentId = null`).           |

`--parent` and `--root` are **mutually exclusive** and one is **required** (CLI errors before any network call otherwise). The new `sortOrder` is computed CLI-side as `max(sibling.sortOrder) + 1` — the moved doc lands at the end of its new sibling list. Reordering among siblings (`--before` / `--after`) is not yet supported; use the Web UI.

```bash
lumo doc move "Sub-doc" --parent "Roadmap"
lumo doc move "Sub-doc" --root
```

### When to suggest `doc move`

- User says "move doc X under Y", "reparent X to root", "promote X to top level".
- After `doc create`, if the user realizes the new doc should live elsewhere — suggest `doc move` rather than recreating.

## `lumo doc delete <doc> --confirm` — delete a document

Deletes the document **and every document nested under it**. Without `--confirm` the CLI looks the doc up and exits **4** with a confirmation envelope (`Will delete document cmd_xxx "Title"` + the nested-docs rule) — nothing is deleted; relay `changes` to the user and re-run `confirmCommand` on approval ([confirmation.md](confirmation.md)). `--yes` is a legacy alias.

```bash
lumo doc delete cmd_xxx            # exit 4 + envelope
lumo doc delete cmd_xxx --confirm  # after the user approved
```

## `lumo doc bind <doc> <task>` / `lumo doc unbind <doc> <task>` — task linkage

`bind` adds an explicit DocumentMention row (survives Web UI content edits). If a CONTENT-derived mention already exists for the same pair, it's upgraded to EXPLICIT so a later `unbind` can remove it. `unbind` removes EXPLICIT mentions only — a purely CONTENT-derived mention can't be unbound from CLI (fails 409, instructing the user to remove the `@LUM-N` from the doc body in the Web UI).

```bash
lumo doc bind cmd_xxx LUM-42
# Bound cmd_xxx ↔ LUM-42
# Bound cmd_xxx ↔ LUM-42 (upgraded from content)   # when upgrading a CONTENT row
# Already bound cmd_xxx ↔ LUM-42                   # idempotent
lumo doc unbind cmd_xxx LUM-42
```

## `lumo doc share / unshare / share-list` — member sharing

`share <doc> <member> [--role viewer|editor|manager]` adds (or updates) a DocumentShare row. `<member>` resolves the same way as `task --assignee`: `me`, an email, or a display name (case-insensitive). Role defaults to `viewer`. **Auto-promotion**: invoked on a PRIVATE doc, the server transactionally flips visibility to SHARED before upserting the share row (sharing = intent that it should be SHARED). A second invocation with a different role updates the row in place.

`unshare <doc> <member>` is idempotent (prints `Not shared with <name>`, exit 0 if no row). It does **not** flip visibility back to PRIVATE — do that explicitly via `doc update --scope personal`.

`share-list <doc>` prints fixed-width rows `<displayName>  <ROLE>`; empty output = no shares (may still be WORKSPACE-visible).

```bash
lumo doc share "RFC" alice@example.com --role editor
lumo doc share cmd_xxx "Alice Wong" --role manager
lumo doc unshare "RFC" alice@example.com
lumo doc share-list "RFC"
```

### When to suggest the doc share commands

- User says "share doc X with Y", "give Y access to X".
- After `doc create --scope personal`, if teammates need access, suggest `doc share` rather than `doc update --scope workspace` when only specific members should see it.
- Before `doc unshare`, run `doc share-list` if the user hasn't named a specific member.

## `lumo doc import-gdoc <url> [--scope …] [--task LUM-N]` — import a Google Doc

One-way import of a Google Doc into Lumo. The doc is exported from Google as markdown and turned into a native Lumo document (markdown → HTML), storing the source `googleDocId` and importer so it can be re-synced later (`lumo doc sync`). `<url>` accepts a Google Doc URL or a bare doc id.

| Flag              | Type   | Notes                                                                                      |
| ----------------- | ------ | ------------------------------------------------------------------------------------------ |
| `--scope <scope>` | enum   | `personal` (→ PRIVATE) or `workspace` (→ WORKSPACE). Omit to use the server default scope. |
| `--task <LUM-N>`  | string | Bind the imported doc to this task immediately after import.                               |

**Over-share note:** once imported, the content follows **Lumo's** sharing model (PRIVATE / SHARED / WORKSPACE) and is **no longer gated by Google permissions**. Importing a `workspace`-scoped doc can expose it to everyone in the workspace even if the Google Doc was restricted — the command prints this reminder on success. Requires a connected Google Drive integration (connect in the Web UI at `/settings/integrations`; there is no CLI `google auth` command).

```bash
lumo doc import-gdoc "https://docs.google.com/document/d/<id>/edit" --scope workspace --task LUM-127
```

### When to suggest `doc import-gdoc`

- User pastes a Google Doc URL or says "import this Google Doc", "pull this gdoc into Lumo".
- User wants a Google Doc tracked alongside Lumo tasks/docs — suggest import (with `--task LUM-N` if a task is in context) and remind them about the over-share semantics for `--scope workspace`.

## `lumo doc sync <doc>` — re-sync an imported doc from Google

Re-imports a previously imported Google Doc and **overwrites the Lumo body** with the current Google content. **One-way and destructive** — any edits made inside Lumo are discarded; Google is the source of truth for synced docs. Sync always runs as the **importer** (owner model): it re-exports using the importer's stored Google token, not the caller's. If the importer has lost access, sync fails with a clear error. `<doc>` accepts a cuid or case-insensitive title.

```bash
lumo doc sync "Quarterly Plan"
```

### When to suggest `doc sync`

- User says "re-sync the Google Doc", "pull the latest from Google", "refresh the imported doc".
- After the user mentions the Google Doc changed upstream. Warn first that local Lumo edits to that doc will be overwritten (one-way, destructive).

## When to suggest session binding for docs

If the user creates a doc with `--task LUM-N` and the current Claude Code session is not bound, suggest `lumo session attach LUM-N` so subsequent hook events also tag that task.
