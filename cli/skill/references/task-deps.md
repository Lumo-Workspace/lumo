# Task Dependencies (`lumo task dep …`)

Hard dependency edges between tasks — manual declarations plus auto-detected candidates a human confirms or dismisses. For core task CRUD, see [tasks.md](tasks.md).

## `lumo task show <LUM-N> --deps` — show all dependency edges

Reading the edges is an aspect of `task show` (LUM-1233; `task deps list` was removed). `--json` puts `{ version, dependencies, total, nextCursor, task }` (each edge with its full id) under the envelope's `deps` key.

Prints the task's dependency edges grouped into three sections: **CONFIRMED**, **SUGGESTED (pending confirmation)**, and **DISMISSED**. Each row includes a short 8-character edge id in square brackets, the direction (`blocked by` / `blocks`; for a `DUPLICATES` edge recorded by `task update --status canceled --duplicate-of`, `duplicate of` / `duplicated by` — LUM-1282), the other task's identifier and title, the other task's current status, the source (`MANUAL` or `DETECTED`), and inline evidence for detected edges.

```bash
lumo task show LUM-42 --deps
```

Example output:

```
Dependencies for LUM-42 (3)

CONFIRMED
  [a1b2c3d4] blocked by LUM-9 "Fix auth token expiry" IN_PROGRESS · MANUAL

SUGGESTED (pending confirmation)
  [e5f6a7b8] blocks LUM-55 "Migrate DB schema" TODO · shared_files(4 shared files: src/db/schema.ts, src/db/migrate.ts, ...)
      confirm: lumo task dep confirm LUM-42 e5f6a7b8 (add --reverse if direction is flipped; false positive: dismiss)
  [c9d0e1f2] blocked by LUM-38 "Add OAuth scopes" IN_REVIEW · task_mention(description)
      confirm: lumo task dep confirm LUM-42 c9d0e1f2 (add --reverse if direction is flipped; false positive: dismiss)

DISMISSED
  [b3c4d5e6] blocks LUM-12 · dismissed
```

CONFIRMED and SUGGESTED rows show the other task's identifier, title, current status, and source/evidence. DISMISSED rows render as `[shortId] <direction> <identifier> · dismissed` only. When there are no edges at all the output is `Dependencies for LUM-42: no dependency edges.`

**Evidence fields by detection signal:**

- `shared_files` — `shared_files(N shared files: path1, path2, …)` — number of shared write-touched files in the 14-day window, plus up to 5 sample paths.
- `task_mention` — `task_mention(description)` or `task_mention(comment)` — the surface where the mention appeared.

CONFIRMED rows also show `source`: `MANUAL` (user-declared via `deps add`) or `DETECTED` (auto-found then confirmed via `deps confirm`).

## `lumo task dep add <LUM-N> --blocked-by <LUM-M>` — declare a manual hard dependency

Asserts that LUM-N is blocked by LUM-M. The edge is created as CONFIRMED + MANUAL — immediately in effect (no confirmation step). Both `<LUM-N>` and `--blocked-by` are required.

```bash
lumo task dep add LUM-42 --blocked-by LUM-9
```

**Service semantics (read before using):**

- **Self-edge** → 400 ("A task cannot depend on itself").
- **CONFIRMED edge in the same direction already exists** → 409 ("Dependency already exists").
- **CONFIRMED edge in the reverse direction already exists** → cycle guard fires, 409 ("Dependency would create a cycle").
- **Pair has a SUGGESTED or DISMISSED edge** in the same direction → `add` confirms it in place, preserving the original DETECTED source. No new row is created.
- **Cycle guard** — a DFS over all CONFIRMED BLOCKS edges in the workspace runs before writing; a would-be cycle → 409.

## `lumo task dep confirm <LUM-N> <edge> [--reverse]` — confirm a detected candidate

Promotes a SUGGESTED edge to CONFIRMED. `<edge>` is a selector for the specific edge on LUM-N's edge list.

```bash
lumo task dep confirm LUM-42 e5f6a7b8           # confirm as detected direction
lumo task dep confirm LUM-42 LUM-55              # selector by other task's identifier
lumo task dep confirm LUM-42 e5f6a7b8 --reverse  # flip direction before confirming
```

**Edge selector semantics** (shared by `confirm`, `dismiss`, `rm`):

- **Other task's identifier** (e.g., `LUM-55`) — case-insensitive exact match against the edge's other-task identifier. Resolves when there is exactly one edge to that task.
- **Edge-id prefix** — at least 6 characters of the short id (e.g., `e5f6a7`). Must match exactly one edge.
- Zero or more than one match → prints all candidate edges with short ids and exits 1. Retry with a more specific selector.

**`--reverse` semantics:** the detector's direction heuristic is best-effort. If the suggested direction is backwards, confirm with `--reverse` to flip before writing. The service checks the reversed pair has no existing edge (→ 409) and re-runs the cycle guard with the flipped direction.

## `lumo task dep dismiss <LUM-N> <edge>` — dismiss a candidate (immune to re-detection)

Marks the edge DISMISSED. The row is kept in the database — this is the key difference from `rm`. Because the row exists (in either direction), the detection service will never re-suggest this pair.

```bash
lumo task dep dismiss LUM-42 e5f6a7b8
# Dismissed dependency [e5f6a7b8] LUM-38 "Add OAuth scopes" (won't be suggested again)
```

Use `dismiss` for false positives. Use `rm` only when you want the pair eligible for re-detection again.

## `lumo task dep remove <LUM-N> <edge> --confirm` — delete an edge

Hard-deletes the edge row. Without `--confirm` it resolves the edge, then exits **4** with a confirmation envelope describing it (`Will delete dependency edge [a1b2c3d4] from LUM-42: blocked by LUM-9 "…" (CONFIRMED, manual)`) and sends nothing — relay `changes` to the user and re-run the envelope's `confirmCommand` on approval (see [confirmation.md](confirmation.md)). `--yes` is a legacy alias of `--confirm`.

```bash
lumo task dep remove LUM-42 a1b2c3d4            # exit 4 + envelope, nothing deleted
lumo task dep remove LUM-42 a1b2c3d4 --confirm  # after the user approved
# Removed dependency [a1b2c3d4] from LUM-42
```

**`rm` vs `dismiss`:** deleting removes the immunity — the detection service may re-suggest this pair on the next shared-files sweep or task-mention event. Prefer `dismiss` for detection false positives; use `rm` to fully erase an incorrectly-declared MANUAL edge.

## Detection red lines

- The detection service **never creates CONFIRMED edges automatically**. All auto-detected candidates are SUGGESTED; a human must `confirm` or `add` for an edge to become CONFIRMED.
- **Dismiss is pair-wise immunity**: once any edge exists between A and B (either direction, any status including DISMISSED), the detector won't create a new candidate for that pair.
- **`rm` lifts the immunity**: after deleting the only edge between A and B, the detector may re-suggest them.

## Detection signals

- **`task_mention`**: fires when a task's description is updated or a comment is created. If the updated HTML @-mentions other tasks, the mentioning task is recorded as depending on the mentioned task (direction heuristic: mentioner blocked by mentioned). Triggers immediately on write events; no cron.
- **`shared_files`**: hourly cron sweep over write-tool hook events in the past 14 days. For every pair of open (non-DONE) tasks sharing **≥ 3 written files**, a SUGGESTED edge is created (direction heuristic: older task blocks newer). Edges are never created across workspaces.

## When to suggest `task dep` commands

- **After `session attach` output shows a blocker warning or candidate-count hint** → `lumo task show <LUM-N> --deps`, then `confirm` / `dismiss` each SUGGESTED candidate.
- **User says "X needs to wait for Y" / "LUM-42 is blocked by LUM-9"** → `lumo task dep add LUM-42 --blocked-by LUM-9`.
- **Agent sees a `## ⚠ Dependency alerts` block (form A — live blockers) at session-start** → evaluate whether to wait for the blocker to merge; clean stale/wrong edges with `deps rm` / `deps dismiss`.
- **Agent sees only a standalone hint `Detected N candidate dependencies awaiting confirmation…` (form B)** → no immediate blocker, but run `task show --deps` to review and confirm/dismiss. See [sessions.md](sessions.md) for the full alert format.
- **User reports a false positive** → `lumo task dep dismiss <LUM-N> <edge>`.
