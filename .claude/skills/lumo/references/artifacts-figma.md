# Task Artifacts & Figma Designs

### Task ↔ Spec Artifacts

Record Claude Code spec-engineering products (spec / plan / design …) on a task. The artifacts show up in the task detail definition ("spec") layer and are injected into `lumo task context`.

#### `lumo task artifact add <task> --kind <kind> --title <title> --file <path> --source <source> --agent <agent>`

Attaches an artifact to a task. `--kind`, `--title`, `--source` are stored verbatim — **`kind` is opaque** (no enumeration; `spec` / `plan` / `requirements` / anything is accepted). `--source` is **required** and names the spec-generation framework that produced the artifact, written as its **formal name** (`Superpowers` / `Spec Kit` / `BMad` / `OpenSpec` / `GSD` / …) — it is also opaque (no enumeration), but there is **no default**, so you must pass it. Quote names that contain spaces (`--source "Spec Kit"`). `--file` supplies the body (file contents). Each call appends to the end of the task's artifact list — call once per artifact (e.g. Superpowers: one `spec`, one `plan`). The `<task>` (e.g. `LUM-42`) is resolved server-side. **`--file` is sandboxed:** the CLI rejects any path that resolves **outside the current project directory** (parent-traversal, absolute paths, escaping symlinks) or that matches a **sensitive-file denylist** (`.env*`, `id_rsa`/`id_ed25519`, `*.pem`/`*.key`, `.aws`/`.ssh` contents, `credentials`, `.npmrc`, …). There is no override flag — pass only project-local, non-secret files (e.g. `docs/spec.md`). To record an out-of-tree file, copy it into the project first.

`--agent` is **required** and names the coding tool that produced the artifact (enum). Valid values: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact add LUM-42 --kind spec --title "Spec" --file docs/spec.md --source Superpowers --agent claude-code
lumo task artifact add LUM-42 --kind plan --title "Implementation plan" --file docs/plan.md --source "Spec Kit" --agent claude-code
```

Output: `Added [spec] "Spec" to LUM-42`

#### `lumo task artifact update <task> <artifact-id> [--kind <kind>] [--title <title>] [--source <source>] [--agent <agent>]`

Patches an existing artifact's metadata in place. Editable fields are **`kind`, `title`, `source`, and `agent`** — **content is immutable** (to change the body, `rm` the artifact and `add` it again). At least one flag is required; passing none errors before any network call. Empty values (`--kind ""`) are rejected. The `<artifact-id>` is the cuid in column 1 of `artifact list`. `--agent` accepts the same valid values and aliases as `artifact add`: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases).

```bash
lumo task artifact update LUM-42 cma_xxx --kind plan              # re-classify spec → plan
lumo task artifact update LUM-42 cma_xxx --source "Spec Kit"      # fix the framework label
lumo task artifact update LUM-42 cma_xxx --title "Final spec" --source OpenSpec
lumo task artifact update LUM-42 cma_xxx --agent cursor           # fix the agent label
```

Output: `Updated [plan] "Final spec" (OpenSpec) on LUM-42`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

#### `lumo task artifact list <task>`

Lists artifacts on the task in order: `<id>  <kind>  <agent>  <source>  <title>`. Prints `No artifacts on <task>` when there are none.

```bash
lumo task artifact list LUM-42
```

#### `lumo task artifact show <task> <artifact-id>`

Prints one artifact's key:value header (id, kind, title, agent, source, order, task) followed by the full content body. The `<artifact-id>` is the cuid in column 1 of `artifact list`.

```bash
lumo task artifact show LUM-42 cma_xxx
```

#### `lumo task artifact rm <task> <artifact-id> --confirm`

Deletes an artifact from a task. Irreversible. Without `--confirm` the CLI fetches the artifact and exits **4** with a confirmation envelope naming it (`Will delete artifact cma_xxx "API spec" (SPEC) from LUM-42` · `Artifact deletion is irreversible`) — no DELETE is sent; relay `changes` to the user and re-run `confirmCommand` on approval ([confirmation.md](confirmation.md)). `--yes` is a legacy alias. On success prints `Removed <artifact-id> from <task>`. A 404 (task or artifact missing in this workspace) prints the server message and exits 1.

```bash
lumo task artifact rm LUM-42 cma_xxx            # exit 4 + envelope
lumo task artifact rm LUM-42 cma_xxx --confirm  # after the user approved
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

```
$ lumo task figma list LUM-42
cfl_xxx1  Onboarding       Welcome screen       2026-05-28
cfl_xxx2  Design System    Button / Primary     2026-05-27
cfl_xxx3  Onboarding       (file-level)         2026-05-20  ⚠ thumbnail stale
```

`⚠ thumbnail stale` appears when `thumbnailFetchedAt > 25 days`.

#### `lumo task figma rm <task> <link-id-or-url>` — remove an attachment

Accepts a `cfl_*` cuid or the original URL. Idempotent (`Not linked: ...` + exit 0 when no match).

```bash
lumo task figma rm LUM-42 cfl_xxx1
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
