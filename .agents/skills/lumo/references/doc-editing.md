# Editing live documents

Commands for **reading a faithful edit base and writing back surgically** — the safe way to edit live docs (registers, ledgers, reports) without flattening tables or clobbering concurrent edits. For document CRUD, sharing, and import, see [docs.md](docs.md) (it also documents the shared **content channels** — `--content` / `--file` / stdin — and the **compact-tables authoring convention**, which apply equally to `doc patch` / `doc append`).

**The red line:** never treat rendered `doc show` output as a re-uploadable source — HTML→markdown is lossy and flattens tables. The only legal edit base is `doc show --raw` / `--section`, which print the byte-identical stored `sourceMarkdown`.

## `lumo doc show <doc> [--raw | --section <heading>]` — print one document's detail

Default mode prints a key:value header (id, title, scope, project, created/updated, **revision**, mentioned tasks) and the content rendered back to markdown. `Revision:` is the body's optimistic-concurrency counter — feed it back as `--if-revision` on `doc update` / `doc patch` / `doc append`.

```bash
lumo doc show "RFC: doc CLI"
lumo doc show cmd_xxx --raw > base.md            # byte-identical edit base (revision on stderr)
lumo doc show cmd_xxx --section "D 状态表" > sec.md  # one section only (revision on stderr)
```

**`--raw`** prints the byte-identical markdown source of the last markdown upload — no header, no trailing newline added. The server stores the raw markdown (`sourceMarkdown`) alongside the rendered HTML on every markdown write (`doc create/update --content/--file/stdin`, gdoc import/sync), so `--raw` output IS a legal edit base: `doc show --raw > base.md`, edit, `doc update --file base.md` round-trips losslessly.

- A web-editor (HTML-direct) edit or revision restore **invalidates** the stored source — the doc's markdown source is gone until the next markdown upload.
- When no source is stored (legacy doc or after an HTML edit), `--raw` **fails with exit 1 and a rebuild hint** — it never silently falls back to the lossy HTML→markdown reverse render. Rebuild flow: run **`lumo doc rebuild-source <doc>`** — it regenerates the source from the stored HTML with a lossless serializer (tables round-trip) and a structure guard, so `--raw` works from then on.
- Raw output is verbatim (unsanitized) by design — redirect it to a file rather than reading it in a terminal when the doc's provenance is uncertain.

Note: the markdown rendered by **default-mode** `doc show` is still best-effort (tables flatten). Round-trip via `doc show > tmp.md && doc update --file tmp.md` is NOT a no-op — use `--raw` as the edit base instead.

Output budget: **default-mode** `doc show` caps the rendered body to the output-token budget (25,000 tokens) and, when truncated, ends in a pointer to `--section "<heading>"` / `--raw`. `--raw` and `--section` are **never** capped — they are byte-faithful edit bases.

**`--section <heading>`** prints just one heading-addressed section of the markdown source — a byte-faithful slice from the heading line through (not including) the next same-or-higher-level heading, subsections included. No header on stdout (the slice is a legal `doc patch` base); the current revision is printed to **stderr** as `Revision: N`. Mutually exclusive with `--raw`.

- Section addressing: pass the heading text (`--section "D 状态表"`), matched in three tiers — exact, then case-insensitive, then full-width↔half-width punctuation + whitespace normalization, so a half-width query (`问题(P4)`) lands on a full-width stored heading (`问题（P4）`) and vice-versa. Prefix with `#…` to pin the level when the same text exists at several depths (`--section "## Status"`). Normalization never relaxes the ambiguity guard — multiple matches still give the candidate list + exit 1.
- Missing heading → exit 1 listing the available headings; ambiguous heading → exit 1 with a depth-disambiguation hint.
- Requires a stored markdown source — same no-fallback rule and rebuild flow as `--raw`.
- Heading detection is markdown-aware: `#` lines inside fenced code blocks or blockquotes are never section boundaries.

Use default mode to read a doc; `--raw` whenever the full output will be edited and uploaded back; `--section` when only one part matters (keeps the context window small and the patch radius smaller).

### When to suggest `doc show --raw` / `--section`

- Before any `doc update --file` that starts from existing remote content — fetch the base with `--raw`, never from rendered `doc show` output.
- Before a `doc patch` — read the section with `--section` first, note the `Revision:` line, edit, patch back with `--if-revision`.
- User asks "what's the exact source of this doc", or an agent needs a faithful local copy of a live doc.
- User asks "what's in section X" of a long doc — `--section` avoids pulling the whole body into context.
- If `--raw`/`--section` errors (no stored source), run `lumo doc rebuild-source <doc>` to regenerate it losslessly, then retry — don't edit the rendered output.

## `lumo doc patch <doc> --section <heading>` — replace one section

Replaces the **whole addressed section** (heading line included, subsections included) with the provided content, server-side, leaving every byte outside the section untouched. The new content comes from `--content`, `--file`, or piped stdin (one required; `--file` is sandboxed like `doc update`).

| Flag                  | Type    | Notes                                                                                                       |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `--section <heading>` | string  | Required. Heading text addressing the section; prefix `#…` pins the depth.                                  |
| `--content <text>`    | string  | New section content (include the heading line — the whole section is replaced verbatim).                    |
| `--file <path>`       | string  | New section content from file (project-local sandbox).                                                      |
| `--if-revision <n>`   | int     | Only apply if the body is still at revision `n`. Recommended whenever the edit base was read earlier.       |
| `--allow-shrink`      | boolean | Let the patch through even when it drops tables/rows/headings within the addressed section (422 otherwise). |

Concurrency: the splice always commits **conditionally** on the revision the server read the source at — even without `--if-revision`, a concurrent body edit between read and write returns 409 instead of clobbering. On 409 the CLI prints the server reason plus a re-read-and-retry hint and exits 1.

Structure guard, **scoped to the addressed section**: a replacement whose render has fewer `table`/`tr`/heading elements than the old section's render is rejected with 422 naming each shrunk category (old→new counts); structure elsewhere in the document never factors in. Dropping the heading line itself trips the guard too. Pass `--allow-shrink` when the deletion is intentional. `doc append` is pure insertion and is never guarded.

Requires a stored markdown source (same rule as `--raw`); errors with the rebuild hint otherwise.

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

## `lumo doc append <doc> [--section <heading>]` — append to a section (or the doc)

Inserts the new content at the **end of the addressed section** (just before the next same-or-higher-level heading), or at the end of the document when `--section` is omitted. Pure insertion: no pre-existing byte is modified, which makes it the natural write for running logs, ledgers and queues. Content channels and sandbox are the same as `doc patch`; separator blank lines are added automatically.

| Flag                  | Type   | Notes                                                                        |
| --------------------- | ------ | ---------------------------------------------------------------------------- |
| `--section <heading>` | string | Optional. Omit to append at the document end.                                |
| `--content <text>`    | string | Content to append.                                                           |
| `--file <path>`       | string | Content from file (project-local sandbox).                                   |
| `--if-revision <n>`   | int    | Only apply if the body is still at revision `n`; 409 + retry hint otherwise. |

Same concurrency contract as `doc patch` (always a conditional commit; 409 on conflict). **End-of-document append (no `--section`) does NOT require a stored markdown source**: when the source is missing (web HTML edit / revision restore / legacy doc) it renders the new block to HTML and concatenates it onto the stored HTML body — so one web operation can no longer lock the whole doc against the agent write path. The source stays null (the doc is still HTML-only afterward; `--raw`/`--section`/`doc patch` keep erroring with the rebuild hint). **Section-addressed append (`--section`) still requires a stored source** — it needs the markdown to locate the heading boundary.

```bash
lumo doc append cmd_xxx --section "F 待办队列" --content "- [ ] 评估 XYZ 论文"
# → Appended to cmd_xxx "登记册" § "F 待办队列"  revision 8
echo "## 2026-06-10\n吸收了 3 篇" | lumo doc append cmd_xxx   # document end
```

### When to suggest `doc append`

- User wants to add an entry/row/log line to a section ("把 X 加进待办队列", "append today's notes") — this is the killer op for ledger-style live docs: zero clobber risk by construction.
- Whenever the alternative would be re-uploading the whole doc just to add lines at the end of one section.

## `lumo doc diff <doc> --file <local.md>` — compare remote markdown source vs a local file

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

## `lumo doc rebuild-source <doc>` — regenerate the markdown source from the HTML body

The **recovery path for a source-less doc**. When a doc has no stored `sourceMarkdown` — a web HTML-direct edit or revision restore nulled it, or the doc predates source storage — every markdown write path (`--raw`, `--section`, `doc patch`, `doc append --section`, `doc diff`) is locked. This regenerates a valid source by serializing the **stored HTML structure model** back to markdown with a **lossless serializer that round-trips tables/rows/headings** (the default `doc show` render flattens tables, so it was never a safe rebuild base). Only the `sourceMarkdown` column is backfilled; the rendered body is untouched, so the doc reads identically and you just regain the edit base.

| Flag                | Type    | Notes                                                                                                                                                                                                       |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--allow-shrink`    | boolean | Commit even if the rebuilt source re-renders with fewer tables/rows/headings than the stored body (default: 422 reject).                                                                                    |
| `--force`           | boolean | Re-derive even when a source already exists. Without it an existing source yields exit 4 + a confirmation envelope whose `confirmCommand` carries `--force --confirm` ([confirmation.md](confirmation.md)). |
| `--confirm`         | boolean | The user approved replacing the existing source; pair it with `--force` as the envelope instructs.                                                                                                          |
| `--if-revision <n>` | int     | Only apply if the body is still at this revision (from `doc show`).                                                                                                                                         |

The rebuild is **structure-guarded** (the same guard as `doc update`/`doc patch`): if the serializer would drop any table/row/heading, it is rejected with **422** rather than silently committing a flattened source — `--allow-shrink` is the explicit escape hatch. A doc that already has a source is refused by the server (409); the CLI turns that refusal into a **confirmation envelope** (exit 4, `changes` = the server's reason + what `--force` would replace) so the user sees it before anything is overwritten.

```bash
lumo doc rebuild-source cmd_xxx                    # restore a source-less doc; --raw works after
lumo doc rebuild-source cmd_xxx                    # source exists → exit 4 + envelope, nothing written
lumo doc rebuild-source cmd_xxx --force --confirm  # re-derive after the user approved the envelope
```

### When to suggest `doc rebuild-source`

- A `--raw` / `--section` / `doc patch` / `doc diff` call errored with "no stored markdown source" — rebuild, then retry. This is the first thing to try, not a manual reconstruction.
- A table-heavy live doc (e.g. a `docs/live-docs/` registry) lost its source after a web operation and the markdown write path is locked.
- Do **not** run it on a doc that already has a good source unless the user explicitly wants to re-derive it (then re-run the envelope's `confirmCommand`, i.e. `--force --confirm`) — it replaces the byte-faithful source with a serializer-derived one.

## Out of scope (CLI v1)

- Lossless markdown round-trip from **rendered** `doc show` output (use `doc show --raw` — lossless whenever a markdown source is stored).
- `--from-editor` (interactive $EDITOR).
