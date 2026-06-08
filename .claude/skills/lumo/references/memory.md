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
lumo project memory add [<project>] --category ... [--agent <agent>]   # same flags; records at PROJECT scope

# --agent values: claude-code | codex | cursor | gemini-cli | github-copilot | windsurf (default claude-code)
# Aliases: gemini → gemini-cli, copilot → github-copilot (case-insensitive)
# Omitting --agent records the memory as produced by Claude Code.

# Single-memory ops (memoryId from `... memory list` column 1)
lumo memory promote <memoryId>     # TASK → PROJECT
lumo memory rm <memoryId> --yes    # hard delete
```

When the session is bound (`lumo session attach <LUM-N>`), omit the identifier:
`lumo task memory add --category trap --trigger ... --outcome ...` records onto
the bound task; `lumo project memory add ...` records onto its project.

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
