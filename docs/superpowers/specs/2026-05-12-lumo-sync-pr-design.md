# LUMO.md Sync-to-PR Design Spec

## Goal

When a user clicks "Sync to LUMO.md" on a task detail page, generate a structured proposal from task memories, preview it, then create a GitHub PR with the LUMO.md changes and redirect the user to the PR page.

## Architecture

Two-step API flow with Git Data API for multi-file commit support. Step 1 generates and previews the proposal; Step 2 creates the branch, commits, opens a PR, and returns the PR URL. All git operations happen server-side via GitHub REST API using the user's existing OAuth token.

## Tech Stack

- Next.js 14 API Routes (App Router)
- GitHub REST API (Git Data API + Pull Requests API)
- Octokit (REST client)
- Radix UI Dialog (preview modal)
- Sonner (toast notifications)
- Existing: Prisma, Zod, `applyOperations()`, `lumoProposalService`, `lumoOnboardingService`

---

## 1. API Design

### `POST /api/tasks/[taskId]/lumo-proposals`

Generates a proposal from task memories and returns it for preview.

- **Auth**: Clerk session required
- **Input**: `{}` (no body needed — backend reads LUMO.md from GitHub)
- **Flow**:
  1. Validate task exists and belongs to user's workspace
  2. Get user's GitHub OAuth token; get project repo info (owner, name) via task → project
  3. Read current LUMO.md from GitHub via Contents API (returns null if not found)
  4. Call `lumoProposalService.generateProposal(taskId, currentLumoMd)`
  5. Return proposal with operations for preview
- **Output**: `{ id, operations, summary }`
- **Errors**: 404 (task not found), 400 (no memories / GitHub not connected), 502 (LLM failure)

### `POST /api/lumo-proposals/[proposalId]/sync`

Takes an existing proposal and creates a GitHub PR.

- **Auth**: Clerk session required
- **Input**: `{}` (proposal already in DB)
- **Flow**:
  1. Validate proposal exists, status === PENDING
  2. Get user's GitHub OAuth token from `GitHubIntegration`
  3. Get project's repo info (owner, name, default branch)
  4. Read current LUMO.md from GitHub default branch
  5. Apply operations in memory via `applyOperations()`
  6. Check onboarding status (LUMO.md exists? CLAUDE.md has @import?)
  7. Create branch + commit all files via Git Data API
  8. Create PR with auto-generated description
  9. Update proposal: status → APPLIED, store prUrl
  10. Return `{ prUrl, prNumber, branchName }`
- **Errors**: 404 (proposal not found), 400 (not PENDING / GitHub not connected), 502 (GitHub API failure)

---

## 2. GitHub Service Layer

### `lib/services/lumo-sync/github-tree.service.ts`

Encapsulates Git Data API operations.

```typescript
interface FileCommit {
  path: string
  content: string
}

interface CreateBranchCommitResult {
  branchName: string
  commitSha: string
}
```

**Methods:**

#### `readFile(owner, repo, path, token): Promise<string | null>`

- `GET /repos/{owner}/{repo}/contents/{path}`
- Returns decoded content (base64 → utf-8) or null if 404

#### `createBranchWithFiles(owner, repo, baseBranch, branchName, files, commitMessage, token): Promise<CreateBranchCommitResult>`

Atomic operation — creates a branch with a single commit containing all files:

1. `GET /repos/{owner}/{repo}/git/ref/heads/{baseBranch}` → base commit SHA
2. `POST /repos/{owner}/{repo}/git/blobs` → create blob for each file
3. `POST /repos/{owner}/{repo}/git/trees` → create tree with all blobs (base_tree from step 1)
4. `POST /repos/{owner}/{repo}/git/commits` → create commit pointing to new tree
5. `POST /repos/{owner}/{repo}/git/refs` → create branch ref pointing to commit

#### `createPullRequest(owner, repo, title, body, head, base, token): Promise<{ prUrl, prNumber }>`

- `POST /repos/{owner}/{repo}/pulls`
- Returns PR URL and number

**Auth:** Each call takes a `token` parameter. The caller (sync service) is responsible for fetching and decrypting the user's OAuth token from `GitHubIntegration`.

**Branch naming:** `lumo/sync-{taskIdentifier}-{timestamp}`

- Example: `lumo/sync-LUM-42-1747062000`

---

## 3. Sync Service

### `lib/services/lumo-sync/lumo-sync.service.ts`

Orchestrates the full sync flow.

```typescript
lumoSyncService = {
  async sync(proposalId: string, userId: string): Promise<{ prUrl, prNumber, branchName }>
}
```

**Steps:**

1. Read proposal from DB, validate status === PENDING
2. Fetch user's GitHub OAuth token via userId → `GitHubIntegration`; error if not connected
3. Fetch project repo info (owner, name, defaultBranch) via proposal.projectId
4. Read current LUMO.md from GitHub default branch via `githubTreeService.readFile()`
5. Apply operations: `applyOperations(currentContent ?? '', operations)` → new content
6. Prepare file list:
   - Always: `LUMO.md` with new content
   - If onboarding (LUMO.md was null): also prepare `CLAUDE.md` with `@import LUMO.md`
7. Create branch + commit via `githubTreeService.createBranchWithFiles()`
8. Create PR via `githubTreeService.createPullRequest()` with auto-generated description
9. Update proposal in DB: status → APPLIED, set `appliedAt`, store `prUrl`
10. Return `{ prUrl, prNumber, branchName }`

**PR Description format:**

```markdown
## Source

Task: {taskIdentifier} — {taskTitle}

## Changes

- **[Add] {section}**: {content summary} — {rationale}
- **[Modify] {section}**: {content summary} — {rationale}

## Summary

{proposal.summary}

---

_Synced by Lumo_
```

**Error handling:** Each step failure throws an Error with `status` property (existing `httpError` pattern). GitHub API errors are wrapped as 502.

---

## 4. Schema Changes

### `lumo_proposals` table — add `prUrl` column

```prisma
model LumoProposal {
  // ... existing fields ...
  prUrl  String?   // GitHub PR URL, set after sync
}
```

Migration: `ALTER TABLE lumo_proposals ADD COLUMN "prUrl" TEXT;`

### Repository update

Add to `lumoProposalRepository`:

```typescript
async updateSyncResult(id: string, status: LumoProposalStatus, appliedAt: Date, prUrl: string)
```

---

## 5. Frontend

### Button: `SyncLumoButton`

Located on task detail page near existing action buttons.

**State machine:**

```
idle → generating → previewing → syncing → done
                                          ↗
error ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
```

- **idle**: Button enabled, text "Sync to LUMO.md"
- **generating**: Button disabled + spinner, calling generate API
- **previewing**: Dialog opens with proposal preview
- **syncing**: Dialog shows loading state "Creating PR..."
- **done**: Toast success, `window.open(prUrl, '_blank')`
- **error**: Toast error message, return to idle

### Dialog: `SyncLumoPreviewDialog`

Radix UI Dialog showing:

- **Header**: "Sync to LUMO.md"
- **Summary**: One-line proposal summary
- **Operations list**: Each operation as a card/row:
  - Badge: Add (green) / Modify (yellow) / Supersede (orange)
  - Section name
  - Content preview (truncated)
  - Rationale in smaller text
- **Footer**: Cancel button + "Confirm & Create PR" button

### API Client: `lib/api-client/lumo-sync.ts`

```typescript
export async function generateLumoProposal(
  taskId: string
): Promise<ProposalPreview>
export async function syncLumoProposal(proposalId: string): Promise<SyncResult>
```

---

## 6. Edge Cases (Day 4)

### 6.1 Duplicate Sync Detection

Before generating a proposal, check if the task already has a proposal with status APPLIED and a non-null `prUrl`. If found, show a warning dialog: "This task already has an open PR ({link}). Creating another sync will open a new PR." User can proceed or cancel.

Detection is DB-only (query `lumo_proposals` by taskId + status), no extra GitHub API call needed.

### 6.2 Conflict Handling (v0)

No git-level conflict detection. The sync always reads the latest LUMO.md from the default branch and applies operations to it. If two PRs modify LUMO.md simultaneously, GitHub's merge conflict UI handles it when the second PR tries to merge. This is standard PR workflow behavior.

### 6.3 Error Handling

| Scenario                   | Status  | Message                                          |
| -------------------------- | ------- | ------------------------------------------------ |
| GitHub not connected       | 400     | "Please connect GitHub in Settings first"        |
| OAuth token expired        | 401     | "GitHub authorization expired, please reconnect" |
| Repo not found / no access | 403/404 | GitHub error message forwarded                   |
| LLM call failed            | 502     | "Failed to generate proposal, please retry"      |
| Branch creation failed     | 502     | GitHub error message forwarded                   |
| Task has no memories       | 400     | "This task has no memories to sync"              |

All errors surface as Sonner toasts on the frontend. State resets to idle.

### 6.4 First-Time Onboarding PR

When LUMO.md doesn't exist in the repo:

1. PR commit includes multiple files:
   - Create `LUMO.md` with generated content
   - Create or modify `CLAUDE.md` to add `@import LUMO.md`
2. PR title: `[Lumo] Initialize LUMO.md from {taskIdentifier}`
3. PR description includes an extra section explaining this is the first LUMO.md setup

Onboarding detection reuses `lumoOnboardingService.checkStatus()` logic but operates on GitHub file existence (via `readFile`) instead of local filesystem.

---

## 7. Security

- OAuth tokens are encrypted at rest in `GitHubIntegration` table (existing pattern)
- All API routes require Clerk session authentication
- Workspace membership is verified before allowing sync
- Branch names are sanitized (no user-controlled injection into git refs)
- PR descriptions use proposal data from DB (LLM-generated, not raw user input)
