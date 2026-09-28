# Codebase Concerns

**Analysis Date:** 2026-04-09

## Tech Debt

**Task Repository N+1 Query Pattern:**

- Issue: `lib/repositories/task.repository.ts` method `isDescendant()` performs recursive queries in a loop (lines 168-179). For deep task hierarchies, this triggers one query per parent level.
- Files: `lib/repositories/task.repository.ts:168-179`
- Impact: Poor performance for tasks with deep parent-child chains; scales O(depth) instead of O(1).
- Fix approach: Replace recursive query with single PostgreSQL `WITH RECURSIVE` query using Prisma `$queryRaw` or flatten the query upfront.

**Batch PR Status Updates with Sequential Fetches:**

- Issue: `lib/services/task.service.ts:75` iterates over open PRs and fetches GitHub API status for each PR sequentially. With many open PRs, this causes waterfall requests.
- Files: `lib/services/task.service.ts:70-122`
- Impact: Slow task detail page when task has many linked PRs; blocks on sequential GitHub API latency.
- Fix approach: Batch GitHub API calls using `Promise.all()` or implement parallel fetching with rate limit awareness.

**Duplicate Check AI Pre-filtering Limitation:**

- Issue: `app/api/tasks/check-duplicates/route.ts:35` has TODO comment documenting that projects with >200 tasks need optimization. Currently fetches 200 most recent tasks and sends all to Claude for semantic matching.
- Files: `app/api/tasks/check-duplicates/route.ts:35-36`
- Impact: AI duplicate detection becomes slow/expensive at scale; does not use full-text search pre-filter as documented.
- Fix approach: Implement full-text search pre-filtering before sending subset to Claude, or use Postgres `<->` vector similarity with embeddings.

**Missing Task Update Notifications in Quick Dispatch Batch:**

- Issue: `lib/services/quick-dispatch.service.ts:82` notes TODO that batch task updates (status/assignee changes) do not dispatch notifications. Only Pusher real-time updates fire, no Slack/email notifications.
- Files: `lib/services/quick-dispatch.service.ts:82-85`
- Impact: Users and reviewers miss notifications for quick-dispatch bulk updates; notification pattern works fine in single-task updates but skipped here for performance reasons.
- Fix approach: Either queue notifications asynchronously after batch completes, or defer detailed notification context fetching to background job.

**Large Component Files with Mixed Concerns:**

- Issue: Several UI components exceed 800 lines and mix data fetching, state management, and rendering:
  - `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx` (866 lines)
  - `app/workspace/[workspaceUrl]/components/BubbleMenuBar.tsx` (813 lines)
  - `app/workspace/[workspaceUrl]/WorkspaceApp.tsx` (751 lines)
  - `app/workspace/[workspaceUrl]/components/CommentSection.tsx` (736 lines)
- Files: Listed above
- Impact: Hard to test, debug, and modify these components; violates SRP principle from CLAUDE.md.
- Fix approach: Extract data-fetching logic into custom hooks, split rendering into smaller presentational components, move business logic to lib/services.

**Agent Execution Complexity (1438 lines):**

- Issue: `lib/agent/execute.ts` is the largest file in the codebase at 1438 lines. Contains agent setup, sandbox management, GitHub integration, spec generation, and state management all in one file.
- Files: `lib/agent/execute.ts`
- Impact: Difficult to reason about agent flow; hard to test phases independently; high cognitive load for modifications.
- Fix approach: Extract phases (setup, execute, finalize) into separate modules; create AgentExecutionContext object to pass state between phases.

**Credential Exposure in .env.production:**

- Issue: `.env.production` file (committed to git) contains actual Neon Postgres credentials including password and connection string (lines 12-13).
- Files: `.env.production`
- Impact: Database credentials are exposed in version control history. Anyone with repo access has full DB write access. This is a **critical security issue**.
- Fix approach: Immediately rotate Neon DB password. Remove `.env.production` from git history (git filter-branch or BFG). Move all secrets to Vercel environment variables. Add `.env.*` to `.gitignore`.

## Known Bugs

**Duplicate Task Clustering Inefficiency:**

- Symptoms: Large projects (500+ tasks) experience timeout or slow UI when checking for duplicates on new task creation.
- Files: `app/api/tasks/check-duplicates/route.ts`, `lib/repositories/task.repository.ts:296-318`
- Trigger: Create new task in project with >200 existing tasks.
- Workaround: Refresh the page or increase Vercel function timeout (currently may be 30s or less for API routes).

**PR Status Not Always Synced:**

- Symptoms: Pull request state (open/merged/closed) in task detail may lag behind actual GitHub state by several minutes.
- Files: `lib/services/task.service.ts:70-122`
- Trigger: Merge a PR on GitHub; view task detail shortly after (before scheduler runs, if exists).
- Workaround: Manual page refresh or wait for next automatic sync.

## Security Considerations

**Database Credentials Committed to Git:**

- Risk: Production Neon Postgres password and connection URL exposed in `.env.production`. Credentials can be extracted from git history even if file is later deleted.
- Files: `.env.production`
- Current mitigation: None; file is committed.
- Recommendations:
  1. **Immediate:** Rotate Neon DB password in Vercel dashboard.
  2. **Immediate:** Remove `.env.production` from git history using `git filter-branch` or BFG Repo-Cleaner.
  3. **Ongoing:** Use Vercel Environment Variables only for secrets. Never commit `.env.production`, `.env.local`, or `.env` files.
  4. **CI/CD:** Update GitHub Actions (if any) to use Vercel-injected env vars instead of committed files.

**Webhook Signature Verification Coverage:**

- Risk: GitHub webhook handler verifies signature (`app/api/webhooks/github/route.ts:37`), but if signature verification fails, returns 401. Slack webhook handler has replay attack prevention (5-minute timestamp check, `app/api/webhooks/slack/route.ts:14-15`). However, GitHub handler lacks explicit replay protection.
- Files: `app/api/webhooks/github/route.ts`, `app/api/webhooks/slack/route.ts`
- Current mitigation: GitHub webhook signature via HMAC-SHA256 (prevents forgery, but not replay).
- Recommendations:
  1. Add nonce/request ID tracking for GitHub webhooks (store in DB, check for duplicates).
  2. Document webhook idempotency requirements (POST endpoints should be idempotent in case of retries).

**Slack Token Decryption Without Validation:**

- Risk: `app/api/webhooks/slack/route.ts:62` decrypts integration.accessToken without validating integration state. If integration is revoked or token is invalid, command execution may fail silently or crash.
- Files: `app/api/webhooks/slack/route.ts:59-62`
- Current mitigation: try-catch at route level logs errors but returns 200 to Slack.
- Recommendations:
  1. Validate decrypted token format before use (check if it starts with `xoxb-` or similar).
  2. Add early error handling: if decryption fails or token is malformed, return 200 immediately (Slack won't retry 200s).

**Encryption Key Exposure Risk:**

- Risk: `ENCRYPTION_KEY` (AES-256-GCM for GitHub/Slack tokens) is environment variable. If Vercel dashboard is compromised or developer machine has leaked .env files, this key is exposed.
- Files: `.env.example` (line 66), actual key in Vercel secrets
- Current mitigation: Key stored in Vercel environment variables (not in git).
- Recommendations:
  1. Audit Vercel IAM settings: ensure only necessary team members can view environment variables.
  2. Use Vercel's Managed Secrets feature if available (more restricted access).
  3. Rotate encryption key annually and re-encrypt all stored tokens.

## Performance Bottlenecks

**AI Duplicate Detection Scaling:**

- Problem: Sending 200 tasks to Claude API for semantic matching becomes expensive and slow at scale. Cost scales O(task_count \* tokens_per_task).
- Files: `app/api/tasks/check-duplicates/route.ts:37-64`
- Cause: No pre-filtering before AI. All 200 task titles serialized and sent to Claude.
- Improvement path:
  1. Implement BM25 full-text search pre-filter to narrow from 200 to ~20 candidates.
  2. Cache task embeddings in `Task` table, use Postgres `<->` similarity operator for initial filtering.
  3. Fall back to Claude only for top-N closest candidates.

**Sequential GitHub PR Status Sync:**

- Problem: For each open PR linked to a task, one network request to GitHub API. For task with 10 PRs, 10 sequential requests. Waterfall pattern.
- Files: `lib/services/task.service.ts:75-117`
- Cause: `for...of` loop with `await fetch()` inside.
- Improvement path:
  1. Use `Promise.all()` to fetch all PR statuses in parallel.
  2. Respect GitHub API rate limits (60 requests/hour for unauthenticated, 5000 for authenticated). Implement exponential backoff.
  3. Consider batch GitHub API query if available (currently fetching one PR at a time).

**Task Repository Include Bloat:**

- Problem: `TASK_DETAIL_INCLUDE` (lines 5-107 in `lib/repositories/task.repository.ts`) loads all relations: assignee, reviewer, PRs, branches, clarifications, parent, children, agent runs. For read-heavy pages with 50+ tasks, this multiplies DB load.
- Files: `lib/repositories/task.repository.ts:5-107`
- Cause: Eager-loading all relations regardless of whether they're used on current page/view.
- Improvement path:
  1. Create separate lighter-weight queries for list views (e.g., `TASK_LIST_INCLUDE` with only project, team, assignee).
  2. Lazy-load children/PRs only when task detail panel is opened.
  3. Paginate agent runs and PRs (currently loads all).

## Fragile Areas

**GitHub Integration Token Refresh:**

- Files: `lib/integrations/github/index.ts`, `app/api/webhooks/github/handlers.ts`
- Why fragile: GitHub OAuth tokens may expire. If an installation is uninstalled or token is revoked, webhook handlers will fail silently. No validation that token is still valid before using it.
- Safe modification: Always wrap `getRepoToken()` and API calls in try-catch. Check for 401/403 responses from GitHub API. Log token refresh failures for debugging.
- Test coverage: Need integration tests for token revocation scenario.

**Slack Command Execution Fire-and-Forget:**

- Files: `app/api/webhooks/slack/route.ts:127-130`
- Why fragile: `executeCommand()` is fire-and-forget with `.catch()` only. If command fails (e.g., network error posting result back to Slack), user never sees the result. No retry mechanism.
- Safe modification: Consider queueing long-running commands (Quick Dispatch) to background job with retry logic. For simple commands, use Slack's `response_url` timeout more carefully (currently has 3-second limit).
- Test coverage: Need tests for network failures in command execution.

**Agent Spec Confirmation Race Condition:**

- Files: `app/api/tasks/[id]/confirm-spec/route.ts` (implied from context)
- Why fragile: If agent finishes execution and records spec while user is confirming it, there's potential for concurrent updates. No optimistic locking or version field on spec.
- Safe modification: Add `specVersion` or `specConfirmedAt` timestamp to Task. Check version before updating.
- Test coverage: Need concurrency tests for simultaneous agent completion + manual spec confirmation.

**Large Components Without Error Boundaries:**

- Files: `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx`, `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`, others
- Why fragile: Large components with many sub-components. If any child throws an error, entire page crashes with no fallback UI.
- Safe modification: Wrap major sections in React Error Boundaries. Add error boundary around data-fetching hooks.
- Test coverage: Add error-case tests for each large component (what happens if API call fails).

**Prisma Query Result Assumptions:**

- Files: `lib/repositories/task.repository.ts` and all other repository files
- Why fragile: Many queries use `findUnique()` without null-checks, e.g., `const task = taskRepository.findById(id)`. Callers assume task exists. If ID is invalid, `null` is silently returned.
- Safe modification: Either throw 404 in repository if not found, or enforce null-checking in calling code (TypeScript strict mode helps, but doesn't force it).
- Test coverage: Add tests for not-found scenarios in each repository method.

## Scaling Limits

**Task Hierarchy Depth:**

- Current capacity: Arbitrary depth supported, but `isDescendant()` query is O(depth). Deep hierarchies (10+ levels) become slow.
- Limit: Recursive Prisma queries break around 15-20 depth for typical Vercel function timeout (30s).
- Scaling path: Replace recursive query with `WITH RECURSIVE` SQL. Limit depth to 5-7 levels at application layer.

**Duplicate Check Project Size:**

- Current capacity: 200 tasks cached in memory, processed by Claude.
- Limit: Claude context token limit (~200k tokens). 200 tasks \* ~50 tokens/task = ~10k tokens (safe). But Claude API cost multiplies with project size.
- Scaling path: Implement embedding-based search (local LLM for embeddings) before sending to Claude. Use batched API calls.

**Real-time Events (Pusher):**

- Current capacity: Pusher channels created per workspace/project. If workspace has 100 projects, 100+ channels active simultaneously.
- Limit: Pusher free/hobby tier has limits on concurrent connections and events/second. Production may hit rate limits during high activity.
- Scaling path: Aggregate events into batches (debounce Pusher messages). Move to WebSockets with custom server for lower latency.

**Database Connection Pool:**

- Current capacity: Neon connection pooling via PgBouncer (DATABASE_URL uses pooler endpoint). Typical pool size is 15-25 connections.
- Limit: Serverless Vercel functions may exhaust pool during traffic spikes. Each concurrent function request holds a connection.
- Scaling path: Use Prisma connection pooling with shorter `connectionTimeoutMillis`. Consider connection recycling for long-running queries.

## Dependencies at Risk

**E2B Sandbox for Agent Execution:**

- Risk: Agent execution depends on external E2B service (`@e2b/code-interpreter`). If E2B is down or rate-limited, agent runs fail.
- Impact: Users cannot execute agent tasks. No fallback or graceful degradation.
- Migration plan: Evaluate self-hosted sandbox alternative (Docker-based) or fallback to local environment. Implement circuit breaker for E2B API.

**Anthropic Claude API Dependency:**

- Risk: Quick Dispatch and duplicate detection call Claude API directly. If API is down or changes pricing/model behavior, features break.
- Impact: User-facing features (task creation, duplicate detection) become unavailable.
- Migration plan: Add retry logic with exponential backoff. Cache Claude responses where possible (e.g., task similarity scores). Add fallback to simpler heuristic (keyword matching) if Claude API fails.

**Clerk Authentication:**

- Risk: Clerk OAuth provider is critical path for all user auth. If Clerk has outage, users cannot sign in.
- Impact: Complete product unavailability.
- Migration plan: Already mitigated by Clerk's SLA. Ensure fallback refresh token handling is robust.

## Missing Critical Features

**Task Conflict Resolution:**

- Problem: If two agents or users modify the same task simultaneously (e.g., both updating status), last-write-wins (no conflict detection). No merging or user notification of concurrent modification.
- Blocks: Reliable multi-agent task execution, real-time collaborative editing.
- Fix: Add `updatedAt` or version field, implement optimistic locking, or use CRDTs for merge-friendly state.

**Audit Logging:**

- Problem: No centralized audit log of who changed what and when. Activity timeline exists but is task-centric, not workspace-centric.
- Blocks: Compliance (SOC2/ISO27001), security investigations, user behavior analytics.
- Fix: Implement immutable audit log (append-only) in database. Log all mutations (task updates, member changes, integration changes).

**Rate Limiting on API Routes:**

- Problem: No rate limiting on public API routes (check-duplicates, quick-dispatch, etc.). Malicious actor could DOS with repeated requests.
- Blocks: Production deployment with user-facing workloads.
- Fix: Add middleware with rate limiting (e.g., `next-ratelimit`, `@vercel/edge-ratelimit`). Implement per-workspace and per-user limits.

## Test Coverage Gaps

**Webhook Handler Error Cases:**

- What's not tested: Network failures during webhook event processing (Slack fetch fails, GitHub API timeouts).
- Files: `app/api/webhooks/github/handlers.ts`, `app/api/webhooks/slack/route.ts`
- Risk: Silent failures; webhooks are retried by Slack/GitHub but user never knows if the command succeeded.
- Priority: **High** — webhooks are critical path for integrations.

**Task State Machine Edge Cases:**

- What's not tested: Concurrent state transitions (e.g., DONE → IN_REVIEW while agent is updating status).
- Files: `lib/task/state-machine.ts`
- Risk: Invalid state reached; task becomes corrupted.
- Priority: **High** — state machines are foundational.

**Duplicate Detection with Empty Projects:**

- What's not tested: Projects with 0 tasks (edge case for duplicate check algorithm).
- Files: `app/api/tasks/check-duplicates/route.ts`
- Risk: Crashes or returns unexpected results.
- Priority: **Medium** — rare but should not crash.

**GitHub Integration Token Expiry:**

- What's not tested: What happens when GitHub OAuth token expires and webhook arrives.
- Files: `app/api/webhooks/github/handlers.ts`
- Risk: Silent failure, PR updates not synced.
- Priority: **High** — critical for GitHub-linked workflows.

**Component Error Boundaries:**

- What's not tested: How large components respond to API failures (e.g., InboxPage fails to load notifications).
- Files: `app/workspace/[workspaceUrl]/components/pages/InboxPage.tsx`, `app/workspace/[workspaceUrl]/WorkspaceApp.tsx`
- Risk: Full page crashes instead of showing error UI.
- Priority: **Medium** — impacts user experience but not data integrity.

**Prisma Transaction Rollback:**

- What's not tested: Task creation fails mid-transaction; partial state left in DB.
- Files: `lib/services/task.service.ts`, `lib/repositories/task.repository.ts`
- Risk: Orphaned records (e.g., task created but activity not recorded).
- Priority: **Medium** — should use Prisma `$transaction()` blocks.

## RSC/Client-Server Boundary Issues

**Integration Barrel Imports Leaking Server Code:**

- Issue: Commit `b7bc170` fixed integrations barrel leakage. Problem was client components importing from `@/lib/integrations/slack` (barrel export) which exported server-only functions (e.g., `bot` using Discord.js SDK that breaks in browser).
- Files: `lib/integrations/slack/index.ts`, client components that import from integrations
- Impact: Increased bundle size; potential runtime errors in browser if server-only code is included.
- Mitigation: Only import specific submodules, not barrels. E.g., `import { handleCommand } from '@/lib/integrations/slack/commands'` instead of `import { handleCommand } from '@/lib/integrations/slack'`.
- Enforcement: Add ESLint rule to forbid wildcard/barrel imports from `lib/integrations/` in client components, or mark barrel exports with `'use server'`.

**Server Functions in Lib Utilities:**

- Issue: Some utilities in `lib/` (e.g., `lib/repositories/`, `lib/services/`) are implicitly server-only because they call Prisma or use secrets. If client component imports them, build fails or bundle bloats.
- Files: `lib/repositories/`, `lib/services/`
- Impact: Hard to track which lib utilities are server vs. client safe.
- Mitigation: Mark server-only utilities with comment `// @server-only` or add `'use server'` directive at top of files that use Prisma/secrets.

---

_Concerns audit: 2026-04-09_
