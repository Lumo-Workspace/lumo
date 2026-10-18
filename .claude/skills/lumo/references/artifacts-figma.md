# Task Artifacts & Figma Designs

### Task ↔ Spec Artifacts

Record Claude Code spec-engineering products (spec / plan / design …) on a task. The artifacts show up in the task detail definition ("spec") layer and are injected into `lumo task show --full`.

#### `lumo task artifact add <task> --kind <kind> --title <title> --file <path> --source <source> --agent <agent>`

Attaches an artifact to a task. `--kind`, `--title`, `--source` are stored verbatim — **`kind` is opaque** (no enumeration; `spec` / `plan` / `requirements` / anything is accepted). `--source` is **required** and names the spec-generation framework that produced the artifact, written as its **formal name** (`Superpowers` / `Spec Kit` / `BMad` / `OpenSpec` / `GSD` / …) — it is also opaque (no enumeration), but there is **no default**, so you must pass it. Quote names that contain spaces (`--source "Spec Kit"`). `--file` supplies the body (file contents). Each call appends to the end of the task's artifact list — call once per artifact (e.g. Superpowers: one `spec`, one `plan`). The `<task>` (e.g. `LUM-42`) is resolved server-side. **`--file` is sandboxed:** the CLI rejects any path that resolves **outside the current project directory** (parent-traversal, absolute paths, escaping symlinks) or that matches a **sensitive-file denylist** (`.env*`, `id_rsa`/`id_ed25519`, `*.pem`/`*.key`, `.aws`/`.ssh` contents, `credentials`, `.npmrc`, …). There is no override flag — pass only project-local, non-secret files (e.g. `docs/spec.md`). To record an out-of-tree file, copy it into the project first.

`--agent` is **required** and names the coding tool that produced the artifact (enum). Valid values: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers --agent claude-code
lumo task artifact add LUM-42 --kind plan --title "Implementation plan" --file docs/plan.md --source "Spec Kit" --agent claude-code
```

Output: `Added [spec] "Spec" to LUM-42`

#### `lumo task artifact update <task> <artifact> [--kind <kind>] [--title <title>] [--source <source>] [--agent <agent>]`

Patches an existing artifact's metadata in place. Editable fields are **`kind`, `title`, `source`, and `agent`** — **content is immutable** (to change the body, `rm` the artifact and `add` it again). At least one flag is required; passing none errors before any network call. Empty values (`--kind ""`) are rejected. `<artifact>` is the 8-char short ref (the id's last 8 characters) in column 1 of `artifact list` and in the `task show --full` hint; a unique id prefix of 6+ characters or the full id also work, and an ambiguous ref errors with the candidates. `--agent` accepts the same valid values and aliases as `artifact add`: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact update LUM-42 pskvl3sh --kind plan              # re-classify spec → plan
lumo task artifact update LUM-42 pskvl3sh --source "Spec Kit"      # fix the framework label
lumo task artifact update LUM-42 pskvl3sh --title "Final spec" --source OpenSpec
lumo task artifact update LUM-42 pskvl3sh --agent cursor           # fix the agent label
```

Output: `Updated [plan] "Final spec" (OpenSpec) on LUM-42`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

#### `lumo task artifact list <task>`

`--json` prints `{ version, artifacts, total, nextCursor }` (full ids; internal columns such as `order` are left out).

Lists artifacts on the task in order: `<ref>  <kind>  <agent>  <source>  <title>` (`<ref>` = the 8-char short ref the other artifact commands take; header `REF`), columns sized to the widest value. On a terminal (stdout is a TTY) a header row is printed first and the title is cut with `…` to fit the terminal width; piped / agent output (non-TTY) has no header, is never truncated and keeps this column order, so column 1 is always the ref. Prints `No artifacts on <task>.` when there are none.

```bash
lumo task artifact list LUM-42
```

#### `lumo task artifact show <task> <artifact>`

`--json` prints `{ version, artifact, task }` (the artifact with its full id and content).

Prints one artifact's key:value header (ref, kind, title, agent, source, order, task) followed by the full content body. `<artifact>` is the 8-char short ref (the id's last 8 characters) in column 1 of `artifact list` and in the `task show --full` hint; a unique id prefix of 6+ characters or the full id also work, and an ambiguous ref errors with the candidates.

```bash
lumo task artifact show LUM-42 pskvl3sh
```

#### `lumo task artifact rm <task> <artifact> --confirm`

Deletes an artifact from a task. Irreversible. Without `--confirm` the CLI fetches the artifact and exits **4** with a confirmation envelope naming it (`Will delete artifact pskvl3sh "API spec" (SPEC) from LUM-42` · `Artifact deletion is irreversible`) — no DELETE is sent; relay `changes` to the user and re-run `confirmCommand` on approval ([confirmation.md](confirmation.md)). On success prints `Removed <artifact> from <task>`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

```bash
lumo task artifact rm LUM-42 pskvl3sh            # exit 4 + envelope
lumo task artifact rm LUM-42 pskvl3sh --confirm  # after the user approved
```

When to suggest: after running a spec/plan workflow in Claude Code, offer to record the product(s) with `task artifact add` (one call per artifact) — always pass `--source` with the framework you used. Use `task artifact list` to see what's already recorded, `task artifact show` to inspect a single artifact's content, `task artifact update` to fix a wrong kind/title/source without re-uploading, and `task artifact rm` to drop one that's wrong or stale.

### Task ↔ Figma Designs

#### `lumo task figma add <task> <url>` — attach a Figma file/frame

Fetches file name, frame name, and thumbnail via Figma OAuth and stores them
on the task.

```bash
lumo task figma add LUM-42 "https://www.figma.com/design/abc123/Onboarding?node-id=1-234"
```

If the URL omits `node-id`, the link is stored as file-level; the CLI prints
a `(file-level, thumbnail from "...")` note showing the auto-picked
representative frame.

Idempotent — re-adding the same URL within 7 days returns the existing row
without re-calling Figma.

**Not connected?** Errors with:

```
✗ You haven't connected Figma yet.
  Run: open https://www.uselumo.ai/settings/integrations
```

#### `lumo task figma list <task>` — list attachments

`--json` prints `{ version, figmaLinks, total, nextCursor }`.

```
$ lumo task figma list LUM-42
a1b2c3d4  Onboarding     Welcome screen    2026-05-28
e5f6g7h8  Design System  Button / Primary  2026-05-27
i9j0k1l2  Onboarding     (file-level)      2026-05-20  ⚠ thumbnail stale
```

Columns are sized to the widest value. On a terminal (stdout is a TTY) a header row is printed first and the frame name is cut with `…` to fit the terminal width; piped / agent output (non-TTY) has no header, is never truncated and keeps this column order, so column 1 is always the ref (the 8-char short ref `figma context` / `figma rm` take; header `REF`).

`⚠ thumbnail stale` appears when `thumbnailFetchedAt > 25 days`.

#### `lumo task figma rm <task> <link>` — remove an attachment

Accepts the original URL, the 8-char short ref from `figma list`, a unique id prefix (6+ chars) or the full id. Idempotent (`Not linked: ...` + exit 0 when nothing matches); an ambiguous ref removes nothing and exits 1 listing the candidates.

```bash
lumo task figma rm LUM-42 a1b2c3d4
lumo task figma rm LUM-42 "https://www.figma.com/design/abc123/Onboarding?node-id=1-234"
```

#### `lumo task figma refresh <task>` — manual refresh

Re-fetches metadata + thumbnail for every Figma link on the task. Per-link
failures are isolated.

```
$ lumo task figma refresh LUM-42
Refreshed 3 Figma links on LUM-42
  ✓ Onboarding · Welcome screen
  ✓ Onboarding · Sign-up form
  ✗ Design System · Button (file not accessible)
```

### When to suggest the `task figma` commands

- User pastes a Figma URL or mentions a design ("here's the mock", "the
  Figma is at...").
- User asks "what designs are linked to this task" or "show me the Figma
  for LUM-42".
- After implementing a UI change, suggest `lumo task figma refresh <task>`
  if the user mentioned updating the Figma source.

OAuth connection lives in the Web UI at
`/settings/integrations`. The CLI does **not** have a `figma auth`
command; if the user tries `task figma add` without connecting, the error
message directs them to the Web UI.
