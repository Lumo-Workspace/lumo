# PR ↔ Task Comment Bidirectional Mirror — Design

**Task**: [LUM-90](https://www.uselumo.ai/workspace/lumo/my-tasks/LUM-90)
**Date**: 2026-05-24
**Status**: design draft, pending review

## Goal

Mirror comments between Lumo tasks and their linked GitHub pull requests in both directions, so that "looking at the task" and "looking at the PR" surface the same discussion history.

In scope (MVP):

- All three GitHub PR comment kinds — `issue_comment` (PR conversation), `pull_request_review` (review summary, including Approve / Request changes), `pull_request_review_comment` (line-level)
- Both directions, day 1
- Author attribution on PR side: post via the author's GitHub OAuth token when available, fallback to the GitHub App identity with a Lumo prefix
- Author attribution on task side: map GitHub login to a Lumo user when possible, otherwise a pseudo `github:<login>` actor
- Edit and delete mirrored both ways
- Line-level review comments rendered on the task with a header block linking back to the diff
- No backfill — only events that fire after a PR is linked to a task
- Mirrored inbound comments fire the same notification path (Slack DM / inbox / @mention) as native comments

Out of scope — see §7.

## §1 Data model + high-level architecture

### Schema

Two new tables; no new columns on `Comment` itself (one back-relation only).

```prisma
enum PrCommentSource { ISSUE  REVIEW  REVIEW_LINE }
enum DiffSide        { LEFT   RIGHT }
enum OutboundActor   { USER_OAUTH  BOT_APP }
enum SyncDirection   { OUTBOUND  INBOUND }
enum SyncJobStatus   { PENDING  DEAD_LETTER }

model PrCommentMirror {
  id                  String   @id @default(cuid())
  commentId           String   @unique
  comment             Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)
  pullRequestId       String
  pullRequest         PullRequest @relation(fields: [pullRequestId], references: [id])

  externalSource      PrCommentSource
  externalId          String                  // GitHub comment id (or "pending-<cuid>" while reserved)
  externalNodeId      String?                 // GraphQL node id
  externalUrl         String
  externalUpdatedAt   DateTime                // GitHub-side updated_at; conflict basis
  lastSyncedAt        DateTime
  deletedAt           DateTime?               // soft-delete tombstone for echo defense & audit

  filePath            String?                 // REVIEW_LINE only
  lineStart           Int?
  lineEnd             Int?
  diffSide            DiffSide?
  inReplyToExternalId String?                 // GitHub review reply chain

  outboundActor       OutboundActor           // last writer identity
  outboundActorUserId String?                 // populated when outboundActor = USER_OAUTH

  @@unique([externalSource, externalId])
  @@index([pullRequestId])
}

model PrCommentSyncJob {
  id            String          @id @default(cuid())
  direction     SyncDirection
  payload       Json                          // minimal snapshot needed to replay
  commentId     String?                       // OUTBOUND: source comment
  externalId    String?                       // INBOUND: source GH comment
  attempts      Int             @default(0)
  lastError     String?
  status        SyncJobStatus   @default(PENDING)
  scheduledFor  DateTime        @default(now())
  workspaceId   String
  @@index([status, scheduledFor])
}
```

`Comment` gains: `mirror PrCommentMirror?` back-relation. No other columns.

A new actor identity is needed for unmapped GitHub users — modeled either as a new `Actor` type `GITHUB_USER` or as `USER` with an `external = true` flag. Avatar = `https://avatars.githubusercontent.com/u/<id>?v=4`, displayName = `github:<login>`. Final shape is open question 1 — decided during plan write-up after re-reading the current Actor model.

### PR ↔ task linkage source of truth

`PullRequest.taskId` (already in schema, populated by both the auto branch-name parser and the manual link API). It is the sole gate — if `taskId` is null, all sync logic short-circuits to no-op.

### High-level flow

```
OUTBOUND  Comment.{create,update,delete}
            → commentService passes { mirrorOrigin: 'user' | 'inbound' }
            → if mirrorOrigin === 'user' AND task has linked PR AND comment.type !== AGENT:
                waitUntil(prCommentMirror.runOutbound(commentId, op))
            → resolveActor (USER_OAUTH preferred, BOT_APP fallback)
            → reserve PrCommentMirror row (placeholder externalId)
            → call GitHub via prCommentClient
            → on success: patch mirror with real externalId, externalUpdatedAt, lastSyncedAt
            → on failure: insert PrCommentSyncJob{ direction: OUTBOUND }

INBOUND   POST /api/webhooks/github  (existing route)
            → dispatch by event: issue_comment | pull_request_review | pull_request_review_comment
            → handlerXxx looks up PR by repo+number, short-circuits if !taskId
            → prCommentMirror.runInbound(payload)
            → echo check → dedupe → resolve author → resolve parent → conflict check → mutate
            → calls commentService with { mirrorOrigin: 'inbound' }
            → notifications dispatched with source: 'pr-mirror' tag (native flow, no suppression)

RETRY     cron /api/cron/pr-comment-retry  (*/1 * * * *)
            → pick up to 50 due PrCommentSyncJob rows
            → run direction-appropriate handler
            → success → delete job; fail → attempts++, exponential backoff (1m / 5m / 15m)
            → attempts >= 3 → DEAD_LETTER + error log
```

### Module layout

```
lib/services/pr-comment-mirror.service.ts           // both directions, conflict logic, echo logic
lib/integrations/github/pr-comment-client.ts        // octokit wrapper, three endpoints
lib/integrations/github/markdown-bridge.ts          // HTML(Lumo) ↔ markdown(GitHub) with mention chips
lib/repositories/pr-comment-mirror.repository.ts
lib/repositories/pr-comment-sync-job.repository.ts
app/api/webhooks/github/handlers.ts                 // existing file — add 3 handlers
app/api/cron/pr-comment-retry/route.ts              // new
```

## §2 Outbound flow (task → PR)

Entry: `commentService.{create,update,delete}` after DB commit → `prCommentMirror.scheduleOutbound(commentId, op)`.

### Pre-filters (no-op if any hits)

- Comment's task has no linked PullRequest
- `Comment.type === AGENT` (agent replies do not push to GitHub)
- `opts.mirrorOrigin === 'inbound'` (event came from a webhook — would loop)

### Actor resolution (cached 10 min)

```
resolveActor(authorActor, repo):
  if authorActor.kind == USER:
    integration = lookupGitHubIntegration(authorActor.userId, workspaceId)
    if integration && canWriteRepo(integration.token, repo):
      return { actor: USER_OAUTH, token: integration.token, userId: authorActor.userId }
  return { actor: BOT_APP, token: githubAppInstallationToken(repo) }
```

`canWriteRepo` does `GET /repos/{owner}/{repo}` once and inspects `permissions.push`. Result cached per (userId, repo) for 10 minutes in-process (best-effort — Vercel cold starts will repopulate; acceptable since the call is cheap and infrequent per session).

### Body construction

| Actor        | Body format                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER_OAUTH` | comment body markdown-rendered as-is; @mention chips resolved to `@github_login` when the mention target has a `GitHubIntegration`, otherwise to plain `张三` |
| `BOT_APP`    | prefix block: `**[张三](https://www.uselumo.ai/.../comment/cmd_xxx) 在 Lumo 说：**\n\n<rendered body>`                                                        |

Body conversion: new module `lib/integrations/github/markdown-bridge.ts`, exports `lumoHtmlToGithubMarkdown(html, mentionResolver)`.

### Endpoint selection

| Lumo comment shape                 | GitHub endpoint                                                             | Resulting source |
| ---------------------------------- | --------------------------------------------------------------------------- | ---------------- |
| Top-level (parent = null)          | `POST /repos/.../issues/{n}/comments`                                       | ISSUE            |
| Reply to a mirror ISSUE comment    | same as above (GitHub issue_comment has no thread API)                      | ISSUE            |
| Reply to a mirror REVIEW (summary) | same as above; body prefixed with quote of parent                           | ISSUE            |
| Reply to a mirror REVIEW_LINE      | `POST /repos/.../pulls/{n}/comments` with `in_reply_to = parent.externalId` | REVIEW_LINE      |

Outbound never produces a `pull_request_review` (Approve / Request changes are structured review actions, not freeform comments; users perform those in GitHub UI).

### Mirror reservation pattern (echo defense — see §4)

Before the GitHub call:

```
mirror = prCommentMirrorRepo.reserve({
  commentId,
  pullRequestId,
  externalSource,
  externalId: `pending-${cuid()}`,
  outboundActor,
  outboundActorUserId,
  ...lineFields,
  lastSyncedAt: now(),
  externalUpdatedAt: now(),  // placeholder, overwritten after POST returns
})
```

After GitHub responds, patch in the real `externalId`, `externalNodeId`, `externalUrl`, `externalUpdatedAt = response.updated_at`.

### Update path

`prCommentMirror.runOutbound(commentId, 'UPDATE')`:

- Look up mirror (must exist or we have a state bug — log + create job to recover)
- Build new body via the same bridge
- `PATCH /repos/.../{issues|pulls}/comments/{externalId}` per source
- Patch mirror with new `externalUpdatedAt` + `lastSyncedAt`

### Delete path

- `DELETE /repos/.../{issues|pulls}/comments/{externalId}`
- Set `mirror.deletedAt = now()` (do **not** delete the row — needed for echo defense and audit)

### Failure handling

octokit throws → insert `PrCommentSyncJob{ direction: OUTBOUND, commentId, payload: { op } }`, cron picks up.

## §3 Inbound flow (PR → task)

### Webhook event subscriptions to add

| Event                         | Actions handled                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `issue_comment`               | `created` / `edited` / `deleted`, filtered to `issue.pull_request != null` (skip true issues) |
| `pull_request_review`         | `submitted` / `edited` / `dismissed` (already subscribed; current handler is empty stub)      |
| `pull_request_review_comment` | `created` / `edited` / `deleted`                                                              |

`pull_request_review` is already in the webhook registration; `issue_comment` and `pull_request_review_comment` need to be added in the GitHub App settings panel (see deployment checklist in §7).

### Handler skeleton

Each handler is thin:

```ts
async function handleIssueComment(payload) {
  if (!payload.issue.pull_request) return // real issue, not a PR
  const pr = await prRepo.findByRepoAndNumber(
    payload.repository,
    payload.issue.number
  )
  if (!pr?.taskId) return
  return prCommentMirror.runInbound({
    event: 'issue_comment',
    action: payload.action,
    workspaceId: pr.workspaceId,
    taskId: pr.taskId,
    pullRequestId: pr.id,
    raw: payload,
  })
}
```

`runInbound` does all parsing, dedupe, author resolution, parent resolution, and conflict handling.

### runInbound decision tree

```
1. echo / dedupe (§4)
2. parse source: issue_comment → ISSUE | pull_request_review → REVIEW | pull_request_review_comment → REVIEW_LINE
3. resolve author
4. resolve parent (REVIEW_LINE only)
5. dispatch by action: created → CREATE | edited → UPDATE | deleted → DELETE | dismissed → UPDATE (with state change to body)
```

### Author resolution

```
resolveInboundAuthor(workspaceId, githubUser):
  if githubUser.type == 'Bot' && githubUser.login == BOT_LOGIN:
    return SKIP    // defensive last-line echo defense; main echo path is in §4
  integration = lookupGitHubIntegrationByLogin(workspaceId, githubUser.login)
  if integration:
    return { actorId: integration.memberActorId }
  return upsertGithubPseudoActor(workspaceId, githubUser)
```

`upsertGithubPseudoActor` creates or returns an `Actor` row with type `GITHUB_USER`, externalId = `<githubUser.id>`, displayName = `github:<login>`, avatarUrl from GitHub.

### Body construction (GitHub → Lumo)

Each body is HTML, wrapped with a marker block at the top (only when applicable). The marker is an HTML comment `<!-- pr-mirror-header type="..." -->` that the outbound path detects and strips.

| Source      | Body                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISSUE       | `githubMarkdownToLumoHtml(payload.comment.body)`; `@github_login` → Lumo @mention chip when mapped, else plain text                                              |
| REVIEW      | header: `<state-icon> <state-label>` (APPROVED → ✅ Approved, CHANGES_REQUESTED → 🛑 Requested changes, COMMENTED → 💬 Commented) + `review.body` (may be empty) |
| REVIEW_LINE | header: `📍 在 [src/foo.ts:42](<comment.html_url>) 评论` + `comment.body`                                                                                        |

### Parent resolution (threading)

- REVIEW_LINE with `payload.comment.in_reply_to_id` → look up `PrCommentMirror{ externalSource: REVIEW_LINE, externalId: in_reply_to_id }` → set `parentId = mirror.commentId`
- ISSUE / REVIEW → `parentId = null`
- Parent mirror missing (rare race: child arrives before parent webhook is processed) → create as top-level + insert `PrCommentSyncJob{ direction: INBOUND, scheduledFor: now + 30s }` for a single reconciliation pass

### Write path

```ts
await prisma.$transaction(async (tx) => {
  const comment = await commentRepo.create({ ... }, tx)
  await prCommentMirrorRepo.create({
    commentId: comment.id,
    pullRequestId,
    externalSource, externalId, externalNodeId, externalUrl, externalUpdatedAt,
    lastSyncedAt: now(),
    ...lineFields,
  }, tx)
  return comment
})
await commentNotifications.dispatch(comment, { source: 'pr-mirror' })
```

`source: 'pr-mirror'` lets the notification template add "from PR #123" attribution. It does **not** suppress notifications.

### Soft-delete behaviour

- Inbound DELETE: `commentRepo.softDelete(commentId)` (or hard-delete if the model has no softDelete concept — see open question 2), and `mirror.deletedAt = now()`
- Inbound UPDATE on a previously deleted local row: revive (clear `deletedAt`), update body

## §4 Echo loop prevention + conflict resolution

### Two echo edges

**Edge A — outbound POST returns, GitHub then fires webhook:**

- Inside `runOutbound`, the mirror upsert happens **synchronously after the GitHub call returns**, before `runOutbound` resolves (the outer `waitUntil` only delays kicking off `runOutbound`; the DB write is not itself fire-and-forget)
- After successful POST/PATCH, mirror has `externalUpdatedAt = response.updated_at`
- Webhook handler's first action: `prCommentMirrorRepo.findByExternal(source, externalId)`
- Hit AND `mirror.externalUpdatedAt >= payload.comment.updated_at` → echo, drop

**Edge B — inbound creates a Lumo Comment, which would trigger outbound:**

- `commentService.{create,update,delete}` takes `opts?: { mirrorOrigin?: 'inbound' }`
- `prCommentMirror.runInbound` always passes `{ mirrorOrigin: 'inbound' }` when invoking commentService
- `scheduleOutbound` first check: `if (opts?.mirrorOrigin === 'inbound') return`
- No time-window heuristics. Pure explicit context propagation.

### Race patch: webhook arrives before outbound response is processed

- Outbound `reserve` writes a placeholder mirror row (`externalId = "pending-<cuid>"`) **before** the GitHub call
- Webhook arrives → `findByExternal` misses (real externalId not yet stored)
- Fallback lookup: `findRecentPlaceholder(pullRequestId, bodyHash, withinSeconds: 60)` matches by content + author + recency. `bodyHash` is computed over the **outbound-rendered markdown** (after `lumoHtmlToGithubMarkdown`), since that's what GitHub will echo back in `payload.comment.body`
- Match → treat as "externalId reveal" event: patch mirror with the real externalId from the webhook, do **not** create a new Comment
- No match → genuine new inbound, proceed normally

### Defensive bot defense

`resolveInboundAuthor` returns SKIP when `githubUser.login === BOT_LOGIN` (configured per environment, e.g. `lumo-app[bot]`). This is the last line; the main echo defenses above should handle it first.

### Conflict resolution — last-write-wins with priority correction

Three timestamps:

- `L` = `comment.updatedAt` (Lumo local)
- `M` = `mirror.externalUpdatedAt` (last known GH time we recorded)
- `T` = `payload.comment.updated_at` (current inbound event's GH time)

`runInbound` UPDATE branch:

```
if T <= M:                  echo, drop
elif L <= M:                inbound is the only edit since last sync → apply
elif L > M AND T > L:       both edited; GH later → apply inbound, log conflict with diff
elif L > M AND T < L:       both edited; local later → schedule outbound UPDATE to push local
                            do not mutate local
```

### Delete conflicts

- **Inbound DELETE always wins** — `softDelete` local, set `mirror.deletedAt`. If the local row had an unmerged edit, that edit is lost (log warning). Rationale: deletion is a stronger signal than "I was editing"
- **Outbound DELETE** — if a remote edit raced in before our DELETE landed, it's already applied locally via the earlier UPDATE webhook; outbound DELETE then propagates normally. Idempotent

### Implementation locus

All decisions above live inside `prCommentMirror.runInbound` / `runOutbound`. Callers (webhook handlers, commentService) are unaware of conflict logic.

## §5 Retry, failure handling, observability

### Job table entries

| Entry    | Trigger                                                         |
| -------- | --------------------------------------------------------------- |
| OUTBOUND | octokit throws / network error / GitHub 5xx / GitHub 429        |
| INBOUND  | parent mirror missing → 30s reconciliation delay (single retry) |

The happy path never inserts a job. The table stays small ("only there when something is wrong").

### Cron

`/api/cron/pr-comment-retry`, schedule `*/1 * * * *` in `vercel.json`.

```
jobs = prCommentSyncJobRepo.findDue({ status: 'PENDING', limit: 50 })
for each job:
  try:
    if direction === OUTBOUND:
      await prCommentMirror.runOutbound(job.commentId, job.payload.op)
    else:
      await prCommentMirror.runInbound(job.payload)
    await prCommentSyncJobRepo.delete(job.id)
  catch e:
    job.attempts += 1
    job.lastError = serializeError(e)
    if isRateLimitError(e):
      // do not consume an attempts slot
      job.attempts -= 1
      job.scheduledFor = rateLimitResetTime(e)
    elif job.attempts >= 3:
      job.status = DEAD_LETTER
      logger.error('pr-mirror dead-letter', { jobId, direction, error: e })
    else:
      job.scheduledFor = now + exponentialBackoff(job.attempts)  // 1m / 5m / 15m
```

50 / minute bounds single-cron-call duration; deeper backlogs drain on subsequent ticks.

### Outbound idempotency

Outbound CREATE retry risk: first POST may have succeeded but mirror write crashed, so a naive retry creates a duplicate PR comment.

Defense: before any OUTBOUND retry, call `GET /repos/.../{issues|pulls}/comments` filtered by recent timestamp, hash-match against the comment body. If a match exists, treat as success — write the mirror, skip the POST. Costs one extra GET per retry but eliminates duplicate posting.

Inbound retries are naturally idempotent (upsert by `externalId`).

### Metrics

Each outbound / inbound invocation emits:

- `pr_mirror.outbound.{ok|fail|echo_drop}`
- `pr_mirror.inbound.{ok|fail|echo_drop|conflict_inbound_wins|conflict_local_wins}`

DEAD_LETTER transitions emit an `error`-level log; existing Sentry / Slack alert plumbing handles surfacing. No new alert channel for MVP.

### Degraded modes

- Webhook signature failure → existing 401 path, unaffected
- GitHub fully down → outbound piles up in job table; inbound silently gaps. Recovery requires manual `lumo pr-mirror backfill <PR>` (post-MVP — MVP accepts the gap)

## §6 Testing strategy

By layer.

### Repository tests (`__tests__/repositories/`)

- `prCommentMirrorRepo` — create / findByCommentId / findByExternal / softDelete / reserve & resolve-placeholder
- `prCommentSyncJobRepo` — findDue time filter / attempts increment / status transitions

### Service tests (`__tests__/services/pr-comment-mirror/`)

GitHub API fully mocked. Organised by file:

- `runOutbound.create.test.ts`
  - No linked PR → no-op
  - AGENT comment → no-op
  - USER_OAUTH path (canWriteRepo true)
  - BOT_APP fallback (no integration)
  - Reply to mirror REVIEW_LINE → in_reply_to populated
  - octokit throws → PrCommentSyncJob inserted
- `runOutbound.update.test.ts`, `runOutbound.delete.test.ts`
  - Including the idempotency pre-call on retry
- `runInbound.create.test.ts`
  - PR has no taskId → no-op
  - Existing mirror, externalUpdatedAt >= T → echo drop
  - Mapped author → use member actor
  - Unmapped author → GITHUB_USER pseudo actor
  - REVIEW_LINE with in_reply_to → parentId resolved
  - Parent mirror missing → top-level + delayed job
- `runInbound.update.test.ts`
  - Each conflict branch (T<=M, L<=M<T, M<L<T, M<T<L)
- `runInbound.delete.test.ts`
  - Inbound DELETE wins over unmerged local edit
- `echo-roundtrip.test.ts`
  - Full outbound → webhook return cycle, verifying no duplicate creation / update

### API route tests

- `/api/webhooks/github` — existing fixture file gains three new event fixtures; signature failure still 401
- `/api/cron/pr-comment-retry` — cron auth, 50 / call cap, DEAD_LETTER transition

### Markdown bridge tests

`lib/integrations/github/markdown-bridge.test.ts`:

- Lumo mention chip → `@github_login` (mapped) or plain `张三` (unmapped)
- GitHub markdown → Lumo HTML, header marker not echoed back
- Fuzz-style round-trip stability check on simple markdown (tolerant, not strict equality)

### Integration test

One scenario in `__tests__/integration/pr-mirror-flow.test.ts` with nock-intercepted GitHub:

- User comments on task → outbound dispatched
- Synthetic GitHub webhook arrives → no duplicate created
- Inbound edit arrives → applied → outbound triggered
- Verify echo blocked
- Inbound delete → local softDelete

No real-GitHub e2e suite. The deployment checklist below covers manual verification on Lumo's own repo.

## §7 Deployment checklist + out of scope + open questions

### Deployment checklist

1. GitHub App settings panel: add webhook subscriptions for `issue_comment`, `pull_request_review_comment` (`pull_request_review` is already subscribed)
2. Webhook secret unchanged — no rotation
3. Database migration applies: `PrCommentMirror` + `PrCommentSyncJob` + `Comment.mirror` back-relation + new enums (`PrCommentSource`, `SyncDirection`, `SyncJobStatus`, `OutboundActor`, `DiffSide`) + `Actor.GITHUB_USER` value
4. `vercel.json` adds cron entry: `{ "path": "/api/cron/pr-comment-retry", "schedule": "*/1 * * * *" }`
5. No new env vars (reuse existing `GITHUB_APP_*`)
6. Post-deploy manual verification on Lumo's own repo:
   - Open a PR linked to a Lumo task
   - Post one of each: PR conversation comment, review (with state), line-level review comment
   - Verify all three mirror to the task with correct headers
   - Reply on the task → verify it appears on the PR (USER_OAUTH path if your GH is connected)
   - Edit / delete one of each → verify mirror updates
   - Have a teammate without GitHub integration reply on the task → verify BOT_APP fallback prefix renders correctly

### Out of scope (MVP) — call-outs for future work

- **Historical backfill** when a PR is linked. Post-MVP: `lumo pr-mirror backfill <PR>` CLI command
- **PR not yet linked to a task**: webhook drops the event silently. Future: auto-post on the PR "Reply `/lumo link LUM-N` to associate this PR with a task"
- **Approve / Request changes outbound**: not supported (users perform these in GitHub UI). Future: dedicated "Approve / Request changes" buttons in Lumo task UI that call `POST /reviews`
- **Embedded diff snippet for line-level comments**: MVP only links out, no inline code
- **Dead-letter operator tooling**: `lumo internal pr-mirror dead-letters` / `replay <jobId>` — post-MVP
- **Per-task / per-PR sync toggle**: always on if PR is linked. Future toggle if a real "sensitive PR" use case emerges
- **GitHub reaction mirroring** (👍 / ❤️ etc.): not in scope

### Open questions (resolve during plan write-up)

1. Whether to add `GITHUB_USER` as a new `Actor` type or model it as `USER` with an `external = true` flag — depends on the current Actor model shape, decided after rereading `prisma/schema.prisma` and `lib/services/actor*` during plan writing
2. Whether `Comment` has an existing soft-delete column (`deletedAt`) or whether all deletes are currently hard — affects whether inbound DELETE soft-deletes or hard-deletes the local row
