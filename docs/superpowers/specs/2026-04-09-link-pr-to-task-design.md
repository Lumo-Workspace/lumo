# Link PR to Task — Design Spec

**Date:** 2026-04-09
**Status:** Draft

## Problem

Currently, PRs are linked to tasks only via automated webhook-based branch name parsing (e.g., `lumo/ENG-123-fix-bug`). If a PR's branch name doesn't follow the convention, or the webhook wasn't set up at the time, the PR won't be associated with any task. There is no way for users to manually link an existing PR to a task.

## Goals

- Allow users to manually link existing PRs to a task
- Support both searching existing PR records and pasting a GitHub PR URL
- Allow users to unlink PRs from a task

## Design Decisions

| Decision                                | Choice                                                          | Rationale                                                                       |
| --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| PR-to-Task cardinality                  | One PR → one Task (existing schema)                             | Matches current `taskId` FK; multi-task PRs usually indicate PR should be split |
| Re-linking a PR already on another task | Show confirmation, then overwrite                               | User must explicitly confirm to avoid accidents                                 |
| Status transition on manual link        | No automatic status change                                      | Manual linking is usually "backfilling" — task status is already correct        |
| Post-link webhook behavior              | Normal — future webhook events still trigger status transitions | Once linked, the PR behaves the same as an auto-linked one                      |
| Unlink scope                            | All PRs can be unlinked, regardless of how they were linked     | Consistent behavior, no need to distinguish link origin                         |
| Unlink confirmation                     | None needed                                                     | Low-risk, easily reversible by re-linking                                       |

## Data Layer

### Schema

No schema changes needed. Existing `PullRequest.taskId` field supports link/unlink by setting or nulling the value.

### New API Endpoints

#### `POST /api/tasks/[id]/pull-requests/link`

Links a PR to the task. Accepts two modes:

**Mode 1 — By PR ID (from search results):**

```json
{
  "prId": "cuid_xxx",
  "force": false
}
```

**Mode 2 — By URL (paste):**

```json
{
  "url": "https://github.com/org/repo/pull/123",
  "force": false
}
```

**Behavior:**

- `prId` mode: Validate PR exists and belongs to same workspace → update `taskId`
- `url` mode: Parse `repo` and `number` from URL → check if PR exists locally → if not, fetch from GitHub API via integration token and upsert → update `taskId`
- If PR already has a different `taskId` and `force` is false → return `409 Conflict` with current task info
- If `force` is true → overwrite `taskId`

**Response:** Updated PR object, or 409 with `{ conflictTask: { id, number, title, teamIdentifier } }`

#### `POST /api/tasks/[id]/pull-requests/[prId]/unlink`

Sets `PullRequest.taskId` to `null`.

**Validation:** PR must currently be linked to this task (prevent unlinking someone else's PR).

#### `GET /api/pull-requests/search`

Search PRs within the current workspace.

**Query params:**

- `q` — search string (matches PR number prefix or title substring)
- `workspaceId` — scope to workspace
- `limit` — max results (default 20)

**Response:** Array of PR objects with optional current task info:

```json
[
  {
    "id": "...",
    "repo": "org/repo",
    "number": 42,
    "title": "Fix login flow",
    "url": "https://github.com/org/repo/pull/42",
    "state": "open",
    "ciStatus": "success",
    "authorLogin": "dev1",
    "task": null | { "id": "...", "number": 12, "title": "...", "teamIdentifier": "ENG" }
  }
]
```

## Service Layer

### `task.service.ts` — new methods

- `linkPullRequest(taskId, input: { prId?: string, url?: string, force?: boolean })` — orchestrates link logic, calls GitHub API if needed for URL mode
- `unlinkPullRequest(taskId, prId)` — sets `taskId` to null with validation

### `github.service.ts` — new method

- `fetchAndUpsertPr(workspaceId, repo, number)` — fetch PR from GitHub API, upsert to local DB, return PR record

### `github.repository.ts` — new queries

- `searchPullRequests(workspaceId, query, limit)` — fuzzy search by number/title
- `findPullRequestByRepoAndNumber(repo, number)` — exact lookup for URL-based linking
- `updatePullRequestTask(prId, taskId: string | null)` — update task association

## UI Layer

### Location

Task detail sidebar (`TaskDetailSidebar.tsx`), within the existing PR section.

### Link PR Entry

- `+` button next to the PR section header
- Opens a **Popover** (not Modal) containing:
  - Single input field that accepts both search keywords and GitHub PR URLs
  - Debounced search (300ms) → calls `/api/pull-requests/search`
  - URL detection: if input matches `github.com/.../pull/\d+` pattern, switch to URL mode
  - Results list: each item shows `repo` `#number` `title` `state badge`
  - Items linked to another task show grey text: "Linked to ENG-45"

### Conflict Confirmation

- When clicking a PR already linked to another task → AlertDialog:
  - "This PR is currently linked to **ENG-45: Fix login flow**. Link it to this task instead?"
  - Confirm → re-call link API with `force: true`
  - Cancel → dismiss

### Unlink

- PR list items show an `×` button on hover
- Click → immediately calls unlink API, no confirmation needed
- Task detail data refetches after unlink

### State Refresh

- After link/unlink → refetch task detail (reuse existing `mutate` / `revalidate` pattern)

## Validation (Zod)

### `linkPullRequestSchema`

```
{
  prId: z.string().cuid().optional(),
  url: z.string().url().optional(),
  force: z.boolean().default(false)
}
// refine: exactly one of prId or url must be provided
```

### `searchPullRequestsSchema`

```
{
  q: z.string().min(1).max(100),
  workspaceId: z.string().cuid(),
  limit: z.number().int().min(1).max(50).default(20)
}
```

## Error Handling

| Scenario                            | Behavior                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| PR not found (by ID)                | 404                                                         |
| PR URL invalid format               | 400 with message                                            |
| PR not found on GitHub (URL mode)   | 404 "PR not found on GitHub"                                |
| No GitHub integration for the repo  | 400 "GitHub integration not configured for this repository" |
| PR belongs to different workspace   | 403                                                         |
| PR already linked to another task   | 409 with conflict info                                      |
| PR not linked to this task (unlink) | 400                                                         |

## Testing

- Service: link by ID, link by URL, link with conflict, force link, unlink, unlink validation
- Repository: search by number, search by title, exact lookup, update task association
- API routes: auth checks, input validation, error responses
