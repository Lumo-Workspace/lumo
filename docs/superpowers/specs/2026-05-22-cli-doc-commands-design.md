# CLI Doc Commands — Design

**Task**: [LUM-66](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-66)
**Date**: 2026-05-22
**Branch (proposed)**: `lumo/LUM-66-cli-doc-commands`

## Goal

Enable end-to-end document management from the `lumo` CLI:

1. Create a doc.
2. Update a doc.
3. Bind / unbind a doc to a task.
4. Choose scope (personal vs workspace) on create and update.

Plus the supporting verbs needed to close the loop (`show`, `list`, `delete`) so a user does not have to switch to the Web UI to find a doc cuid before operating on it.

## Background

The `Document` model already exists server-side:

```prisma
model Document {
  id          String  @id @default(cuid())
  title       String  @default("")
  content     String? @db.Text     // Tiptap JSON, serialized
  emoji       String?
  parentId    String?
  projectId   String?               // optional project filing
  workspaceId String
  createdById String
  visibility  DocVisibility @default(PRIVATE)  // PRIVATE | SHARED | WORKSPACE
  // ...
  mentions    DocumentMention[]
}

model DocumentMention {
  documentId String
  taskId     String
  @@unique([documentId, taskId])
}
```

API routes that already exist:

- `GET/POST /api/documents`
- `GET/PATCH/DELETE /api/documents/[id]`
- `GET /api/tasks/[id]/documents` (read-only — list docs mentioning a task)
- `POST /api/documents/[id]/move` and `[id]/shares` (UI-only concerns)

Two gaps for the CLI:

1. **Content on create.** `POST /api/documents` does not accept `content` — the UI creates an empty doc then PATCHes content. CLI users need a single round-trip.
2. **Doc ↔ task binding has no first-class API.** `DocumentMention` rows are synced **from doc content** by `documentService.syncDocumentMentions(documentId, content)`, which walks Tiptap JSON for `type: 'mention'` nodes and replaces the table rows. Adding a binding from the CLI without rewriting the doc body is not currently possible. Conversely, any CLI-written binding would be wiped on the next content PATCH.

## CLI Surface

Identifier conventions match `lumo milestone`: `<doc>` accepts either a cuid or a title (case-insensitive). Ambiguous title matches fail with the candidate list.

```
lumo doc create [title]
   --content <text>          # inline string
   --file <path>              # read local file
   (stdin)                    # pipe; resolved if --content and --file are absent and stdin is not a TTY
   --scope <personal|workspace>   # default: personal (= PRIVATE)
   --project <name|slug>          # default: null
   --task <LUM-N>                 # optional convenience — runs bind after create

lumo doc update <doc>
   --title <text>
   --content <text> | --file <path> | (stdin)
   --scope <personal|workspace>
   --project <name|slug|"">       # "" clears the project filing

lumo doc show <doc>             # key:value header + content body
lumo doc list
   --scope <personal|workspace|all>   # default: all
   --project <name|slug>
   --task <LUM-N>                     # only docs bound to this task
   --limit <n>

   # --task takes precedence over --scope / --project: it routes to
   # GET /api/tasks/<id>/documents and applies --scope / --project as
   # client-side filters on the returned set.

lumo doc delete <doc> --yes      # --yes required; no interactive prompt

lumo doc bind   <doc> <task>     # task = LUM-N
lumo doc unbind <doc> <task>
```

### Content input rules

- `--content`, `--file`, and stdin are mutually exclusive. Specifying more than one is a usage error.
- If stdin is a TTY (no real pipe) and the other two flags are absent, the command does NOT block — it proceeds with no content change (on update) or empty content (on create).
- `--file` reads the entire file as UTF-8. Server-side validation rejects content over 500,000 characters.

### Output format

Aligned with existing commands:

```
Created cmd_xxx "Title"  https://www.uselumo.ai/workspace/lumo/documents/cmd_xxx
Updated cmd_xxx "Title"  https://www.uselumo.ai/workspace/lumo/documents/cmd_xxx
Deleted cmd_xxx "Title"
Bound   cmd_xxx ↔ LUM-42
Bound   cmd_xxx ↔ LUM-42 (upgraded from content)   # when collapsing an existing CONTENT row
Unbound cmd_xxx ↔ LUM-42
```

`doc list` prints fixed-width rows: `<cuid>  <SCOPE>  <project|->  <title>`, sorted by `updatedAt` desc.

`doc show` prints a `Key: Value` block (id, title, scope, project, created/updated timestamps, mentioned task IDs), then a blank line, then the content (decoded back to markdown — see below).

## Server-side changes

### New API endpoints

- `POST   /api/documents/<id>/mentions` — body `{ taskIdentifier: "LUM-42" }`. Idempotent. Resolves task by identifier, inserts `DocumentMention` with `source = EXPLICIT`. If a row already exists with `source = CONTENT`, **upgrade** it to `EXPLICIT` (so a later `unbind` can remove it; otherwise CLI users have no recourse to remove a content-derived binding).
- `DELETE /api/documents/<id>/mentions/<taskId>` — only removes rows where `source = EXPLICIT`. Idempotent. Returns 200 with `removed: 0 | 1`.

### Extending existing routes

- `POST /api/documents` accepts optional `contentMarkdown: string` (max 500,000). Service converts to Tiptap JSON before insert. Existing UI POST path (which omits content) keeps working unchanged.
- `PATCH /api/documents/<id>` accepts optional `contentMarkdown: string`. Mutually exclusive with `content`. Same conversion path.

### Markdown → Tiptap conversion

Performed server-side in `documentService` (one converter, one source of truth — CLI stays thin, future SDK/mobile entry points reuse it).

Implementation note: add `prosemirror-markdown` (or `@tiptap/extension-markdown` plus a small walker — pick during implementation) as a dependency. Mention in PR description per CLAUDE.md "no new packages without noting in PR".

`doc show` performs the reverse: walk the Tiptap JSON and emit a best-effort markdown rendering. Round-trip fidelity is **not** a goal — show is for human inspection; for an exact edit cycle the user goes to the Web editor. The CLI does not promise that `lumo doc show X > tmp.md && lumo doc update X --file tmp.md` is a no-op.

### Schema change: `source` column on `DocumentMention`

```prisma
enum DocMentionSource {
  CONTENT     // derived from a mention node in doc content
  EXPLICIT    // created via CLI / explicit API
}

model DocumentMention {
  // ... existing fields ...
  source DocMentionSource @default(CONTENT)
}
```

Behavioral implications:

- `syncDocumentMentions(documentId, content)` is changed to **replace only `source = CONTENT` rows** for that doc. `EXPLICIT` rows are untouched.
- Existing rows migrate to `CONTENT` (the default), so current behavior is preserved.
- `doc bind` writes `EXPLICIT`. If a `CONTENT` row exists for the same `(doc, task)`, it is upgraded to `EXPLICIT`.
- `doc unbind` only deletes `EXPLICIT` rows. A `CONTENT`-only binding can only be removed by editing the doc body in the Web UI.

### Data flow

```
CLI doc create  → POST /api/documents { title, visibility, projectId, contentMarkdown? }
                  ↓ service: MD→Tiptap; INSERT Document; run content-derived sync
                  ↓ if --task: POST /api/documents/<cuid>/mentions { taskIdentifier }
CLI doc update  → PATCH /api/documents/<id> { title?, visibility?, projectId?, contentMarkdown? }
CLI doc bind    → POST /api/documents/<id>/mentions { taskIdentifier }
CLI doc unbind  → DELETE /api/documents/<id>/mentions/<taskId>
CLI doc list    → GET /api/documents?visibility=&projectId=&search=
                  ↓ if --task: GET /api/tasks/<id>/documents (existing route)
CLI doc show    → GET /api/documents/<id>
CLI doc delete  → DELETE /api/documents/<id> (existing route)
```

## Error handling

| Scenario | Behavior |
|---|---|
| `<doc>` title resolves to ≥ 2 docs | Exit 1, list candidates with cuid + title |
| `<doc>` not found | Exit 1, `Document not found: <input>` |
| `--scope personal` but server denies | Pass through 403 message |
| `--project` name not found | Exit 1, `Project not found: <input>` (suggest `lumo project list`) |
| `--task LUM-N` not found | Exit 1, `Task not found: LUM-N` |
| Multiple of `--content / --file / stdin` | Exit 1, `--content, --file, and stdin are mutually exclusive` |
| `--file` path missing | Exit 1, fs error |
| Content > 500,000 chars | Server 400, CLI passes through |
| `doc bind` already bound (EXPLICIT) | Idempotent success: `Already bound LUM-N` |
| `doc bind` existing CONTENT row | Upgrade to EXPLICIT, success: `Bound cmd_xxx ↔ LUM-N (upgraded from content)` |
| `doc unbind` row is CONTENT-only | Exit 1, `Cannot unbind a content-derived mention; remove the @LUM-N from the doc body instead` |
| `doc delete` without `--yes` | Exit 1, `Refusing to delete without --yes` |
| stdin is a TTY | Treat as "no content input", do not block |

## Testing

Per CLAUDE.md "every new function needs at least one test", layered:

### Server-side (Jest)

- `lib/services/document.service.test.ts` — add cases for:
  - `createDocument` with `contentMarkdown` → Tiptap JSON stored correctly
  - `addExplicitMention` happy path + idempotency + CONTENT→EXPLICIT upgrade
  - `removeExplicitMention` idempotency + refuses CONTENT-only rows
  - `syncDocumentMentions` preserves `EXPLICIT` rows, replaces `CONTENT` rows
- `lib/repositories/document.repository.test.ts` — `source` field read/write
- `app/api/documents/[id]/mentions/__tests__/` — route-level: zod validation, auth, 404, happy path for POST and DELETE
- Markdown → Tiptap converter unit tests: headings, bullet/ordered lists, links, inline code, code blocks, paragraphs, `@LUM-N` mention nodes

### CLI (Jest)

Each new command gets a `cli/__tests__/doc-*.test.ts` following the pattern in `cli/__tests__/task-create.test.ts` and `cli/__tests__/milestone-create.test.ts`:

- flag parsing
- three content input channels (mock fs + stdin)
- exit codes on error paths
- exact output format

### Manual verification (in PR test plan)

```
lumo doc create "RFC: doc CLI" --scope workspace --file scratch/rfc.md --task LUM-66
lumo doc list
lumo doc list --task LUM-66
lumo doc show "RFC: doc CLI"
lumo doc update <cuid> --scope personal
lumo doc bind <cuid> LUM-42
lumo doc unbind <cuid> LUM-42
lumo doc delete <cuid> --yes
```

## Migration

Per CLAUDE.md DB rules — schema change requires a migration that runs only via `prisma migrate deploy` on production.

- File: `prisma/migrations/<timestamp>_add_document_mention_source/migration.sql`
- Adds enum `DocMentionSource` and `DocumentMention.source` column with default `'CONTENT'`
- Zero-downtime: pure additive, default backfills existing rows
- PR description must note: "Requires `migrate deploy` on next deploy; additive column with default, zero-downtime."

## SKILL.md sync

Per CLAUDE.md "CLI & Skills 同步" rule, this PR **must** update `.claude/skills/lumo/SKILL.md`:

- Frontmatter `description` triggers: add `create doc`, `new document`, `写文档`, `update doc`, `更新文档`, `list docs`, `我的文档`, `delete doc`, `bind doc`, `unbind doc`, `doc scope`, `个人文档`, `workspace 文档`, `doc create`, `doc bind`.
- New `## Document Management` section, parallel to existing `## Task Management`, covering each verb (create / update / show / list / delete / bind / unbind) with a flag table, examples, and "When to suggest" notes.
- Note the content input rule (three mutually-exclusive channels) and the CONTENT-only unbind limitation.
- Cross-reference: `doc create --task LUM-N` is a convenience for create + bind; if the session is already attached to that task, no extra step needed.

## File layout

CLI:
```
cli/src/commands/doc-create.ts
cli/src/commands/doc-update.ts
cli/src/commands/doc-show.ts
cli/src/commands/doc-list.ts
cli/src/commands/doc-delete.ts
cli/src/commands/doc-bind.ts
cli/src/commands/doc-unbind.ts
cli/src/index.ts                   # register new subcommands under `doc`
cli/src/lib/doc-input.ts           # parse --content / --file / stdin trio
cli/src/lib/resolve-doc.ts         # title-or-cuid resolver
```

Server:
```
app/api/documents/[id]/mentions/route.ts            # POST
app/api/documents/[id]/mentions/[taskId]/route.ts   # DELETE
lib/services/document.service.ts                    # +addExplicitMention, +removeExplicitMention, +convertMarkdownToTiptap, +convertTiptapToMarkdown
lib/repositories/document.repository.ts             # source-aware queries
lib/validation/schemas.ts                           # +createDocumentMentionSchema; contentMarkdown on create/update
prisma/schema.prisma                                # +DocMentionSource, +source column
prisma/migrations/<ts>_add_document_mention_source/migration.sql
```

## Open trade-offs (resolved)

- **Doc identifier**: title-or-cuid auto-detect, matches `milestone show`.
- **Scope enum**: CLI exposes `personal` (PRIVATE) and `workspace` (WORKSPACE) only; `SHARED` stays in Web UI.
- **Project dimension**: `--project` flag, default null (consistent with `task create`).
- **Content input**: `--content`, `--file`, stdin; mutually exclusive; `--from-editor` deferred.
- **Bind semantics**: dedicated server endpoint + new `source` column on `DocumentMention`. Web's content-derived sync stays, but only manages `source = CONTENT` rows.
- **Content format**: CLI sends markdown; server converts. Round-trip via `show > update --file` is not promised.
- **Bind colliding with CONTENT row**: upgrade to EXPLICIT so unbind can later remove it.
- **PR shape**: single PR covering server + CLI + skill doc, consistent with the milestone CLI PR (LUM-65).

## Out of scope

- `--from-editor` (interactive $EDITOR). Defer.
- Doc tree (`parentId`) operations from CLI. Defer; create at root only.
- Doc tags from CLI. Defer.
- Public sharing (`publicToken`) from CLI. Defer.
- `DocumentShare` (SHARED visibility) from CLI. Defer.
- Lossless markdown round-trip. The CLI is a read/edit helper, not a doc format conversion tool.
