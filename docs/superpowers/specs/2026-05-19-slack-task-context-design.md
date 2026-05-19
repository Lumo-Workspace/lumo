# Slack Message/Thread as Task Context — Design

**Task**: [LUM-44](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-44) — Add Slack Message or Thread as Task Context
**Date**: 2026-05-19
**Status**: Draft

## Summary

Let users attach Slack messages (single or thread) to a Lumo task as durable context. The user pastes a Slack permalink in a dialog; the server fetches the message (or whole thread, when the permalink is a thread reply), caches a snapshot, and displays it in a new **Slack Context** tab on the task detail page. The snapshot is also injected into the `lumo task context <id>` markdown output so agents can read it.

## Goals

- Capture the discussion that motivated a task — author, text, timestamp — and make it visible to both humans and agents.
- Survive the original message being edited or deleted (cached snapshot, manual refresh).
- Mirror the existing `PullRequest` linkage pattern so the schema, layering, and UI feel native.

## Non-goals

- Auto-refresh / webhook-driven invalidation. Manual refresh only.
- Slack reactions, edit history, or rich file previews. Just file name + link.
- Per-user OAuth — only the workspace bot token reads messages.
- Workspace-wide search across all Slack contexts.
- Batch paste (multiple permalinks in one submit). One add per submit.
- Cross-task snapshot deduplication.

## Decisions (locked in during brainstorming)

|                   |                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Storage           | Single table `TaskSlackContext` with a JSON `snapshot` column                                     |
| Granularity       | Smart heuristic: permalink with `thread_ts` query param → fetch whole thread; else single message |
| Refresh           | Lazy — fetched once at create-time, manual refresh button afterwards                              |
| UI placement      | New tab between **Activity** and **Agent**, order: Comments / Activity / Slack / Agent            |
| Agent integration | Extend `lumo task context <id>` markdown output with a `## Slack Context` section                 |

## Data model

### Prisma — new model

```prisma
model TaskSlackContext {
  id                String   @id @default(cuid())
  taskId            String
  workspaceId       String

  permalink         String
  slackTeamId       String
  slackChannelId    String
  slackChannelName  String?   // resolved at create-time; null if private/unreadable
  rootTs            String    // thread → parent ts; single → message ts
  threadTs          String?   // non-null means the permalink was a thread reply
  isThread          Boolean

  snapshot          Json      // SlackContextSnapshot — see TS type below
  snapshotAt        DateTime
  refreshError      String?   // last refresh error; null when last refresh succeeded

  createdById       String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  task              Task             @relation(fields: [taskId], references: [id], onDelete: Cascade)
  workspace         Workspace        @relation(fields: [workspaceId], references: [id])
  createdBy         WorkspaceMember  @relation(fields: [createdById], references: [id])

  @@index([taskId])
  @@index([workspaceId])
}
```

`Task` model gains:

```prisma
slackContexts TaskSlackContext[]
```

### `snapshot` JSON shape

```ts
// shared/types/slackContext.ts
export type SlackContextSnapshot = {
  messages: Array<{
    ts: string
    userId: string
    userName: string | null
    userAvatarUrl: string | null
    text: string // raw Slack mrkdwn
    edited: boolean
    files?: Array<{
      name: string
      permalink: string
      mimeType: string
    }>
  }>
}
```

One `TaskSlackContext` row per "add" action. A task can have many. Adding a thread writes 1 row (with N messages in `snapshot.messages`); adding a single message writes 1 row with 1 message.

## Permalink parsing

Slack permalink formats:

```
https://<team>.slack.com/archives/<C…>/p1700000000000100
https://<team>.slack.com/archives/<C…>/p1700000000000200?thread_ts=1700000000.000100&cid=…
```

Rules:

- The `p1700000000000100` segment → `ts = 1700000000.000100` (insert `.` 6 chars from the end).
- Presence of `thread_ts` query param → reply, fetch the whole thread keyed by `thread_ts`.
- Absence of `thread_ts` → fetch just the message at `ts`.
- Channel id is the path segment between `/archives/` and `/p…`.
- Team subdomain is the host's leading label, used only to verify it matches the connected workspace's `SlackIntegration.slackTeamName` (or `slackTeamId` if available after a `team.info` lookup at integration-install time).

Validation regex (Zod):

```
^https://[a-z0-9-]+\.slack\.com/archives/C[A-Z0-9]+/p\d+(\?.*)?$
```

## Layered architecture

Strictly follows the project's data flow: `Component → API Client → API Route → Service → Repository → Prisma/DB`. Slack network calls are isolated in an integration module.

### Repository — `lib/repositories/taskSlackContext.repository.ts`

Thin Prisma wrapper:

```ts
create(input)
listByTask(taskId)              // ordered by createdAt desc
getById(id)
updateSnapshot(id, snapshot, error?)
delete(id)
```

No permission checks; no business logic.

### Service — `lib/services/taskSlackContext.service.ts`

```ts
linkSlackPermalink(taskId, permalink, actorMemberId): Promise<TaskSlackContext>
refreshContext(contextId, actorMemberId): Promise<TaskSlackContext>
unlinkContext(contextId, actorMemberId): Promise<void>
listForTask(taskId): Promise<TaskSlackContext[]>
```

Responsibilities:

1. Parse permalink → `{ teamId, channelId, ts, threadTs? }`.
2. Load `SlackIntegration` by `workspaceId`. If missing, throw status=412 `not_connected`.
3. Verify teamId matches the integration's team. If not, throw status=400 `wrong_team`.
4. Call `SlackContextFetcher` to retrieve messages + resolve user/channel names.
5. Persist via repository.

Errors thrown with `Object.assign(new Error(code), { status, code })` so the route layer can map them.

### Slack fetcher — `lib/integrations/slack/context-fetcher.ts`

Server-only. **Not exported from the slack barrel** (same rule as `bot.ts`; see memory `project_integrations_barrel_rsc_boundary`).

```ts
parsePermalink(url): ParsedPermalink
fetchSingleMessage(token, channelId, ts): Promise<RawMessage>
fetchThread(token, channelId, threadTs): Promise<RawMessage[]>
resolveChannelName(token, channelId): Promise<string | null>
resolveUsers(token, userIds): Promise<Map<string, { name: string; avatarUrl: string | null }>>
toSnapshot(rawMessages, users): SlackContextSnapshot
```

Implementation pattern follows `lib/integrations/slack/notify.ts`:

- Raw `fetch` against `https://slack.com/api/<method>` with `Authorization: Bearer <token>`.
- Token retrieved via the same pattern as `getIntegrationToken` in `notify.ts`: `decrypt(integration.accessToken)`. **The Slack token is stored encrypted** — do not pass `accessToken` directly.
- Slack API endpoints used:
  - `conversations.history` — single message: `latest=ts&inclusive=true&limit=1`.
  - `conversations.replies` — thread fetch, paginate via `cursor` until exhausted.
  - `conversations.info` — channel name.
  - `users.info` per unique userId (batched in parallel, deduped). Acceptable for typical thread sizes (<50 unique users). If profile lookups dominate latency in the wild, swap to `users.list` cached per workspace later.
- API errors mapped to typed exceptions:
  - `not_in_channel` / `channel_not_found` / `message_not_found` → propagate to service as named codes.
  - 5xx / network → wrap as `slack_unavailable`.

### API routes — `app/api/tasks/[id]/slack-contexts/`

Each route ~50 lines: auth check → Zod validation → service call → response.

```
GET    /api/tasks/[id]/slack-contexts                  → list
POST   /api/tasks/[id]/slack-contexts                  → link new (body: { permalink })
DELETE /api/tasks/[id]/slack-contexts/[contextId]      → unlink
POST   /api/tasks/[id]/slack-contexts/[contextId]/refresh  → manual refresh
```

Uses the existing `requireAuthedMember(workspaceId)` helper for authorization. All routes require the actor to be a member of the task's workspace.

### API client — `lib/api-client/taskSlackContext.ts`

```ts
listSlackContexts(taskId)
linkSlackContext(taskId, permalink)
refreshSlackContext(taskId, contextId)
unlinkSlackContext(taskId, contextId)
```

Thin fetch wrapper, returns typed responses.

### Validation — `lib/validation/slackContext.ts`

Zod schemas:

```ts
slackPermalinkSchema = z
  .string()
  .regex(PERMALINK_REGEX, 'slackContext.error.invalidPermalink')
linkSlackContextBody = z.object({ permalink: slackPermalinkSchema })
```

## Data flow — adding a Slack context

```
User pastes permalink in AddSlackContextDialog
  → api-client.linkSlackContext(taskId, permalink)
  → POST /api/tasks/[id]/slack-contexts
    1. requireAuthedMember(workspaceId)
    2. Zod-validate body.permalink
    3. service.linkSlackPermalink(taskId, permalink, member.id)
       a. parsePermalink → { teamId, channelId, ts, threadTs? }
       b. load SlackIntegration by workspaceId (412 if none)
       c. teamId mismatch → 400 wrong_team
       d. token = decrypt(integration.accessToken)
       e. channelName = await resolveChannelName(token, channelId)
       f. raw = threadTs
            ? await fetchThread(token, channelId, threadTs)
            : [await fetchSingleMessage(token, channelId, ts)]
       g. users = await resolveUsers(token, unique userIds in raw)
       h. snapshot = toSnapshot(raw, users)
       i. repo.create({ taskId, workspaceId, permalink, slackTeamId,
                        slackChannelId, slackChannelName,
                        rootTs: threadTs ?? ts, threadTs, isThread: !!threadTs,
                        snapshot, snapshotAt: now,
                        createdById: member.id })
    4. return 201 { context }
  → UI optimistically prepends the card to the list
```

Refresh flow is isomorphic: `service.refreshContext` re-fetches and calls `repo.updateSnapshot(id, snapshot, null)`. On failure, calls `repo.updateSnapshot(id, oldSnapshot, errorMessage)` — old snapshot preserved.

## Error handling

| Failure                               | HTTP | i18n key                              | UX                                                               |
| ------------------------------------- | ---- | ------------------------------------- | ---------------------------------------------------------------- |
| Permalink format invalid              | 400  | `slackContext.error.invalidPermalink` | Dialog inline error                                              |
| Workspace has no SlackIntegration     | 412  | `slackContext.error.notConnected`     | Dialog inline error + CTA to settings                            |
| Permalink from another Slack team     | 400  | `slackContext.error.wrongTeam`        | Dialog inline error                                              |
| Bot not in channel (`not_in_channel`) | 403  | `slackContext.error.notInChannel`     | Dialog inline error with channel name and "invite @LumoBot" hint |
| Channel deleted or message gone       | 404  | `slackContext.error.messageGone`      | Dialog inline error                                              |
| Slack API 5xx / timeout               | 502  | `slackContext.error.slackUnavailable` | Toast + dialog stays open for retry                              |

Refresh failures on an existing context do **not** delete the snapshot — they update `refreshError`, and the card shows a banner: "Refresh failed · {ago}".

## UI

### Tab integration

`app/workspace/[workspaceUrl]/components/TaskDetailTimeline/TimelineTabs.tsx`:

```ts
type TabValue = 'comments' | 'activity' | 'slack' | 'agent'
```

Final tab order: **Comments | Activity | Slack | Agent**.

When the workspace has no SlackIntegration, the Slack tab still renders, with an empty state: "连接 Slack 后才能挂载消息上下文" (or current locale's equivalent). The "Add" button is disabled.

### New components — `TaskDetailTimeline/`

```
SlackContextTab.tsx          // tab content: list of cards + "Add Slack message" button
SlackContextCard.tsx         // single attached context (single msg or thread)
SlackContextThread.tsx       // collapsible thread reply list inside a card
AddSlackContextDialog.tsx    // permalink input + submit, inline error display
slackMrkdwn.ts               // minimal Slack mrkdwn → React nodes
                             // (*bold*, _italic_, <@U…>, <#C…|name>, links)
```

Hook: `hooks/useSlackContexts.ts` — SWR-style fetch of `GET /api/tasks/[id]/slack-contexts`, consistent with `useTimeline` / `useAgentRuns`.

### Card layout (text-mode sketch)

```
┌─ #design · Alice · 2h ago ──────────── 🔄 🗑 ─┐
│ 想用 OAuth + magic link 双通道，但…             │
│                                                │
│ ▼ thread · 3 replies                           │
│   Bob: +1                                      │
│   Alice: 那就先做 OAuth                         │
│   Carol: 我加进文档了                            │
│                                                │
│ ⚠ Refresh failed · 5m ago    (only if errored) │
└────────────────────────────────────────────────┘
```

Thread is collapsed by default to "thread · N replies", expandable.

### Mentions in rendered text

`<@U123>` and `<#C123|name>` rendered as styled chips with the resolved display name. Avatars use `userAvatarUrl` from snapshot when available.

## `lumo task context` markdown output

The CLI's `task-context.ts` does the final markdown assembly (header → description → `memorySection` → previous sessions). The server pre-renders `memorySection` as a markdown string in `lib/services/task-context.service.ts` and returns it on the JSON response. Slack Context follows the same split:

- **Server** — `task-context.service.ts` reads `taskSlackContextRepository.listByTask(taskId)` and pre-renders a markdown string. The response shape gains `slackContextSection?: string` next to `memorySection`. Empty string when no contexts attached.
- **CLI** — `cli/src/commands/task-context.ts` accepts the new field and inserts it between `memorySection` and `## Previous Sessions`.

Section format:

```markdown
## Slack Context

### #design · Thread (4 messages, fetched 2026-05-19 10:00 UTC)

permalink: https://lumo.slack.com/archives/C01/p1700000000000100

- **Alice** (2026-05-18 14:00 UTC): 想用 OAuth + magic link 双通道，但…
- **Bob** (14:02): +1
- **Alice** (14:05): 那就先做 OAuth
- **Carol** (14:08): 我加进文档了

### #engineering · Single message (fetched 2026-05-19 10:00 UTC)

permalink: https://lumo.slack.com/archives/C02/p1701234500000200

- **Bob** (2026-05-18 09:30 UTC): 明天发布前再过一遍
```

Mrkdwn is converted to plain text for agent consumption: `<@U123>` → `@alice`, `<#C123|design>` → `#design`. No `<...>` angle-bracket tokens leak through.

If a context has `refreshError`, append `(refresh failed: <reason>)` after the fetched-at line so the agent knows the snapshot may be stale.

## Testing

Jest. Test files under `__tests__/` mirroring source layout.

### Repository — `__tests__/repositories/taskSlackContext.repository.test.ts`

- `create` writes all columns; `listByTask` orders newest-first; `updateSnapshot` does not mutate `createdAt`/`createdById`; `delete` removes the row.

### Service — `__tests__/services/taskSlackContext.service.test.ts`

Mock `SlackContextFetcher` and repository.

- `linkSlackPermalink`: success path; no SlackIntegration → 412 `not_connected`; wrong team → 400 `wrong_team`; fetcher throws `not_in_channel` → 403; fetcher throws `channel_not_found` → 404.
- `refreshContext`: success overwrites snapshot and clears `refreshError`; fetcher failure preserves old snapshot and writes `refreshError`.
- `unlinkContext`: non-member → 403; member → success.

### Permalink parser — `__tests__/integrations/slack/parsePermalink.test.ts`

This is the bug-prone surface; cover heavily.

- Single message permalink, no query string.
- Thread reply with `thread_ts` + `cid`.
- Query parameters in arbitrary order.
- Channel id with digits and uppercase letters.
- `p…` segment with leading zeros after the `.`.
- Malformed inputs return null / throw with `invalidPermalink`.

### Slack fetcher — `__tests__/integrations/slack/context-fetcher.test.ts`

Mock `fetch`. Verify:

- `fetchSingleMessage` posts `conversations.history` with `latest=ts&inclusive=true&limit=1`.
- `fetchThread` posts `conversations.replies` and paginates on `response_metadata.next_cursor`.
- `resolveUsers` deduplicates ids and parallelizes.
- Slack `error: "not_in_channel"` propagates as a typed exception.

### API route — `__tests__/api/tasks/slack-contexts.test.ts`

Use the project's existing mock-request pattern.

- 401 unauthenticated; 403 non-member; 400 on Zod failure; 201 on success; `GET` returns the list.

### UI — React Testing Library

- `SlackContextTab` empty-state (no contexts; no integration); list rendering.
- `AddSlackContextDialog` submit triggers `onSubmit` with permalink; inline error display when API returns 400/403/412.

E2E is out of scope for LUM-44 — the project has no e2e harness yet.

## i18n

Per CLAUDE.md: every locale file in `lib/i18n/` gets a real translation (no English fallback). Run the LUM-42 parity guard before merging.

New keys (all under `slackContext.` prefix):

```
slackContext.tab
slackContext.empty.notConnected
slackContext.empty.noContexts
slackContext.add
slackContext.refresh
slackContext.unlink
slackContext.fetchedAgo                  // "Fetched {ago}"
slackContext.thread.replies              // "{n, plural, one {1 reply} other {# replies}}"
slackContext.refresh.failedBanner        // "Refresh failed · {ago}"
slackContext.dialog.title
slackContext.dialog.permalinkLabel
slackContext.dialog.permalinkPlaceholder
slackContext.dialog.submit
slackContext.error.invalidPermalink
slackContext.error.notConnected
slackContext.error.wrongTeam
slackContext.error.notInChannel          // includes channel name placeholder
slackContext.error.messageGone
slackContext.error.slackUnavailable
```

## Acknowledged limitations

- Private channels require the LumoBot to be invited before a permalink can be fetched. The UI surfaces the failure but does not auto-invite.
- A deleted source message keeps showing the cached snapshot; refresh will fail and surface the banner.
- `snapshot` JSON has no hard size cap. Very long threads write large rows. Acceptable at current scale; monitor JSON-column size and revisit if needed.
- User-display-name resolution depends on `users.info` succeeding at fetch time. If it fails, the snapshot stores the raw user id in `userId` with `userName: null`; the UI falls back to `@U123`.

## PR checklist (per CLAUDE.md)

- [ ] New Prisma migration created (existing migrations untouched).
- [ ] `npx tsc --noEmit` clean.
- [ ] No `console.log` in production code.
- [ ] Branch: `lumo/LUM-44-add-slack-task-context`.
- [ ] PR title: `feat: add Slack message/thread as task context [LUM-44]`.
- [ ] No new npm dependencies — fetcher reuses the raw-`fetch` pattern from `notify.ts`.
- [ ] All locale files updated; LUM-42 i18n parity guard green.
