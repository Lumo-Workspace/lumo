# Document Management

## Document Management

### Content channels: prefer stdin / `--content`

`doc create` / `doc update` / `doc patch` / `doc append` all take the body from one of three mutually-exclusive channels. **For agent write-back, prefer stdin or `--content`** — pipe the markdown you already hold in memory, or pass it inline:

```bash
printf '%s' "$body" | lumo doc update cmd_xxx                                 # stdin — best for multi-line / generated content
lumo doc append cmd_xxx --section "F 待办队列" --content "- [ ] 评估 XYZ 论文"   # --content — short inline edits
```

`--file` is the **fallback for content that already lives in an authoritative file on disk** (e.g. a repo-tracked `docs/live-docs/<file>.md` source you are editing). It is **not** the default channel: `--file` is sandboxed — the CLI rejects any path outside the current project directory or matching the sensitive-file denylist (`.env*`, keys, `credentials`, …), with no override. So feeding it generated content forces you to first write a scratch file _inside the repo_ just to pass it — an extra step that is the real-world friction that gets `--file` rejected. Pipe via stdin instead and skip the temp file; reach for `--file` only when the file _is_ the source of truth you're editing.

### Markdown tables: keep them compact (no alignment padding)

When you author or edit a markdown doc that contains tables (live-docs, registers, reports), write the cells **compact — one space around each pipe, no column-alignment padding**:

```
| col | meaning |
| --- | --- |
| a | first |
```

not the aligned form (`| col   | meaning |` padded so columns line up). Two reasons, both about local editability:

- **prettier re-pads tables.** A compact table gets re-aligned and a padded one churns the diff on every prettier run — so repo-tracked live-doc sources under `docs/live-docs/` are in `.prettierignore` to stay byte-stable (see the live-docs README).
- **the Edit tool's exact-match fails on padding.** Incremental edits match on exact cell text; alignment whitespace makes that match fragile (measured to fail). Compact cells edit reliably.

This is a pure authoring convention — the server stores your markdown **byte-for-byte** (`sourceMarkdown`), so `doc show --raw` and `doc diff` stay byte-exact (LUM-408); there is **no** server-side table normalization to lean on. The structure guard (LUM-410) compares _rendered_ structure and is whitespace-insensitive, so compactness buys local editability, not a verify pass.

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

- User says "write a doc", "draft an RFC", "new document" (in any language), or describes a deliverable that should live as a document.
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
| `--allow-shrink`         | boolean             | Let a body update through even when it drops tables/rows/headings versus the stored body (see structure guard below).                                                                                                                                                 |

Optimistic concurrency (LUM-409): `--if-revision <n>` only applies the update if the doc body is still at revision `n` (from `doc show`). Mismatch → 409 conflict, nothing written — re-read, rebase, retry. `--if-revision` alone is not an update (still errors "no fields to update"); same for `--allow-shrink`.

**Structure guard (LUM-410), built into the server:** a body update whose new render has **fewer `table` / `tr` / heading elements than the stored body** is rejected with **422** before anything is written — the error names each shrunk category with old→new counts (e.g. `table 1→0, tr 4→0`). This is the `verify-live-doc.ts` reconciliation moved into the write path, so table flattening (LUM-349) and stale-base section loss (#460) fail loudly even when nobody remembers to run the script. When the deletion is intentional (you really are removing a section/table), re-run with `--allow-shrink`. On a 422: don't reach for `--allow-shrink` reflexively — first check whether your edit base is stale (`doc show <doc> --raw`) and rebase. Only markdown-path writes are guarded; web-editor edits and `doc sync` (Google authority) are not.

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

- User wants to revise an existing doc **as a whole** (title, scope, or a full-body rewrite).
- After running `lumo doc list` or `doc show`, if the user wants to change a doc's scope, title, or content.
- For a small edit inside one section, prefer `doc patch` / `doc append` (below) — full `doc update` has the maximum clobber radius.
- When replacing the body from a previously fetched base, pass `--if-revision` so a concurrent edit fails loudly (409) instead of being overwritten.
- When the update intentionally deletes a section or table, pass `--allow-shrink` up front; otherwise expect (and want) the 422 structure guard on accidental structure loss.

### `lumo doc show <doc> [--raw | --section <heading>]` — print one document's detail

Default mode prints a key:value header (id, title, scope, project, created/updated timestamps, **revision**, mentioned tasks) and the content rendered back to markdown. `Revision:` is the body's optimistic-concurrency counter — feed it back as `--if-revision` on `doc update` / `doc patch` / `doc append`.

```bash
lumo doc show "RFC: doc CLI"
lumo doc show cmd_xxx --raw > base.md            # byte-identical edit base (revision on stderr)
lumo doc show cmd_xxx --section "D 状态表" > sec.md  # one section only (revision on stderr)
```

**`--raw` (LUM-408)** prints the byte-identical markdown source of the last markdown upload — no header, no trailing newline added. The server stores the raw markdown (`sourceMarkdown`) alongside the rendered HTML on every markdown write (`doc create/update --content/--file/stdin`, gdoc import/sync), so `--raw` output IS a legal edit base: `doc show --raw > base.md`, edit, `doc update --file base.md` round-trips losslessly.

- A web-editor (HTML-direct) edit or revision restore **invalidates** the stored source — the doc's markdown source is gone until the next markdown upload.
- When no source is stored (legacy doc or after an HTML edit), `--raw` **fails with exit 1 and a rebuild hint** — it never silently falls back to the lossy HTML→markdown reverse render (that fallback flattened tables: LUM-349). Rebuild flow: `doc show` (rendered) → reconstruct the markdown faithfully → `doc update --file rebuilt.md` → `--raw` works from then on.
- Raw output is verbatim (unsanitized) by design — redirect it to a file rather than reading it in a terminal when the doc's provenance is uncertain.

Note: the markdown rendered by **default-mode** `doc show` is still best-effort (tables flatten). Round-trip via `doc show > tmp.md && doc update --file tmp.md` is NOT a no-op — use `--raw` as the edit base instead.

Output budget (LUM-428): **default-mode** `doc show` caps the rendered body to the output-token budget (25,000 tokens) and, when truncated, ends in a pointer to `--section "<heading>"` (just-in-time slice) / `--raw` (full source). `--raw` and `--section` are **never** capped — they are byte-faithful edit bases.

**`--section <heading>` (LUM-409)** prints just one heading-addressed section of the markdown source — a byte-faithful slice from the heading line through (not including) the next same-or-higher-level heading, subsections included. No header on stdout (the slice is a legal `doc patch` base); the current revision is printed to **stderr** as `Revision: N`. Mutually exclusive with `--raw`.

- Section addressing: pass the heading text (`--section "D 状态表"`), case-insensitive fallback after an exact pass. Prefix with `#…` to pin the level when the same text exists at several depths (`--section "## Status"`).
- Missing heading → exit 1 listing the available headings; ambiguous heading → exit 1 with a depth-disambiguation hint.
- Requires a stored markdown source — same no-fallback rule and rebuild flow as `--raw`.
- Heading detection is markdown-aware: `#` lines inside fenced code blocks or blockquotes are never section boundaries.

Use default mode when the user wants to read a doc; use `--raw` whenever the full output will be edited and uploaded back; use `--section` when only one part matters (keeps the context window small and the patch radius smaller).

### When to suggest `doc show --raw` / `--section`

- Before any `doc update --file` that starts from existing remote content — fetch the base with `--raw`, never from rendered `doc show` output.
- Before a `doc patch` — read the section with `--section` first, note the `Revision:` line, edit, patch back with `--if-revision`.
- User asks "what's the exact source of this doc", or an agent needs a faithful local copy of a live doc.
- User asks "what's in section X" of a long doc — `--section` avoids pulling the whole body into context.
- If `--raw`/`--section` errors (no stored source), walk the rebuild flow above instead of editing the rendered output.

### `lumo doc patch <doc> --section <heading>` — replace one section

Replaces the **whole addressed section** (heading line included, subsections included) with the provided content, server-side, leaving every byte outside the section untouched. The new content comes from `--content`, `--file`, or piped stdin (one required; `--file` is sandboxed like `doc update`).

| Flag                  | Type    | Notes                                                                                                       |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `--section <heading>` | string  | Required. Heading text addressing the section; prefix `#…` pins the depth.                                  |
| `--content <text>`    | string  | New section content (include the heading line — the whole section is replaced verbatim).                    |
| `--file <path>`       | string  | New section content from file (project-local sandbox).                                                      |
| `--if-revision <n>`   | int     | Only apply if the body is still at revision `n`. Recommended whenever the edit base was read earlier.       |
| `--allow-shrink`      | boolean | Let the patch through even when it drops tables/rows/headings within the addressed section (422 otherwise). |

Concurrency: the splice always commits **conditionally** on the revision the server read the source at — even without `--if-revision`, a concurrent body edit between read and write returns 409 instead of clobbering. On 409 the CLI prints the server reason plus a re-read-and-retry hint and exits 1.

Structure guard (LUM-410), **scoped to the addressed section**: a replacement whose render has fewer `table`/`tr`/heading elements than the old section's render is rejected with 422 naming each shrunk category (old→new counts); structure elsewhere in the document never factors in. Dropping the heading line itself trips the guard too (heading count shrinks). Pass `--allow-shrink` when the deletion is intentional. `doc append` is pure insertion and is never guarded.

Requires a stored markdown source (same rule as `--raw`); errors with the rebuild hint otherwise. Replacement is verbatim — if the new content omits the heading line, the heading is gone (an explicit choice the guard makes you confirm with `--allow-shrink`).

```bash
lumo doc show cmd_xxx --section "D 状态表" > sec.md   # stderr: Revision: 6
# … edit sec.md …
lumo doc patch cmd_xxx --section "D 状态表" --file sec.md --if-revision 6
# → Patched cmd_xxx "登记册" § "D 状态表"  revision 7
```

### When to suggest `doc patch`

- User wants to change one section of a live doc ("update the status table", "rewrite section D") — patch beats full `doc update` on clobber radius and context size.
- Live-doc status updates that used to be read-whole/edit/upload-whole round-trips.
- If the patch 409s: re-read the section, rebase the edit, retry — never fall back to a full-body upload from the stale base.
- If the patch 422s (structure guard): the replacement drops tables/rows/headings the section has. Re-check the edit base first; add `--allow-shrink` only when the deletion is what the user wants.

### `lumo doc append <doc> [--section <heading>]` — append to a section (or the doc)

Inserts the new content at the **end of the addressed section** (just before the next same-or-higher-level heading), or at the end of the document when `--section` is omitted. Pure insertion: no pre-existing byte is modified, which makes it the natural write for running logs, ledgers and queues. Content channels and sandbox are the same as `doc patch`; separator blank lines are added automatically.

| Flag                  | Type   | Notes                                                                        |
| --------------------- | ------ | ---------------------------------------------------------------------------- |
| `--section <heading>` | string | Optional. Omit to append at the document end.                                |
| `--content <text>`    | string | Content to append.                                                           |
| `--file <path>`       | string | Content from file (project-local sandbox).                                   |
| `--if-revision <n>`   | int    | Only apply if the body is still at revision `n`; 409 + retry hint otherwise. |

Same concurrency contract as `doc patch` (always a conditional commit; 409 on conflict). **End-of-document append (no `--section`) does NOT require a stored markdown source** (LUM-444): when the source is missing (web HTML edit / revision restore / legacy doc) it renders the new block to HTML and concatenates it onto the stored HTML body — so one web operation can no longer lock the whole doc against the agent write path. The source stays null (the doc is still HTML-only afterward; `--raw`/`--section`/`doc patch` keep erroring with the rebuild hint). **Section-addressed append (`--section`) still requires a stored source** — it needs the markdown to locate the heading boundary.

```bash
lumo doc append cmd_xxx --section "F 待办队列" --content "- [ ] 评估 XYZ 论文"
# → Appended to cmd_xxx "登记册" § "F 待办队列"  revision 8
echo "## 2026-06-10\n吸收了 3 篇" | lumo doc append cmd_xxx   # document end
```

### When to suggest `doc append`

- User wants to add an entry/row/log line to a section ("把 X 加进待办队列", "append today's notes") — this is the killer op for ledger-style live docs: zero clobber risk by construction.
- Whenever the alternative would be re-uploading the whole doc just to add lines at the end of one section.

### `lumo doc diff <doc> --file <local.md>` — compare remote markdown source vs a local file

Compares the server-side stored markdown source (the byte-identical last markdown upload) against a local file, making remote/local split-brain visible on demand.

| Flag            | Type   | Notes                                                                             |
| --------------- | ------ | --------------------------------------------------------------------------------- |
| `--file <path>` | string | Required. Local markdown file; same project-local sandbox as `doc update --file`. |

Exit codes: **0** = byte-identical (prints `Clean: …`), **1** = divergent (prints a unified diff, `--- remote/<id> (sourceMarkdown)` vs `+++ local/<file>`) or error. A doc without a stored markdown source errors explicitly (upload a markdown base once, then diff works).

```bash
lumo doc diff cmd_xxx --file docs/live-docs/research-intake-ledger.md
```

### When to suggest `doc diff`

- Before uploading a locally edited file with `doc update --file` — check whether the remote source moved since the local copy was taken (prevents stale-upload clobbering, the #460 incident class).
- When a repo-tracked markdown source (e.g. `docs/live-docs/`) and the live doc may have drifted and the user asks which is current.
- After a suspected concurrent edit: a clean diff (exit 0) proves remote and local are in sync.

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

- User says "move doc X under Y", "reparent X to root", "promote X to top level".
- After `doc create`, if the user realizes the new doc should live elsewhere in the tree — suggest `doc move` rather than recreating.

### `lumo doc delete <doc> --yes` — delete a document

Requires `--yes`; no interactive prompt (agent-friendly).

```bash
lumo doc delete cmd_xxx --yes
```

### `lumo doc bind <doc> <task>` — bind a doc to a task

Adds an explicit DocumentMention row. Survives content edits in the Web UI. If a CONTENT-derived mention already exists for the same pair, it's upgraded to EXPLICIT so a later `unbind` can remove it.

```bash
lumo doc bind cmd_xxx LUM-42
```

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

- User says "share doc X with Y", "give Y access to X"
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

- User pastes a Google Doc URL or says "import this Google Doc", "pull this gdoc into Lumo".
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

- User says "re-sync the Google Doc", "pull the latest from Google", "refresh the imported doc".
- After the user mentions the Google Doc changed upstream. Warn first that local Lumo edits to that doc will be overwritten (one-way, destructive).

### Out of scope (CLI v1)

The CLI does **not** currently support:

- `--from-editor` (interactive $EDITOR).
- Lossless markdown round-trip from **rendered** `doc show` output (use `doc show --raw` — lossless whenever a markdown source is stored).
- Reordering siblings within the same parent (`--before` / `--after`); use the Web UI for that.

### When to suggest session binding for docs

If user creates a doc with `--task LUM-N` and the current Claude Code session is not bound, suggest `lumo session attach LUM-N` so subsequent hook events also tag that task.
