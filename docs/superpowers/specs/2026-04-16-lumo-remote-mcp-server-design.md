# Lumo Remote MCP Server — Design

**Date:** 2026-04-16
**Status:** Approved (pending final user review before implementation planning)
**Owner:** chaoli

## Goal

Expose Lumo as a public, remote MCP server that any Lumo user can connect to from an MCP client (Claude Desktop, Claude Code, etc.) through OAuth. Replace the existing local stdio MCP server (`mcp/server.ts`) with an HTTP-based server integrated into the main Next.js app.

## Non-Goals

- Multi-tenant hosting of _other_ teams' MCP servers
- Agent orchestration tools (the stdio version's `agent-comm` tools are retired in MVP, to be redesigned separately)
- External side-effects (sending Slack messages, creating GitHub PRs) — read-only for integrations
- Scope-based permission split on the OAuth consent screen (Clerk does not yet support custom OAuth scopes)

## Key Decisions (from brainstorming)

| Dimension            | Choice                                                                                              | Rationale                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Audience             | Public (any Lumo user)                                                                              | Full OAuth 2.1                                                    |
| Auth path            | Clerk as OAuth 2.1 authorization server (`@clerk/mcp-tools` + `mcp-handler`)                        | Already the project's IdP; avoids second auth system              |
| Workspace selection  | Post-auth binding stored in `McpConnection` table (Clerk consent page can't carry workspace choice) | Bypasses Clerk's current consent customization limits             |
| Tool surface         | Full read + core write (tasks/comments/documents/drafts/tags/notifications)                         | Read is cheap and high-value; write is scoped to low-risk domains |
| Deployment placement | Inside the main Next.js app at `app/api/mcp/route.ts`                                               | Reuses repositories/services/Prisma with zero migration           |
| Local stdio fate     | Retire entirely; local dev uses real OAuth against Clerk dev instance                               | Single auth path avoids "backdoor in prod" risk                   |
| Permission model     | Server-side role check (`VIEWER` = read-only, `MEMBER`+ = write); no client-facing scope            | Clerk scope customization not GA                                  |

## Architecture

```
┌──────────────────┐     OAuth 2.1 + PKCE + DCR     ┌─────────────────┐
│  Claude Desktop  │◄──────────────────────────────►│     Clerk       │
│   / other MCP    │  (Clerk is the auth server)    │  (existing IdP) │
│     client       │                                 └─────────────────┘
└────────┬─────────┘                                          │
         │  streamable HTTP (MCP transport)                   │
         │  Authorization: Bearer <clerk-access-token>        │
         ▼                                                    │
┌──────────────────────────────────────────────────┐          │
│  Next.js app (lumo.com)                          │          │
│  app/api/mcp/route.ts                            │          │
│  └ mcp-handler + @clerk/mcp-tools                │◄─ verifyClerkToken
│    ├ withMcpAuth (verify token → clerkUserId)    │
│    ├ resolveLumoContext(clerkUserId)             │
│    │  └ → { clerkUserId, activeWorkspaceId?,     │
│    │        memberId?, memberRole?, connectionId}│
│    └ tool dispatch                               │
│        ├ lib/mcp/tools/* (transport-agnostic)    │
│        └ reuses lib/services/* + lib/repositories/*
└──────────────────────────────────────────────────┘
         │
         ▼
    Neon Postgres (via Prisma)
```

### Request flow (one tool call)

1. Claude sends MCP request to `/api/mcp` with `Authorization: Bearer <clerk-token>`
2. `withMcpAuth` verifies token → `clerkUserId`
3. `resolveLumoContext(clerkUserId)` queries Lumo DB:
   - Queries `WorkspaceMember` rows where `clerkId === clerkUserId` to enumerate the user's workspaces
   - Queries `McpConnection` table for this user's (`clerkUserId`, `clientId`) binding
   - Applies auto-bind rules (see below)
4. Tool handler receives `{ clerkUserId, workspaceId, memberId, memberRole, connectionId }` as context
5. Handler calls `lib/services/*` (business logic)
6. Returns MCP response; audit log row written

### Separation of concerns

- **Clerk** answers "who are you?" (authentication only)
- **Lumo** answers "which workspace do you operate on?" (business domain state, persisted in `McpConnection`)

This split is forced by Clerk's current OAuth limitations but is also the cleaner design: workspace selection is a Lumo business decision, not an auth decision.

## Data Model

### `McpConnection` (new)

One row per (Clerk user, MCP client instance). Stores the active workspace binding.

**Note:** Lumo has no separate `User` table. `WorkspaceMember.clerkId` is the Clerk user ID directly; a Lumo "user" is identified by `clerkId`, and their workspaces come from `WorkspaceMember` rows.

```prisma
model McpConnection {
  id                 String   @id @default(cuid())
  clerkUserId        String   // Clerk sub claim — the sole identity key
  activeWorkspaceId  String?  // null = needs selection; auto-bound if user has exactly 1 workspace membership
  clientName         String?  // reported via OAuth DCR (e.g., "Claude Desktop 0.8.0")
  clientId           String?  // Clerk-issued DCR client_id (for revoke/audit)
  autoBoundAt        DateTime? // populated if binding was auto-selected (single-workspace user)
  createdAt          DateTime @default(now())
  lastUsedAt         DateTime @default(now())
  revokedAt          DateTime?

  activeWorkspace    Workspace? @relation(fields: [activeWorkspaceId], references: [id], onDelete: SetNull)

  @@index([clerkUserId])
  @@unique([clerkUserId, clientId])
}
```

### `McpAuditLog` (new)

One row per tool invocation. Metadata only — no tool arguments stored (privacy).

```prisma
model McpAuditLog {
  id            String   @id @default(cuid())
  connectionId  String
  clerkUserId   String
  workspaceId   String?
  toolName      String
  status        String   // "ok" | "error"
  errorCode     String?  // MCP error code if failed
  durationMs    Int
  createdAt     DateTime @default(now())

  @@index([connectionId, createdAt])
  @@index([workspaceId, createdAt])
}
```

## Workspace Binding Rules (`resolveLumoContext`)

```
if activeWorkspaceId is set AND user still has access:
    use that workspace
elif user has exactly 1 workspace:
    auto-bind (write activeWorkspaceId + autoBoundAt); all tools visible
else (multiple workspaces, none bound):
    bootstrap mode — only expose list_my_workspaces, select_workspace, get_active_workspace
```

### Edge cases

| Scenario                                                     | Behavior                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| New user with 1 workspace connects                           | Auto-bind, Claude sees all tools immediately                              |
| User with 3 workspaces connects                              | Bootstrap mode; Claude must call `select_workspace`                       |
| Auto-bound user later joins a second workspace               | Binding unchanged; user must explicitly call `select_workspace` to switch |
| Bound workspace is deleted / user is removed                 | `activeWorkspaceId` treated as invalid → rules re-run on next request     |
| User with 1 workspace later joins a second → wants to switch | `select_workspace` is always exposed (even when not in bootstrap mode)    |

The three workspace-switching tools (`list_my_workspaces`, `select_workspace`, `get_active_workspace`) are **always exposed**, even outside bootstrap mode, so users can switch anytime.

## File Layout

```
app/
├── api/
│   ├── mcp/
│   │   └── route.ts                 # NEW: MCP HTTP entry (streamable HTTP transport)
│   └── .well-known/
│       ├── oauth-authorization-server/route.ts   # NEW: metadata proxy to Clerk
│       └── oauth-protected-resource/route.ts     # NEW: RFC 9728 resource metadata
│
├── settings/
│   └── integrations/
│       └── mcp/page.tsx             # NEW: "Connect to Claude" UI + connection management
│
lib/
├── mcp/                             # NEW: transport-agnostic MCP core
│   ├── server.ts                    # registerMcpServer(server, ctxProvider)
│   ├── context.ts                   # resolveLumoContext(clerkUserId)
│   ├── auth.ts                      # requireRole(ctx, allowedRoles[])
│   ├── errors.ts                    # service error → MCP error mapping
│   ├── rate-limit.ts                # @upstash/ratelimit integration
│   ├── audit.ts                     # writeAuditLog()
│   ├── tools/
│   │   ├── index.ts                 # registerAllTools(server, ctxProvider)
│   │   ├── workspace.ts             # 3 bootstrap tools (always exposed)
│   │   ├── projects.ts
│   │   ├── tasks.ts
│   │   ├── comments.ts
│   │   ├── documents.ts
│   │   ├── drafts.ts
│   │   ├── notifications.ts
│   │   ├── members.ts               # read-only
│   │   ├── tags.ts
│   │   ├── views.ts                 # read-only
│   │   ├── activity.ts              # read-only
│   │   ├── stats.ts                 # read-only
│   │   ├── summaries.ts             # read-only
│   │   ├── github.ts                # read-only
│   │   ├── slack.ts                 # read-only
│   │   └── sentry.ts                # read-only
│   └── resources/                   # optional: "current_workspace_overview" etc.
│       └── index.ts
│
├── repositories/
│   └── mcp-connection.repository.ts # NEW
│
└── services/
    └── mcp-connection.service.ts    # NEW
│
mcp/                                 # DELETE entire directory
mcp.json                             # DELETE (stdio config retired)
│
prisma/
└── schema.prisma                    # add McpConnection + McpAuditLog models
│
__tests__/
├── lib/mcp/
│   ├── context.test.ts
│   ├── auth.test.ts
│   └── tools/*.test.ts              # one per tool file
└── app/api/mcp/
    └── route.integration.test.ts
```

## Tool Surface (MVP)

### Write tools

| Domain                | Tools                                                                                  | Role required        |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| workspace (bootstrap) | `list_my_workspaces`, `select_workspace`, `get_active_workspace`                       | any                  |
| tasks                 | `create_task`, `update_task`, `assign_task`, `move_task_status`, `add_task_to_project` | MEMBER+              |
| comments              | `create_comment`, `update_comment`, `delete_comment`                                   | MEMBER+              |
| documents             | `create_document`, `update_document`, `move_document`                                  | MEMBER+              |
| drafts                | `create_draft`, `update_draft`, `publish_draft`, `delete_draft`                        | MEMBER+ (own drafts) |
| tags                  | `create_tag`, `assign_tag`, `unassign_tag`                                             | MEMBER+              |
| notifications         | `mark_notification_read`, `mark_all_read`                                              | any (own only)       |

### Read tools

| Domain        | Tools                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| workspace     | `get_workspace`                                                                 |
| members       | `list_members`, `get_member`                                                    |
| projects      | `list_projects`, `get_project`                                                  |
| tasks         | `list_tasks` (filters: status/assignee/project/tag), `get_task`, `search_tasks` |
| comments      | `list_task_comments`, `list_document_comments`                                  |
| documents     | `list_documents`, `get_document`, `search_documents`                            |
| drafts        | `list_my_drafts`, `get_draft`                                                   |
| tags          | `list_tags`                                                                     |
| views         | `list_views`, `get_view`                                                        |
| notifications | `list_notifications`, `get_notification`                                        |
| activity      | `list_activity`                                                                 |
| stats         | `get_workspace_stats`                                                           |
| summaries     | `list_summaries`, `get_summary`                                                 |
| github        | `list_pull_requests`, `get_pull_request`                                        |
| slack         | `list_slack_channels`, `search_slack_messages`                                  |
| sentry        | `list_sentry_issues`                                                            |

### Explicitly excluded from MVP

- `delete_workspace`, `delete_project`, `delete_task` (destructive)
- `invite_member`, `remove_member`, `change_member_role` (permission changes, need separate scope when Clerk supports it)
- `send_slack_message`, `create_github_pr` (external side effects)
- `spawn_agent`, `send_agent_message` (stdio version's `agent-comm` tools, to be redesigned separately)

## Tool Naming & Argument Shape

- snake_case (`create_task`, consistent with existing `mcp/tools/*`)
- `workspaceId` is **never** a parameter — the active workspace is resolved from connection context
- Task IDs accept both raw cuids and `PREFIX-N` identifiers (reuse existing `resolveTaskId` helper)
- "me" shortcut for `assigneeId` is supported (reuse existing `resolveAssigneeActor`)
- All tools return typed JSON matching the service return shape

## Permission Enforcement

No client-facing OAuth scopes (Clerk limitation). Enforcement is server-side:

```typescript
// lib/mcp/tools/tasks.ts
export function registerTaskTools(server, ctxProvider) {
  server.registerTool('update_task', schema, async args => {
    const ctx = await ctxProvider() // { workspaceId, memberId, memberRole }
    requireRole(ctx, ['OWNER', 'ADMIN', 'MEMBER']) // VIEWER rejected
    return await taskService.update(args, ctx)
  })
}
```

- `requireRole` throws MCP error `-32603 Forbidden` if role not in allowed list
- Read tools only require authenticated session (any role)
- Write tools require `MEMBER` or higher
- VIEWER role gets a clean, explicit error — not a 500

## OAuth Flow End-to-End

```
1. User visits Lumo settings → Integrations → MCP
   Sees: Connection URL + copy-paste JSON for Claude Desktop

2. User adds URL to Claude Desktop

3. Claude fetches https://app.lumo.com/.well-known/oauth-protected-resource
   → returns { authorization_servers: ["https://clerk.<your>.com"] }
   (generated by @clerk/mcp-tools)

4. Claude performs DCR + PKCE against Clerk; browser opens consent page;
   user approves → Claude receives access_token

5. Claude connects to /api/mcp with Bearer token
   - withMcpAuth validates token → clerkUserId
   - resolveLumoContext looks up McpConnection:
     * activeWorkspaceId set → proceed normally
     * null, user has 1 workspace → auto-bind, proceed normally
     * null, user has multiple → return only bootstrap tools

6. (Bootstrap path only) Claude calls list_my_workspaces → select_workspace
   → server writes activeWorkspaceId → Claude can now see all tools

7. Subsequent calls resolve workspace automatically from McpConnection
```

## Local Development

Single auth path (same as production) — no `dev_token` backdoor.

**One-time setup:**

1. In Clerk dev instance dashboard:
   - Add `http://localhost:3000/*` to authorized redirect URIs
   - Enable Dynamic Client Registration
2. Claude Desktop config:
   ```json
   {
     "mcpServers": { "lumo-local": { "url": "http://localhost:3000/api/mcp" } }
   }
   ```
3. `npm run dev`
4. First connection: Claude opens browser → Clerk dev sign-in → consent → token stored in Claude Desktop

**Subsequent runs:** zero additional auth friction (Claude Desktop holds the token).

### Test Environment

Integration tests mock `@clerk/mcp-tools` at the module level via `jest.mock('@clerk/mcp-tools')`:

- Only active when `NODE_ENV === 'test'`
- Replaces `withMcpAuth` / `verifyClerkToken` with stubs that inject a fixture `clerkUserId`
- Zero production impact — standard Jest module substitution, not a runtime feature flag

## Governance

| Feature                   | MVP? | Implementation                                                                         |
| ------------------------- | ---- | -------------------------------------------------------------------------------------- |
| Token revocation          | ✅   | Settings page "Disconnect" button → Clerk `revokeToken` + mark `revokedAt`             |
| User-level rate limit     | ✅   | `@upstash/ratelimit` + Vercel KV, 60 req/min per `clerkUserId`; bootstrap tools exempt |
| Audit log                 | ✅   | Write `McpAuditLog` row per tool call (metadata only, no args)                         |
| Error reporting           | ✅   | Existing Sentry integration; MCP route wraps calls in `Sentry.captureException`        |
| Custom OAuth scopes       | ❌   | Clerk doesn't support GA yet; revisit when available                                   |
| Per-tool rate limits      | ❌   | User-level is sufficient for MVP                                                       |
| Per-workspace quotas      | ❌   | Billing concern, orthogonal to MCP                                                     |
| Token auto-expiry cleanup | ❌   | Clerk manages token lifecycle; Lumo only syncs revocations                             |

### Rate limit behavior

- Exceeded: MCP error `code: -32005` ("Too Many Requests"), Claude surfaces to user
- Bootstrap tools (`list_my_workspaces`, `select_workspace`, `get_active_workspace`) are exempt from rate limiting so users can never get locked out of basic control

## Error Handling

MCP error mapping (`lib/mcp/errors.ts`):

| Source                                                          | MCP code                    | Notes                                   |
| --------------------------------------------------------------- | --------------------------- | --------------------------------------- |
| Zod validation error                                            | `-32602 Invalid params`     | Include field path                      |
| `requireRole` rejection                                         | `-32603 Forbidden`          | Include required roles                  |
| Service throws `{ status: 404 }`                                | `-32001 Resource not found` | Via existing service error convention   |
| Service throws `{ status: 403 }`                                | `-32603 Forbidden`          |                                         |
| Rate limit exceeded                                             | `-32005 Too Many Requests`  |                                         |
| Unknown error                                                   | `-32603 Internal error`     | Sentry captures full trace              |
| MCP session without bound workspace, calling non-bootstrap tool | `-32002 Workspace required` | Tells Claude to call `select_workspace` |

## Testing Strategy

### Unit (`__tests__/lib/mcp/`)

- `context.test.ts` — all 4 branches of `resolveLumoContext`
- `auth.test.ts` — `requireRole` matrix across all Lumo roles
- `tools/*.test.ts` — one per tool file: arg validation, service dispatch count, error mapping

### Integration (`__tests__/app/api/mcp/route.integration.test.ts`)

- Mocks `@clerk/mcp-tools` auth layer only
- Uses real Prisma + existing test DB setup
- End-to-end cases:
  - Bootstrap flow → `select_workspace` → business tool
  - Auto-bind path (single-workspace user)
  - VIEWER rejected on write tool
  - Revoked connection returns 401
  - Rate limit exceeded returns `-32005`

### Not tested (out of scope)

- Clerk OAuth protocol internals (Clerk's responsibility)
- MCP streamable HTTP handshake (`mcp-handler`'s responsibility)

## Dependencies Added

```
@clerk/mcp-tools          ^latest    # Clerk's MCP OAuth helper
mcp-handler               ^latest    # MCP protocol (streamable HTTP)
@upstash/ratelimit        ^latest
@vercel/kv                ^latest    # or @upstash/redis
```

`@modelcontextprotocol/sdk` is already present and retained.

## Rollout Plan (5 PRs)

### PR 1 — Infrastructure (DB + repo/service layer)

- Prisma migration: `McpConnection`, `McpAuditLog`
- `lib/repositories/mcp-connection.repository.ts`
- `lib/services/mcp-connection.service.ts`
- Unit tests for repo + service
- No route; pure DB layer. Mergeable independently.

### PR 2 — MCP core + bootstrap

- `lib/mcp/{server,context,auth,errors,rate-limit,audit}.ts`
- `lib/mcp/tools/workspace.ts` (3 bootstrap tools)
- `app/api/mcp/route.ts` + `.well-known/*` routes
- Clerk OAuth end-to-end integration
- After this PR, Claude can connect but sees only workspace-switching tools.
- Manual acceptance: preview URL walkthrough.

### PR 3 — Read tools (full coverage)

- All `list_*` / `get_*` / `search_*` tools
- Split into per-domain commits
- After this PR, Claude can "see" the whole workspace.

### PR 4 — Write tools + governance

- All write tools
- Rate limit integration
- Audit log writes

### PR 5 — UI + cleanup

- `app/settings/integrations/mcp/page.tsx`: connection URL display, connected device list, disconnect button
- Delete `mcp/` directory and `mcp.json`
- README update

Every PR: tests, `npx tsc --noEmit` green, CLAUDE.md PR title/branch conventions, new dependencies noted in PR description.

## Risks & Mitigations

| Risk                                                                    | Mitigation                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Clerk DCR toggle misconfigured                                          | Validate on staging Clerk instance before PR 2 merge                                                                            |
| Rate limit too aggressive, breaks real Claude workflows                 | Conservative default (60/min user-level); monitor audit log P95 before tightening                                               |
| Users still on old stdio server after MVP ships                         | PR 2 adds a `console.warn` deprecation message to `mcp/server.ts`; PR 5 removes it                                              |
| Clerk MCP integration is beta                                           | All Clerk SDK calls wrapped in `try/catch` + Sentry; surface upstream issues quickly                                            |
| Workspace auto-bind picks wrong workspace when user later joins another | Auto-bind only fires when user has exactly 1 workspace; never re-fires after; user can explicitly switch via `select_workspace` |

## Acceptance Criteria

- [ ] Fresh Claude Desktop on a new machine completes OAuth → workspace selection → tool call
- [ ] Switching between two workspaces does not leak state (tasks from A not visible in B's session)
- [ ] VIEWER role calling a write tool returns clean MCP `-32603` error (not 500)
- [ ] Disconnecting in Lumo UI causes Claude's next request to fail with 401
- [ ] Audit log records every tool call (ok + error)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (all unit + integration suites)
- [ ] Preview deployment passes manual walkthrough of all 5 validation scenarios

## Open Questions (non-blocking for MVP)

- Should bootstrap mode also expose an MCP `prompt` (in addition to the tool) that guides users through workspace selection? Current design says no (tool only) for client compatibility, but revisit if UX feedback demands it.
- When Clerk ships custom OAuth scopes GA, migrate to `lumo:read` / `lumo:write` on the consent screen and simplify the server-side `requireRole` logic.
- Agent orchestration tools (replacement for retired `agent-comm`) — separate design document.
