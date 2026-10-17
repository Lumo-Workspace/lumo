# Memory Management

## Memory management

Record and curate the long-term Memory that Claude reads on future sessions.
Memories are scoped **TASK** (useful only for one task) or **PROJECT** (useful
across the whole project). Automated extraction (layer1) and promotion (layer2,
on task→done) already run; these commands are the manual override. A third,
**MILESTONE** scope is written automatically only (no manual command): when a
milestone closes and its retro is generated, the durable forward-looking
learnings are distilled into MILESTONE-scope memories and injected at the next
milestone's steward session start (LUM-647) — see [sessions.md](sessions.md).

### Commands

```bash
# List
lumo task memory list [LUM-N] [--category trap|decision|convention|procedural] [-n N]   # ID  SCOPE  CATEGORY  SOURCE  HEADLINE (TAB-separated when piped)
lumo project memory list [<project>] [--category ...] [-n N]

# Add (per-category fields; <task>/<project> default to the session-bound task)
lumo task memory add [LUM-N] --category trap --trigger "..." --outcome "..." [--workaround "..."] [--agent <agent>]
lumo task memory add [LUM-N] --category decision --what "..." --why "..." [--alternatives "..."] [--implications "..."] [--agent <agent>]
lumo task memory add [LUM-N] --category convention --rule "..." --applies "..." [--agent <agent>]
lumo task memory add [LUM-N] --category procedural --workflow "..." --trigger "..." [--step "..." --step "..."] [--agent <agent>]
lumo project memory add [<project>] --category convention --rule "..." --applies "..." [--agent <agent>]   # same per-category flags as task memory add; records at PROJECT scope

# --agent values: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)
# Aliases: gemini → gemini-cli, copilot → github-copilot (case-insensitive)
# Omitting --agent records the memory as produced by Claude Code.

# Single-memory ops (<memory> = the 8-char ref in `... memory list` column 1 and
# in session-start index lines; a unique id prefix of 6+ chars or the full id also work)
lumo memory show <memory>          # show one memory's full card
lumo memory promote <memory>       # TASK → PROJECT
lumo memory rm <memory> --confirm  # hard delete (without --confirm: exit 4 + envelope)

# Downsync team memory into the local Claude Code memory store
# (Claude Code only: in a Codex shell `memory sync` / `memory push` exit 1 unless --dir is given — Codex never reads this store)
lumo memory sync                   # write team/<id>.md + a managed MEMORY.md block
lumo memory sync --dry-run         # preview the reconcile plan, write nothing
lumo memory sync --project <ref>   # target a specific project (default: bound session)
lumo memory sync --clean           # remove everything sync owns (full rollback)
lumo memory sync --no-anchor-check # skip the post-sync code-anchor staleness check

# Upsync locally-authored memories to the team (reverse direction)
lumo memory push                   # promote <memory-dir>/outbox/*.json to the team
lumo memory push --dry-run         # list what would be pushed without sending

# Topic folding — autonomous (daily cron); the CLI is the read-only preview only
lumo memory fold --dry-run         # preview the next auto-fold pass; writes nothing
```

`--json` on `task memory list` / `project memory list` prints `{ version, memories, total, nextCursor }` (`total` counts the filtered list before `-n` cuts it; these lists have no cursor, so `nextCursor` is always `null` — `total` larger than the rows shown means `-n` cut it: raise `-n` for the rest); `memory show --json` prints `{ version, memory }` (full id, category, raw content).

When the session is bound (`lumo session attach <LUM-N>`), omit the identifier:
`lumo task memory add --category trap --trigger ... --outcome ...` records onto
the bound task; `lumo project memory add ...` records onto its project.

Real calls (memory fields are structured per category — there is **no**
`--content` flag):

```bash
# Minimal — session bound, identifier omitted
lumo task memory add --category trap --trigger "npx tsc --noEmit passes locally but CI fails on exactOptionalPropertyTypes" --outcome "PR goes red after merge"
lumo project memory add --category convention --rule "CLI tag-modify commands print a final 'Tags:' line" --applies "lumo doc/task create and update"

# Full form — explicit identifier, all optional fields
lumo task memory add LUM-42 --category decision --what "Store doc content as Tiptap-serialized HTML" --why "markdown-to-JSON and markdown-to-HTML paths drifted" --alternatives "store Tiptap JSON" --implications "all markdown input goes through markdownToHtml" --agent claude-code
lumo project memory add lumo --category procedural --workflow "Sync locale files after a copy change" --trigger "any lib/i18n/en.json change" --step "npm run i18n:sync" --step "npm run i18n:check" --agent claude-code

# Curate
lumo memory show kp5brom5
lumo memory promote kp5brom5
lumo memory rm kp5brom5 --confirm
```

`memory rm` is gated by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` it fetches the card and exits **4** with an envelope (`Will hard-delete memory <ref> [TRAP]` · `Content: <first line>` · no undo) and deletes nothing. Show that to the user first; `--yes` is a legacy alias of `--confirm`.

### `lumo memory show <memory>` (progressive disclosure)

Fetches one memory's full card from the server and prints it as a detail view
(LUM-1232): `<short ref>  <summary or headline>`, a `Type:  TRAP` row, then
one section per content field (`What`, `Why`, `Trigger`, `Outcome`, `Steps` as
bullets, …) — never raw JSON.

- **Arg**: `<memory>` (required) — the 8-character short ref you saw in
  `... memory list` column 1, in a session-start index line (`· kp5brom5` /
  `→ lumo memory show kp5brom5`), in `task show --lineage` or `workspace learnings`.
  The short ref is the id's last 8 characters (its random part — leading
  characters are a timestamp shared by memories created together). A unique id
  prefix of 6+ characters or the full id (old scripts) also work. Without the
  arg the command errors with a usage line and exits 2 (usage error).
- **Errors**: not-logged-in (run `lumo auth login`), `401` invalid/revoked key,
  no match in your workspace (cross-workspace refs never match), a ref shorter
  than 6 characters, or an **ambiguous** ref — the error lists every candidate
  (full id + category) and nothing is picked; re-run with one of them. Other
  non-2xx → generic HTTP error; all exit 1. `promote` and `rm` resolve the
  same way. `--json`-style raw payloads keep the full id.

**When to suggest**: at session start memories arrive as one-line index entries.
When a specific entry looks relevant to the task at hand, run
`lumo memory show <ref>` to pull its full body before acting on it — read the
detail on demand instead of carrying every memory's content in context.

### `lumo memory sync` (downsync to local Claude Code memory)

Writes the team's project memory into the dev's local Claude Code memory store so
Claude Code's **native recall** surfaces it — the direction chosen over
per-session `<untrusted-team-memory>` injection. This runs **alongside** the
existing injection, so during the transition both paths are active and overlap is expected, not a bug.

- **Where it writes**: `~/.claude/projects/<encoded-cwd>/memory/` — team files as
  `team/<memoryId>.md` (YAML frontmatter + a `metadata.lumo` ownership marker),
  plus a delimited `<!-- lumo:team-memory:start/end -->` block in `MEMORY.md`.
  `--dir <path>` overrides the resolved directory.
- **Only touches what it owns**: a file is owned only if its frontmatter carries
  `metadata.lumo.source: team`. Your own hand-written memory files and any
  `MEMORY.md` lines outside the managed block are **never** read or written.
- **Mirrors the whole project**: the bundle is the project's **full
  ACTIVE memory set** — every dev in the project gets the same corpus, regardless
  of how many active tasks they hold. There is **no** task-level routing/relevance
  filter and **no** token-budget cap on the corpus at sync time: sync only writes
  local files (no tokens, no conversation), so "which memory is relevant" is left
  to Claude Code's native recall, not decided at sync. Judge-used 履历
  still orders the resident index (so the most-proven memories list first) but
  never drops anything. Relevance/budget gating remains only on the **injection**
  path (`lumo task show --full` / session-start), which does spend tokens.
- **Project-level routing only**: you still don't sync a project you're not a
  member of — that's the API route's workspace authorization. Within a project,
  everyone gets the full set.
- **Reconcile / drift**: re-running is idempotent. A team file you edited locally
  is detected (its on-disk hash diverged from the recorded `contentHash`) and
  **skipped, never overwritten** — your edit is preserved and flagged as an
  upsync candidate (the reverse direction is a later phase).
- **Reversible**: `--dry-run` prints the add/update/remove/drift-skip plan without
  writing; `--clean` removes every owned file + the managed block (full rollback).
- **Code-anchor staleness check**: after downsync, each synced memory's
  code anchors (file paths, and backtick-wrapped symbols/flags) are checked against
  this repo — resolved against **git-tracked** files (`git ls-files`) + exact
  word-boundary grep, never the dirty working tree. A memory whose **every** anchor
  is gone is reported to the server as a `stale-anchor` retire candidate (with the
  dead anchors as evidence), feeding the P4a human-review retire pool. High-precision
  by design: any surviving anchor spares the memory, and reporting never archives
  anything — a human confirms retirement on the web. Skipped on `--dry-run` / `--clean`,
  or with `--no-anchor-check`; a detection failure never fails the sync.
- **Project**: resolved from the bound session unless `--project <ref>` is given.

**When to suggest**: when a dev wants the team's accumulated memory available to
Claude Code's native recall in their working copy (instead of, or in addition to,
session-start injection) — run `lumo memory sync` in the project. Suggest
`--dry-run` first to confirm the resolved directory and plan, and `--clean` to
back the change out.

### `lumo memory push` (upsync to the team)

The reverse of `sync`: promote memories a dev authored locally up to the team
store. Each candidate is a JSON file in `<memory-dir>/outbox/` shaped
`{ "category": "convention", "content": { ... } }` (the same per-category content
shape as `lumo project memory add`). `push` POSTs each to the **existing**
create-project-memory endpoint, so it runs through the same canonicalize → dedup →
**reconcile-on-write** pipeline — no parallel upsync path — and a
successful push removes the file from the outbox.

- **Scope**: structured local memories (the lossless path). A team file you edited
  locally is rendered markdown that cannot be reversed back to structured content,
  so those (P1 drift candidates) are **reported** by `lumo memory sync`, not
  auto-promoted — re-express the improvement as an outbox entry or via
  `lumo project memory add`.
- **Project**: resolved from the bound session unless `--project <ref>` is given.
- `--dry-run` lists what would be pushed without sending.

**When to suggest**: when a dev has captured a reusable lesson locally and wants it
shared with the team — drop a `{category, content}` JSON in the memory `outbox/`
and run `lumo memory push` (or just use `lumo project memory add` for a one-off).

### Automatic sync/push triggers

Both directions also fire automatically, best-effort — a failure never blocks the
session or command:

- **Downsync** runs on `lumo session attach` (throttle-gated, default 12h; see
  [sessions.md](sessions.md)). Manual `lumo memory sync` stays unthrottled.
- **Upsync** runs on the `session-end` / `stop` / `task-completed` lifecycle hooks:
  a non-empty `<memory-dir>/outbox/*.json` is drained via the same
  create-project-memory pipeline as `lumo memory push`. An **empty outbox does zero
  network** (the fast path checked first), so the high-frequency `stop` hook stays
  cheap.
- **Env vars**: `LUMO_SYNC_THROTTLE_HOURS` (downsync throttle window, default 12),
  `LUMO_DISABLE_MEMORY_AUTO=1` (disable **both** auto-paths). The `--no-anchor-check`
  flag on `lumo memory sync` is unchanged.

### `lumo memory fold [project-ref] --dry-run` (topic folding — read-only preview)

Topic folding is the **third** memory-consolidation operation (orthogonal to P5
near-dup merge and P4 retire): it clusters a project's ACTIVE PROJECT memories by
**subsystem/theme** (related-but-not-duplicate fine cards — e.g. several Prisma
gotchas, several jest gotchas), synthesizes **one coarse "subsystem card"** per
cluster that preserves every source card's invariant/gotcha, and supersedes the
covered sources into it (失效非删, reversible). Folding **runs autonomously** on a
daily cron with **no human review** — a fail-closed machine coverage gate decides
which sources are safe to fold (a source is only superseded if a judge confirms,
with a verbatim quote, that its actionable detail is present in the coarse card).
There is **no manual apply and no `unfold`** — to correct a coarse card, edit it in
the web Memory tab; superseded sources are preserved.

The CLI exposes only a **read-only `--dry-run` preview** (bare `lumo memory fold`
without `--dry-run` just prints that folding is automatic). It prints each proposed
coarse card + how many fine cards it would fold / leave ACTIVE. Defaults to the
session-bound project; pass `[project-ref]` for another.

- `--dry-run` is required for the preview (writes nothing; the actual folding only
  ever runs server-side in the daily cron).

**When to suggest**: when a project's PROJECT memory is "又多又细" (many fine-grained
but non-duplicate cards bloating the resident MEMORY.md index) and you want to see
how the next auto-fold pass would collapse it.

### Reconcile-on-write & deduplication

`memory add` does **not** unconditionally insert a new row. Before writing it:

1. Retrieves the nearest existing memories in the store (embedding similarity).
2. If a near-duplicate is found — including a **cross-language match** (e.g. you
   supply content in Chinese but an equivalent English memory already exists) —
   an LLM decides the outcome; otherwise the new memory is inserted directly.

The command prints **one** of these outcome lines:

| Output line                                                      | Meaning                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `Added <CATEGORY> <SCOPE> memory …`                              | No near-duplicate found; stored as a new row.                                            |
| `Merged into existing memory <id> (near-duplicate) …`            | Near-duplicate found; the existing row was refined/updated in-place (UPDATE).            |
| `Superseded an existing memory; new version <id> …`              | New content contradicts an old memory; old row invalidated, new row created (SUPERSEDE). |
| `Skipped — duplicate of existing memory <id>, nothing written …` | Exact or near-exact duplicate; no write performed (NOOP).                                |

Content is **always normalized to English** before storing — the memory store has
a single canonical language. If you supply text in another language the CLI
translates it automatically; the stored memory will be in English.

### The write gate — what gets refused (LUM-793)

Memory is the one agent-writable store that is re-injected into **every** future
session, so the content checks run at **write** time, not only at injection
time. Every path — `memory add`, `memory push`, the web form, `PATCH
/api/memories/<id>`, and the LLM curation / fold passes — goes through the same
gate. A refusal is a **422** with the matched sentence quoted; nothing is
stored. Three reasons:

| Reason             | What trips it                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `INJECTION_SIGNAL` | An imperative aimed at the model, text hidden in a comment, or a long encoded blob.                               |
| `AGENT_DIRECTIVE`  | A **standing order to future agents** — "from now on you must …", 「以后每次…都要…」 — rather than a description. |
| `POLICY_CONFLICT`  | The text permits what a deterministic, blocking CLAUDE.md rule forbids; the message names the rule id.            |

What does **not** trip it: ordinary imperative PROCEDURAL steps ("Run `lumo
verify` when done", "All tests go in `__tests__/`"), or invisible characters /
`javascript:` links — those are still stored and marked on the row, exactly as
LUM-783 does for every other source card.

**If a write is refused, rewrite the memory as a description of what happens**
(what the trap is, what the convention is) instead of an instruction to whoever
reads it next. Do not try to smuggle the same sentence past the gate.

`lumo memory rm` on a **TRAP** memory that other tasks were already judged to
have _used_ records a `USED_TRAP_MEMORY_DELETED` boundary crossing against the
bound task (it blocks DONE until dispositioned). Correct or retire such a memory
rather than deleting it; deleting a never-used memory records nothing.

### Lumo memory vs the harness memory tool

Claude Code / the Claude API may expose a file-based **memory tool** (a
`/memories` directory the model writes autonomously). That store is the agent's
private scratchpad — un-grounded, free-form, invisible to the team, and outside
Lumo's flywheel. **Project engineering lessons always go through `lumo task/project
memory add`** — never record them only in the harness memory tool, and never bulk-copy
harness memory files into Lumo memory (they are ungrounded drafts; Lumo's
extract→ground→reconcile write path is the only vetted entry). The two stores are
layered, not mirrored: transient working notes may live in the harness tool,
durable team knowledge lives in Lumo memory.

### When to record a memory (worthiness)

Record only knowledge that is **invisible in the codebase** — the _why_ behind a
choice, a gotcha that only surfaces at runtime, a rule that lives in people's
heads, a non-obvious failure cause, a non-trivial workflow. **Skip** routine work
(reading files, plain edits, normal git, successful builds) and anything a
developer could learn from the source, git log, or docs. When unsure, don't.

### Which category

- `trap` — a pitfall. Describe the problem (`--trigger`, `--outcome`); put a **one-line fix** inline via `--workaround`. Only when the fix is a genuine multi-step workflow, omit `--workaround` and add a separate `procedural` instead — never both (a `procedural` that just restates a trap's `--workaround` is a double-write).
- `decision` — an engineering decision (`--what` + `--why`, optional `--alternatives`/`--implications`).
- `convention` — a team rule (`--rule` + `--applies` = where it applies).
- `procedural` — a reusable workflow (`--workflow` + `--trigger` + `--step`…).

### TASK vs PROJECT (at add time)

Default to **TASK** (`lumo task memory add`). Record directly to **PROJECT**
(`lumo project memory add`) only when it helps _any_ task in the project: a
toolchain/environment trap, a team-wide convention, a cross-task decision. When
unsure → TASK.

### When to promote (TASK → PROJECT)

`lumo memory promote <ref>` only when the lesson **recurs across 2+ different
tasks**, would help a _different_ task, and no equivalent PROJECT memory exists.
A wrong promotion is costly (every agent sees it forever) — prefer leaving it at TASK.

### When to reach for this

After a non-trivial debugging session, a pitfall you hit, or establishing a
convention → consider `lumo task memory add`. When you notice a lesson recurring
across multiple tasks → consider `lumo memory promote`.
