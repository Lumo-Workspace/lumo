# Memory Management

## Memory management

Record and curate the long-term Memory that Claude reads on future sessions.
Memories are scoped **TASK** (useful only for one task) or **PROJECT** (useful
across the whole project). Automated extraction (layer1) and promotion (layer2,
on task→done) already run; these commands are the manual override.

### Commands

```bash
# List
lumo task memory list [LUM-N] [--category trap|decision|convention|procedural] [-n N]
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

# Single-memory ops (memoryId from `... memory list` column 1)
lumo memory show <memoryId>        # show one memory's full card by id
lumo memory promote <memoryId>     # TASK → PROJECT
lumo memory rm <memoryId> --yes    # hard delete

# Downsync team memory into the local Claude Code memory store
lumo memory sync                   # write team/<id>.md + a managed MEMORY.md block
lumo memory sync --dry-run         # preview the reconcile plan, write nothing
lumo memory sync --project <ref>   # target a specific project (default: bound session)
lumo memory sync --clean           # remove everything sync owns (full rollback)
```

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
lumo project memory add lumo --category procedural --workflow "Regenerate the CLI grammar snapshot" --trigger "any cli/src/commands change" --step "npx tsx scripts/analysis/lum392-cli-friction/emit-grammar.ts" --step "npx jest scripts/analysis/lum392-cli-friction" --agent claude-code

# Curate
lumo memory show cmpi19iqabc123
lumo memory promote cmpi19iqabc123
lumo memory rm cmpi19iqabc123 --yes
```

### `lumo memory show <id>` (progressive disclosure)

Fetches one memory's full card by id from the server and prints its category tag
(`[TRAP]`, `[DECISION]`, `[CONVENTION]`, `[WORKFLOW]`, …) followed by the
structured `content` body (pretty-printed JSON).

- **Arg**: `<memoryId>` (required) — the id you saw in `... memory list` column 1
  or as a one-line index entry at session start. Without it the command errors
  with a usage line and exits 1.
- **Errors**: not-logged-in (run `lumo auth login`), `401` invalid/revoked key,
  `404` memory not found in your workspace (cross-workspace ids 404 too), other
  non-2xx → generic HTTP error; all exit 1.

**When to suggest**: at session start memories arrive as one-line index entries.
When a specific entry looks relevant to the task at hand, run
`lumo memory show <id>` to pull its full body before acting on it — read the
detail on demand instead of carrying every memory's content in context.

### `lumo memory sync` (downsync to local Claude Code memory)

Writes the team's project memory into the dev's local Claude Code memory store so
Claude Code's **native recall** surfaces it — the direction LUM-535/536 chose over
per-session `<untrusted-team-memory>` injection. This is P3 (the sync build); it
runs **alongside** the existing injection (retiring injection is LUM-540), so
during the transition both paths are active and overlap is expected, not a bug.

- **Where it writes**: `~/.claude/projects/<encoded-cwd>/memory/` — team files as
  `team/<memoryId>.md` (YAML frontmatter + a `metadata.lumo` ownership marker),
  plus a delimited `<!-- lumo:team-memory:start/end -->` block in `MEMORY.md`.
  `--dir <path>` overrides the resolved directory.
- **Only touches what it owns**: a file is owned only if its frontmatter carries
  `metadata.lumo.source: team`. Your own hand-written memory files and any
  `MEMORY.md` lines outside the managed block are **never** read or written.
- **Selection**: judge-used 履历 (LUM-539) ranks first, with relevance/cold-start
  grace as backfill, capped to the resident-index budget — so the local index
  stays compact.
- **Reconcile / drift**: re-running is idempotent. A team file you edited locally
  is detected (its on-disk hash diverged from the recorded `contentHash`) and
  **skipped, never overwritten** — your edit is preserved and flagged as an
  upsync candidate (the reverse direction is a later phase).
- **Reversible**: `--dry-run` prints the add/update/remove/drift-skip plan without
  writing; `--clean` removes every owned file + the managed block (full rollback).
- **Project**: resolved from the bound session unless `--project <ref>` is given.

**When to suggest**: when a dev wants the team's accumulated memory available to
Claude Code's native recall in their working copy (instead of, or in addition to,
session-start injection) — run `lumo memory sync` in the project. Suggest
`--dry-run` first to confirm the resolved directory and plan, and `--clean` to
back the change out.

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

`lumo memory promote <id>` only when the lesson **recurs across 2+ different
tasks**, would help a _different_ task, and no equivalent PROJECT memory exists.
A wrong promotion is costly (every agent sees it forever) — prefer leaving it at TASK.

### When to reach for this

After a non-trivial debugging session, a pitfall you hit, or establishing a
convention → consider `lumo task memory add`. When you notice a lesson recurring
across multiple tasks → consider `lumo memory promote`.
