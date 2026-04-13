# @lumo/cli — CLI Tool Design Spec

**Date:** 2026-04-13
**Status:** Draft

## Overview

A command-line tool for developers to manage their Lumo tasks from the terminal. Invoked via `npx @lumo/cli` or installed globally. MVP scope: login authentication and viewing assigned tasks.

## Target User

Developers on small teams using Lumo who prefer terminal workflows for quick task checks without switching to the browser.

## Package & Project Structure

**Package name:** `@lumo/cli`
**Monorepo integration:** Added as a workspace alongside `shared/` and `agent-server/`.

```
cli/
├── package.json          # @lumo/cli, bin: { lumo: ./dist/index.js }
├── tsconfig.json
├── tsup.config.ts        # Bundle to single CJS file for npx compat
└── src/
    ├── index.ts          # Entry point, #!/usr/bin/env node, Commander setup
    ├── commands/
    │   ├── login.ts      # lumo login
    │   ├── logout.ts     # lumo logout
    │   └── tasks.ts      # lumo tasks
    ├── lib/
    │   ├── config.ts     # Read/write ~/.lumo/config.json
    │   ├── client.ts     # HTTP client with API Key auth header
    │   └── output.ts     # Table/list formatting with chalk
    └── types.ts          # CLI-specific types, reuses @lumo/shared
```

**Root package.json changes:**

```json
"workspaces": ["shared", "agent-server", "cli"]
```

**Key dependencies:**

- `commander` — argument parsing and sub-commands
- `chalk` — terminal colors
- `tsup` — bundling to single CJS file

No interactive prompts (inquirer, prompts, etc.) — pure command-line style.

## Commands

### `lumo login`

Authenticates the CLI by accepting a user-provided API Key.

```
$ lumo login
? API Key: lum_xxxx...

✓ Logged in as Chao Li (workspace: Lumo)
  Config saved to ~/.lumo/config.json
```

**Flow:**

1. Read API Key from `--key` flag, or fall back to reading from stdin (masked)
2. Validate key format: must start with `lum_`
3. Call `GET /api/workspaces/me` with `Authorization: Bearer lum_xxx`
4. On success: write config to `~/.lumo/config.json`, print confirmation
5. On failure: print error, exit code 1

**Options:**

- `--key <key>` — API Key (preferred; avoids interactive prompt)
- `--api-url <url>` — override API base URL (default: `https://app.lumo.dev`)

**Examples:**

```bash
lumo login --key lum_abc123...          # direct flag
echo "lum_abc123..." | lumo login       # piped stdin
```

### `lumo logout`

Clears stored credentials.

```
$ lumo logout
✓ Logged out. Config removed.
```

Deletes `~/.lumo/config.json`.

### `lumo tasks`

Lists tasks assigned to the current user.

```
$ lumo tasks

  LUM-1  Fix login bug          IN_PROGRESS  HIGH    → Chao Li
  LUM-3  Add OAuth support       TODO         MEDIUM  → Chao Li
  LUM-7  Update API docs         TODO         LOW     → Chao Li

  3 tasks assigned to you
```

**Data source:** `GET /api/tasks/me` (with API Key auth)

**Default behavior:** Shows only non-DONE tasks, sorted by priority (URGENT > HIGH > MEDIUM > LOW).

**Options:**

- `--all` — include completed tasks
- `--status <status>` — filter by status (TODO, IN_PROGRESS, IN_REVIEW, DONE)
- `--project <id>` — filter by project ID
- `--json` — output raw JSON (for piping)

**Output formatting:**

- Status uses color: TODO (gray), IN_PROGRESS (blue), IN_REVIEW (purple), DONE (green)
- Priority uses color: URGENT (red), HIGH (orange), MEDIUM (yellow), LOW (gray)
- `--json` disables colors and outputs raw API response

## Config File

**Location:** `~/.lumo/config.json`

```json
{
  "apiKey": "lum_xxxx...",
  "apiUrl": "https://app.lumo.dev",
  "workspaceName": "Lumo",
  "userName": "Chao Li"
}
```

- `apiKey` — the only required field, used for authentication
- `apiUrl` — API base URL, defaults to production
- `workspaceName`, `userName` — cached at login for display purposes, not used for auth

## Backend Changes: API Key Authentication

### New: `lib/auth/api-key.ts`

Extracts and validates API Key from the `Authorization: Bearer lum_xxx` header.

```typescript
export async function authenticateApiKey(
  headerValue: string
): Promise<{ userId: string; workspaceId: string; memberId: string } | null>
// userId = clerkId from workspaceMember, matching requireAuth() return shape
```

**Flow:**

1. Extract key from `Bearer lum_xxx` header
2. Validate prefix: must start with `lum_`
3. SHA256 hash the key
4. Query `apiKeys` table: match `keyHash`, `revokedAt IS NULL`
5. Join to `workspaceMember` → get `clerkId`, `workspaceId`
6. Update `lastUsedAt` timestamp
7. Return auth context or null

### New: `lib/auth/index.ts` — `requireAuthAny()`

Dual authentication function that supports both Clerk (web) and API Key (CLI).

```typescript
export async function requireAuthAny(): Promise<AuthResult | NextResponse> {
  // 1. Check Authorization header for API Key
  // 2. If no API Key header, fall back to Clerk auth
  // 3. If neither, return 401
}
```

- Does NOT replace existing `requireAuth()` — that stays Clerk-only
- Only applied to routes the CLI needs:
  - `GET /api/tasks/me`
  - `GET /api/workspaces/me`
- Keeps security surface minimal — other routes remain Clerk-only

### Route Changes

Two existing routes need to swap `requireAuth()` for `requireAuthAny()`:

| Route                    | Current Auth    | New Auth           |
| ------------------------ | --------------- | ------------------ |
| `GET /api/tasks/me`      | `requireAuth()` | `requireAuthAny()` |
| `GET /api/workspaces/me` | `requireAuth()` | `requireAuthAny()` |

The response shape stays identical — no breaking changes for the web app.

## CLI HTTP Client

**`cli/src/lib/client.ts`:**

Lightweight fetch wrapper for CLI use. Not reusing the web app's `lib/api-client/` (which depends on browser context like cookies and relative URLs).

```typescript
export function createClient(config: LumoConfig) {
  return {
    async get<T>(path: string): Promise<T>,
    async post<T>(path: string, body?: unknown): Promise<T>,
  }
}
```

- Reads `apiKey` and `apiUrl` from config
- Sets `Authorization: Bearer <apiKey>` header on every request
- Sets `Content-Type: application/json`
- Throws typed errors with status code and message
- No retry logic in MVP

## Error Handling

All errors print to stderr. Normal output goes to stdout.

| Scenario            | Message                                                                   | Exit Code |
| ------------------- | ------------------------------------------------------------------------- | --------- |
| Not logged in       | `Error: Not logged in. Run "lumo login" first.`                           | 1         |
| Key invalid/revoked | `Error: API key invalid or revoked. Run "lumo login" to re-authenticate.` | 1         |
| Network error       | `Error: Cannot reach Lumo API at <url>. Check your connection.`           | 1         |
| Unknown API error   | `Error: <status> <message>`                                               | 1         |
| Success             | (normal output to stdout)                                                 | 0         |

## Testing Strategy

- Unit tests for `config.ts` (read/write/delete config file)
- Unit tests for `client.ts` (mock fetch, verify headers, error handling)
- Unit tests for `output.ts` (table formatting, color logic)
- Integration test: `login` command with mocked API
- Integration test: `tasks` command with mocked API response
- Test files in `cli/__tests__/`, using Jest (consistent with main app)

## Build & Publish

- **Build:** `tsup src/index.ts --format cjs --dts` — single-file CJS bundle
- **Bin entry:** `"bin": { "lumo": "./dist/index.js" }`
- **npx usage:** `npx @lumo/cli tasks` (Commander auto-routes sub-commands)
- **Global install:** `npm i -g @lumo/cli` then `lumo tasks`
- **Publish:** to npm under `@lumo` scope

## Out of Scope (Future)

- Task creation/update commands
- Project listing/switching
- Agent operations (execute, retry, cancel)
- Interactive prompts or TUI
- OAuth device flow authentication
- Shell completions
- CI/CD automation features
