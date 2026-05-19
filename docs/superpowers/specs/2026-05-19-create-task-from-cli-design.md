# Create Task from CLI — Design

**Task**: [LUM-43](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-43) — Create Task from CLI
**Date**: 2026-05-19

## Summary

Add `lumo task create <title>` to the Lumo CLI so users can file a task from the terminal without opening the web UI. Supports `--description`, `--priority`, `--assignee`, and `--project`, with sensible defaults (priority `low`, assignee `me`, project auto-selected when the workspace has only one).

## Goals

- Single-shot create from the terminal: one command, one HTTP call.
- Behave well in scripts: deterministic exit codes, no interactive prompts.
- Server-side resolution of human-friendly references (project slug/name, member email/name), so the CLI stays a thin client.

## Non-goals

- Full task editing from the CLI (separate command later).
- Bulk/batch creation.
- Interactive prompts (TTY-only flow). Multi-project ambiguity is resolved by erroring out with a candidate list, not by prompting.
- Auto-attaching the new task to the current session. User runs `lumo session attach LUM-N` explicitly if they want to switch.
- AI parsing of a freeform sentence (that lane is owned by the existing `parse-quick-dispatch` endpoint).

## CLI Surface

```
lumo task create <title> [options]

Options:
  -d, --description <text>      Task description (single string)
  -p, --priority <level>        low | medium | high | urgent (default: low)
  -a, --assignee <ref>          email / name / "me" (default: me)
      --project <ref>           project slug or name
                                (required when workspace has >1 project)
```

### Defaults & input parsing

- `--priority` is case-insensitive (`low` → `LOW`). Invalid values exit 1 with the allowed list.
- `--assignee` defaults to `me`, which resolves to the API-key owner's actor in the workspace.
- `--project` is optional only when the workspace has exactly one project.

### Output (success)

```
Created LUM-44 "Add OAuth login"  https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44
```

Single line on stdout, exit 0. The URL uses the `my-tasks` route (works without needing the project slug in the path).

### Errors

| Scenario                                        | exit | stderr                                                                                         |
| ----------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------- |
| Not logged in                                   | 1    | `Error: not logged in. Run \`lumo auth login\` first.`                                         |
| Missing title                                   | 1    | `Error: missing <title>. Usage: lumo task create <title>`                                      |
| Invalid priority value                          | 1    | `Error: invalid priority "foo". Allowed: low, medium, high, urgent`                            |
| Workspace has multiple projects, none specified | 1    | `Error: workspace has multiple projects. Use --project <slug>.\nAvailable: lumo, agent-server` |
| `--project` ref does not match any project      | 1    | `Error: no project matches "foo".\nAvailable: lumo, agent-server`                              |
| `--assignee` ref does not match any member      | 1    | `Error: no member matches "alice"`                                                             |
| `--assignee` ref matches >1 member              | 1    | `Error: multiple members match "alice": alice@team.com, alice.smith@team.com`                  |
| API auth fails                                  | 1    | `Error: API key invalid or revoked. Run \`lumo auth login\`.`                                  |
| Other server error                              | 1    | `Error: task create failed (HTTP <status>)`                                                    |
| Network failure                                 | 1    | `Error: could not reach Lumo API at <url> (<msg>)`                                             |

All errors go to stderr; stdout stays clean so the success line can be captured in scripts via `$(lumo task create ...)`.

## Architecture

```
CLI (cli/src/commands/task-create.ts)
    │
    ▼  POST /api/tasks                  Bearer auth
    │  { title, description?, priority?,
    │    assigneeRef?, projectRef? }
    │
Route (app/api/tasks/route.ts)          ← new file
    │
    ├─ verifyBearer() → identity { user, workspace, apiKey }
    ├─ zod-validate cliCreateTaskSchema
    ├─ taskCliService.createFromCli({ workspaceId, callerUserId, ...input })
    │     ├─ resolveProject(workspaceId, projectRef) → projectId  | throw 400
    │     ├─ resolveAssignee(workspaceId, assigneeRef, callerUserId) → actorId | throw 400
    │     └─ taskService.createTask(projectId, payload, callerActorId, callerUserId)
    │
    └─ return 201 { task: { identifier, title, url } }
```

The CLI is a thin client. All resolution and validation lives server-side so the same rules apply if other clients (web, MCP) call the same endpoint later.

## Server-side resolution rules

### Project (`projectRef`)

1. If omitted:
   - Workspace has exactly 1 non-idea project → use it.
   - Otherwise → `400 { error: "Workspace has multiple projects.", candidates: ["slug-a", "slug-b"] }`.
2. If provided:
   - Case-insensitive exact match against `slug`, then against `name`.
   - 0 matches → `400 { error: "No project matches \"<ref>\".", candidates: [...] }`.
   - > 1 match (e.g. two projects share a name) → `400 { error: "Multiple projects match \"<ref>\".", candidates: [...] }`.

Only non-idea projects are eligible (matches the web "My Tasks" semantics).

### Assignee (`assigneeRef`)

1. If omitted or `"me"`: resolve via the API-key owner → that user's `Member` in the workspace → `actorId`.
2. Otherwise:
   - Case-insensitive exact match against member `email`, then against `name`.
   - 0 matches → `400 { error: "No member matches \"<ref>\"." }`.
   - > 1 match → `400 { error: "Multiple members match \"<ref>\".", candidates: ["a@x", "b@x"] }`.

### Priority

Server accepts the existing `LOW | MEDIUM | HIGH | URGENT` enum. CLI uppercases the input before sending. The CLI's default `low` overrides the schema's `MEDIUM` default — it's a CLI-level UX choice, not a server-level one, so the server keeps `MEDIUM` as default for other callers.

## Data flow & reuse

- Reuses `taskService.createTask(projectId, payload, actorId, userId)` (already in `lib/services/task.service.ts`). No new write-side logic; the new service is pure resolution + delegation.
- Reuses `verifyBearer` (`lib/auth/bearer.ts`) and `authService.verifyApiKey` for auth.
- Reuses `projectRepository.findByWorkspaceNonIdea` for the candidate list (ideas are private drafts and shouldn't show up).
- Reuses the existing URL pattern `/workspace/<workspace-slug>/my-tasks/<identifier>`.

## File changes

**New:**

- `cli/src/commands/task-create.ts` — flag parsing, HTTP, output formatter
- `app/api/tasks/route.ts` — `POST` handler (Bearer-auth)
- `lib/services/task-cli.service.ts` — `createFromCli`, `resolveProject`, `resolveAssignee`
- `lib/validation/schemas.ts` — append `cliCreateTaskSchema`
- `cli/__tests__/task-create-format.test.ts` — output / error string formatters
- `__tests__/task-cli.service.test.ts` — resolution logic

**Edits:**

- `cli/src/index.ts` — register `task create <title>` subcommand under the existing `task` group

## Testing

- **Service unit tests** (`__tests__/task-cli.service.test.ts`):
  - single-project workspace, no `projectRef` → resolves
  - multi-project workspace, no `projectRef` → throws with candidates
  - `projectRef` matches slug, matches name, no match, ambiguous match
  - `assigneeRef` defaults to caller, `"me"` explicit, email match, name match, no match, ambiguous
  - default priority `LOW` from CLI vs. server-side `MEDIUM` default — CLI always sends a value, so this is purely an integration concern; covered by a single test that the schema accepts both.
- **CLI unit tests** (`cli/__tests__/task-create-format.test.ts`):
  - Success output format
  - Each error message string (table above)
  - Pure functions, no HTTP (mirrors `formatTaskContextMarkdown` testing style)
- Not in scope: end-to-end test that hits the real API — consistent with existing CLI test conventions.

## Risks & open questions

- **Priority default divergence.** CLI defaults to `low`, but `createTaskSchema` defaults to `MEDIUM`. Resolved by having the CLI always send an explicit value, so the schema default never fires for CLI calls. Documented in the schema comment so future readers don't unify them by accident.
- **Project visibility.** We list only non-idea projects, so the CLI's candidate list is the same as what every workspace member sees. Ideas (private drafts) are excluded — creating a task into an idea isn't a CLI use case.
- **No `--parent`, `--sprint`, `--due-date` in v1.** Out of scope per the brief; easy to add later as additional flags.
