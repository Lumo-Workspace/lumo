# LUMO.md Sync-to-PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to sync task memories to LUMO.md via a GitHub PR — click "Sync to LUMO.md" on a task, preview the proposal, confirm, and get redirected to the newly created PR.

**Architecture:** Two-step API flow. Step 1 generates a proposal (reuses existing `lumoProposalService`). Step 2 creates a GitHub branch, commits the applied LUMO.md changes, opens a PR, and returns the URL. All git operations use the GitHub Git Data API server-side with the user's existing OAuth token.

**Tech Stack:** Next.js 14 App Routes, GitHub REST API (Git Data + PRs), Prisma, Zod, Radix Dialog, Sonner, existing `applyOperations()` + `lumoProposalService`.

---

### Task 1: Add `prUrl` column to LumoProposal + update repository

**Files:**

- Modify: `prisma/schema.prisma` (LumoProposal model, add `prUrl String?`)
- Modify: `lib/repositories/lumo-proposal.repository.ts` (add `updateSyncResult` method)
- Modify: `__tests__/lumo-proposal.repository.test.ts` (add test for new method)

- [ ] **Step 1: Write the failing test for `updateSyncResult`**

Add to `__tests__/lumo-proposal.repository.test.ts`:

```typescript
it('updateSyncResult sets status, appliedAt, and prUrl', async () => {
  const now = new Date('2026-05-12')
  mockUpdate.mockResolvedValueOnce({ id: 'prop-1' })
  await lumoProposalRepository.updateSyncResult(
    'prop-1',
    'APPLIED',
    now,
    'https://github.com/org/repo/pull/1'
  )
  expect(mockUpdate).toHaveBeenCalledWith({
    where: { id: 'prop-1' },
    data: {
      status: 'APPLIED',
      appliedAt: now,
      prUrl: 'https://github.com/org/repo/pull/1',
    },
    select: { id: true },
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-proposal.repository.test.ts --verbose`
Expected: FAIL — `updateSyncResult` is not a function.

- [ ] **Step 3: Add `prUrl` to Prisma schema**

In `prisma/schema.prisma`, add to the `LumoProposal` model after `appliedAt`:

```prisma
prUrl          String?
```

- [ ] **Step 4: Generate migration and Prisma client**

Run:

```bash
npx prisma migrate dev --name add_lumo_proposal_pr_url
npx prisma generate
```

- [ ] **Step 5: Implement `updateSyncResult` in repository**

Add to `lib/repositories/lumo-proposal.repository.ts`:

```typescript
async updateSyncResult(
  id: string,
  status: LumoProposalStatus,
  appliedAt: Date,
  prUrl: string
) {
  return prisma.lumoProposal.update({
    where: { id },
    data: { status, appliedAt, prUrl },
    select: { id: true },
  })
},
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal.repository.test.ts --verbose`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ lib/repositories/lumo-proposal.repository.ts __tests__/lumo-proposal.repository.test.ts
git commit -m "feat: add prUrl to LumoProposal schema and repository"
```

---

### Task 2: GitHub Tree Service — `readFile` and `createBranchWithFiles`

**Files:**

- Create: `lib/services/lumo-sync/github-tree.service.ts`
- Create: `__tests__/github-tree.service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/github-tree.service.test.ts`:

```typescript
import { githubTreeService } from '@/lib/services/lumo-sync/github-tree.service'

const mockFetch = jest.fn()
global.fetch = mockFetch

beforeEach(() => jest.clearAllMocks())

describe('githubTreeService.readFile', () => {
  it('returns decoded content when file exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: Buffer.from('# LUMO.md\n').toString('base64'),
        encoding: 'base64',
      }),
    })

    const result = await githubTreeService.readFile(
      'owner',
      'repo',
      'LUMO.md',
      'token-123'
    )

    expect(result).toBe('# LUMO.md\n')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/contents/LUMO.md',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
        }),
      })
    )
  })

  it('returns null when file does not exist (404)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const result = await githubTreeService.readFile(
      'owner',
      'repo',
      'LUMO.md',
      'token-123'
    )
    expect(result).toBeNull()
  })

  it('throws on non-404 errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal Server Error' }),
    })
    await expect(
      githubTreeService.readFile('owner', 'repo', 'LUMO.md', 'token-123')
    ).rejects.toThrow()
  })
})

describe('githubTreeService.createBranchWithFiles', () => {
  it('creates branch with files via Git Data API', async () => {
    // Step 1: get base ref
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'base-sha' } }),
    })
    // Step 2: get base commit to find tree sha
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tree: { sha: 'base-tree-sha' } }),
    })
    // Step 3: create blob (one file)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'blob-sha-1' }),
    })
    // Step 4: create tree
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'new-tree-sha' }),
    })
    // Step 5: create commit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sha: 'new-commit-sha' }),
    })
    // Step 6: create ref
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ref: 'refs/heads/lumo/sync-LUM-42-123' }),
    })

    const result = await githubTreeService.createBranchWithFiles(
      'owner',
      'repo',
      'main',
      'lumo/sync-LUM-42-123',
      [{ path: 'LUMO.md', content: '# LUMO.md\n- trap' }],
      'chore: sync LUMO.md',
      'token-123'
    )

    expect(result).toEqual({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'new-commit-sha',
    })
    expect(mockFetch).toHaveBeenCalledTimes(6)
  })
})

describe('githubTreeService.createPullRequest', () => {
  it('creates PR and returns url + number', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html_url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      }),
    })

    const result = await githubTreeService.createPullRequest(
      'owner',
      'repo',
      'title',
      'body',
      'lumo/sync',
      'main',
      'token-123'
    )

    expect(result).toEqual({
      prUrl: 'https://github.com/owner/repo/pull/42',
      prNumber: 42,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/github-tree.service.test.ts --verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `githubTreeService`**

Create `lib/services/lumo-sync/github-tree.service.ts`:

```typescript
const GH_API = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

interface FileCommit {
  path: string
  content: string
}

interface CreateBranchCommitResult {
  branchName: string
  commitSha: string
}

export const githubTreeService = {
  async readFile(
    owner: string,
    repo: string,
    path: string,
    token: string
  ): Promise<string | null> {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/contents/${path}`,
      { headers: ghHeaders(token) }
    )
    if (!res.ok) {
      if (res.status === 404) return null
      const err = await res.json().catch(() => ({}))
      httpError(
        502,
        `GitHub readFile failed: ${(err as { message?: string }).message ?? res.status}`
      )
    }
    const data = (await res.json()) as { content: string }
    return Buffer.from(data.content, 'base64').toString('utf-8')
  },

  async createBranchWithFiles(
    owner: string,
    repo: string,
    baseBranch: string,
    branchName: string,
    files: FileCommit[],
    commitMessage: string,
    token: string
  ): Promise<CreateBranchCommitResult> {
    const headers = ghHeaders(token)
    const base = `${GH_API}/repos/${owner}/${repo}`

    // 1. Get base branch ref → commit SHA
    const refRes = await fetch(`${base}/git/ref/heads/${baseBranch}`, {
      headers,
    })
    if (!refRes.ok) httpError(502, 'Failed to get base branch ref')
    const refData = (await refRes.json()) as { object: { sha: string } }
    const baseSha = refData.object.sha

    // 2. Get base commit → tree SHA
    const commitRes = await fetch(`${base}/git/commits/${baseSha}`, { headers })
    if (!commitRes.ok) httpError(502, 'Failed to get base commit')
    const commitData = (await commitRes.json()) as { tree: { sha: string } }
    const baseTreeSha = commitData.tree.sha

    // 3. Create blobs for each file
    const treeItems: {
      path: string
      mode: string
      type: string
      sha: string
    }[] = []
    for (const file of files) {
      const blobRes = await fetch(`${base}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      })
      if (!blobRes.ok) httpError(502, `Failed to create blob for ${file.path}`)
      const blobData = (await blobRes.json()) as { sha: string }
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      })
    }

    // 4. Create tree
    const treeRes = await fetch(`${base}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    })
    if (!treeRes.ok) httpError(502, 'Failed to create tree')
    const treeData = (await treeRes.json()) as { sha: string }

    // 5. Create commit
    const newCommitRes = await fetch(`${base}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    })
    if (!newCommitRes.ok) httpError(502, 'Failed to create commit')
    const newCommitData = (await newCommitRes.json()) as { sha: string }

    // 6. Create branch ref
    const createRefRes = await fetch(`${base}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommitData.sha,
      }),
    })
    if (!createRefRes.ok) httpError(502, 'Failed to create branch')

    return { branchName, commitSha: newCommitData.sha }
  },

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    token: string
  ): Promise<{ prUrl: string; prNumber: number }> {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ title, body, head, base }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      httpError(
        502,
        `Failed to create PR: ${(err as { message?: string }).message ?? res.status}`
      )
    }
    const data = (await res.json()) as { html_url: string; number: number }
    return { prUrl: data.html_url, prNumber: data.number }
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/github-tree.service.test.ts --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-sync/github-tree.service.ts __tests__/github-tree.service.test.ts
git commit -m "feat: add githubTreeService for Git Data API operations"
```

---

### Task 3: Lumo Sync Service — orchestrate proposal → branch → PR

**Files:**

- Create: `lib/services/lumo-sync/lumo-sync.service.ts`
- Create: `__tests__/lumo-sync.service.test.ts`

This service depends on: `lumoProposalRepository`, `githubTreeService`, `githubRepository`, `projectRepository`, `applyOperations`, `decrypt`.

- [ ] **Step 1: Write failing tests**

Create `__tests__/lumo-sync.service.test.ts`:

```typescript
import { lumoSyncService } from '@/lib/services/lumo-sync/lumo-sync.service'

const mockFindById = jest.fn()
const mockUpdateSyncResult = jest.fn()
const mockFindIntegration = jest.fn()
const mockFindRepositories = jest.fn()
const mockReadFile = jest.fn()
const mockCreateBranchWithFiles = jest.fn()
const mockCreatePullRequest = jest.fn()

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    findById: (...a: any[]) => mockFindById(...a),
    updateSyncResult: (...a: any[]) => mockUpdateSyncResult(...a),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegration: (...a: any[]) => mockFindIntegration(...a),
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findRepositories: (...a: any[]) => mockFindRepositories(...a),
  },
}))

jest.mock('@/lib/services/lumo-sync/github-tree.service', () => ({
  githubTreeService: {
    readFile: (...a: any[]) => mockReadFile(...a),
    createBranchWithFiles: (...a: any[]) => mockCreateBranchWithFiles(...a),
    createPullRequest: (...a: any[]) => mockCreatePullRequest(...a),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: (s: string) => `decrypted-${s}`,
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: jest.fn().mockResolvedValue({
      id: 'task-1',
      title: 'Fix auth',
      number: 42,
      projectId: 'proj-1',
      team: { identifier: 'LUM' },
    }),
  },
}))

beforeEach(() => jest.clearAllMocks())

const PROPOSAL = {
  id: 'prop-1',
  taskId: 'task-1',
  projectId: 'proj-1',
  status: 'PENDING',
  operations: [
    {
      type: 'add',
      section: 'Traps',
      content: 'SSO needs HTTPS',
      rationale: 'r',
      sourceTaskId: 'LUM-42',
    },
  ],
  summary: 'Added SSO trap',
}

const INTEGRATION = {
  id: 'int-1',
  workspaceId: 'ws-1',
  memberId: 'mem-1',
  accessToken: 'encrypted-token',
}

describe('lumoSyncService.sync', () => {
  it('happy path: reads proposal → applies → creates branch + PR → returns prUrl', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([
      { fullName: 'org/repo', isDefault: true },
    ])
    mockReadFile.mockResolvedValueOnce(
      '# LUMO.md\n\n## Traps\n\n## Decisions\n'
    )
    mockCreateBranchWithFiles.mockResolvedValueOnce({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'sha-1',
    })
    mockCreatePullRequest.mockResolvedValueOnce({
      prUrl: 'https://github.com/org/repo/pull/1',
      prNumber: 1,
    })
    mockUpdateSyncResult.mockResolvedValueOnce({ id: 'prop-1' })

    const result = await lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')

    expect(result.prUrl).toBe('https://github.com/org/repo/pull/1')
    expect(result.prNumber).toBe(1)
    expect(mockCreateBranchWithFiles).toHaveBeenCalledWith(
      'org',
      'repo',
      'main',
      expect.stringContaining('lumo/sync-LUM-42'),
      expect.arrayContaining([expect.objectContaining({ path: 'LUMO.md' })]),
      expect.any(String),
      'decrypted-encrypted-token'
    )
    expect(mockUpdateSyncResult).toHaveBeenCalledWith(
      'prop-1',
      'APPLIED',
      expect.any(Date),
      'https://github.com/org/repo/pull/1'
    )
  })

  it('throws 404 when proposal not found', async () => {
    mockFindById.mockResolvedValueOnce(null)
    await expect(
      lumoSyncService.sync('missing', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when proposal is not PENDING', async () => {
    mockFindById.mockResolvedValueOnce({ ...PROPOSAL, status: 'APPLIED' })
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when GitHub not connected', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(null)
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when no repos linked', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([])
    await expect(
      lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')
    ).rejects.toMatchObject({ status: 400 })
  })

  it('includes CLAUDE.md in onboarding (LUMO.md not found)', async () => {
    mockFindById.mockResolvedValueOnce(PROPOSAL)
    mockFindIntegration.mockResolvedValueOnce(INTEGRATION)
    mockFindRepositories.mockResolvedValueOnce([
      { fullName: 'org/repo', isDefault: true },
    ])
    // LUMO.md does not exist
    mockReadFile
      .mockResolvedValueOnce(null) // LUMO.md
      .mockResolvedValueOnce(null) // CLAUDE.md
    mockCreateBranchWithFiles.mockResolvedValueOnce({
      branchName: 'lumo/sync-LUM-42-123',
      commitSha: 'sha-1',
    })
    mockCreatePullRequest.mockResolvedValueOnce({
      prUrl: 'https://github.com/org/repo/pull/2',
      prNumber: 2,
    })
    mockUpdateSyncResult.mockResolvedValueOnce({ id: 'prop-1' })

    await lumoSyncService.sync('prop-1', 'ws-1', 'mem-1')

    const filesArg = mockCreateBranchWithFiles.mock.calls[0][4] as {
      path: string
    }[]
    const paths = filesArg.map(f => f.path)
    expect(paths).toContain('LUMO.md')
    expect(paths).toContain('CLAUDE.md')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/lumo-sync.service.test.ts --verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lumoSyncService`**

Create `lib/services/lumo-sync/lumo-sync.service.ts`:

```typescript
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubTreeService } from './github-tree.service'
import { applyOperations } from '@/lib/services/lumo-proposal/lumo-md-writer'
import { decrypt } from '@/lib/crypto'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

const LUMO_MD_TEMPLATE = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function buildPrDescription(
  taskIdentifier: string,
  taskTitle: string,
  operations: ProposalOperation[],
  summary: string,
  isOnboarding: boolean
): string {
  const changeLines = operations.map(op => {
    const badge = op.type.charAt(0).toUpperCase() + op.type.slice(1)
    const content = op.type === 'modify' ? op.newContent : op.content
    return `- **[${badge}] ${op.section}**: ${content} — ${op.rationale}`
  })

  let body = `## Source\nTask: ${taskIdentifier} — ${taskTitle}\n\n`
  body += `## Changes\n${changeLines.join('\n')}\n\n`
  body += `## Summary\n${summary}\n`

  if (isOnboarding) {
    body += `\n> **First-time setup:** This PR initializes \`LUMO.md\` and adds \`@import LUMO.md\` to \`CLAUDE.md\`.\n`
  }

  body += `\n---\n_Synced by Lumo_`
  return body
}

export const lumoSyncService = {
  async sync(
    proposalId: string,
    workspaceId: string,
    memberId: string
  ): Promise<{ prUrl: string; prNumber: number; branchName: string }> {
    // 1. Validate proposal
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) httpError(404, 'Proposal not found')
    if (proposal.status !== 'PENDING')
      httpError(400, 'Proposal is not in PENDING status')

    // 2. Get GitHub token
    const integration = await githubRepository.findIntegration(
      workspaceId,
      memberId
    )
    if (!integration)
      httpError(
        400,
        'GitHub not connected. Please connect GitHub in Settings first.'
      )
    const token = decrypt(integration.accessToken)

    // 3. Get repo info
    const repos = await projectRepository.findRepositories(proposal.projectId)
    const defaultRepo = repos.find(r => r.isDefault) ?? repos[0]
    if (!defaultRepo) httpError(400, 'No repository linked to this project')
    const [owner, repo] = defaultRepo.fullName.split('/')
    if (!owner || !repo) httpError(400, 'Invalid repository name')
    const baseBranch = 'main'

    // 4. Get task info for branch naming and PR description
    const task = await taskRepository.findForMemoryContext(proposal.taskId)
    const taskIdentifier = task
      ? `${task.team.identifier}-${task.number}`
      : proposal.taskId

    // 5. Read current LUMO.md from GitHub
    const currentLumoMd = await githubTreeService.readFile(
      owner,
      repo,
      'LUMO.md',
      token
    )
    const isOnboarding = currentLumoMd === null

    // 6. Apply operations
    const baseContent = currentLumoMd ?? LUMO_MD_TEMPLATE
    const operations = proposal.operations as ProposalOperation[]
    const { content: newContent } = applyOperations(baseContent, operations)

    // 7. Prepare files
    const files: { path: string; content: string }[] = [
      { path: 'LUMO.md', content: newContent },
    ]

    if (isOnboarding) {
      const claudeMd = await githubTreeService.readFile(
        owner,
        repo,
        'CLAUDE.md',
        token
      )
      if (claudeMd === null) {
        files.push({ path: 'CLAUDE.md', content: '@import LUMO.md\n' })
      } else if (!claudeMd.includes('@import LUMO.md')) {
        const sep = claudeMd.endsWith('\n') ? '' : '\n'
        files.push({
          path: 'CLAUDE.md',
          content: claudeMd + sep + '@import LUMO.md\n',
        })
      }
    }

    // 8. Create branch + commit
    const branchName = `lumo/sync-${taskIdentifier}-${Math.floor(Date.now() / 1000)}`
    const commitMessage = isOnboarding
      ? `chore: initialize LUMO.md from ${taskIdentifier}`
      : `chore: sync LUMO.md from ${taskIdentifier}`

    const { commitSha: _commitSha } =
      await githubTreeService.createBranchWithFiles(
        owner,
        repo,
        baseBranch,
        branchName,
        files,
        commitMessage,
        token
      )

    // 9. Create PR
    const prTitle = isOnboarding
      ? `[Lumo] Initialize LUMO.md from ${taskIdentifier}`
      : `[Lumo] Sync project memory from ${taskIdentifier}`

    const prBody = buildPrDescription(
      taskIdentifier,
      task?.title ?? 'Unknown task',
      operations,
      proposal.summary ?? '',
      isOnboarding
    )

    const { prUrl, prNumber } = await githubTreeService.createPullRequest(
      owner,
      repo,
      prTitle,
      prBody,
      branchName,
      baseBranch,
      token
    )

    // 10. Update proposal in DB
    await lumoProposalRepository.updateSyncResult(
      proposalId,
      'APPLIED',
      new Date(),
      prUrl
    )

    return { prUrl, prNumber, branchName }
  },
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/lumo-sync.service.test.ts --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-sync/lumo-sync.service.ts __tests__/lumo-sync.service.test.ts
git commit -m "feat: add lumoSyncService to orchestrate proposal → branch → PR"
```

---

### Task 4: API Route — `POST /api/tasks/[taskId]/lumo-proposals`

**Files:**

- Create: `app/api/tasks/[taskId]/lumo-proposals/route.ts`
- Create: `__tests__/api-lumo-proposals.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/api-lumo-proposals.test.ts`:

```typescript
import { POST } from '@/app/api/tasks/[taskId]/lumo-proposals/route'

const mockRequireAuth = jest.fn()
const mockRequireTaskMember = jest.fn()
const mockFindIntegration = jest.fn()
const mockFindRepositories = jest.fn()
const mockReadFile = jest.fn()
const mockGenerateProposal = jest.fn()
const mockFindForMemoryContext = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireAuth: (...a: any[]) => mockRequireAuth(...a),
  requireWorkspaceMember: jest.fn(),
}))

jest.mock('@/lib/api/helpers', () => ({
  requireTaskMember: (...a: any[]) => mockRequireTaskMember(...a),
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findForMemoryContext: (...a: any[]) => mockFindForMemoryContext(...a),
  },
}))

jest.mock('@/lib/repositories/github.repository', () => ({
  githubRepository: {
    findIntegration: (...a: any[]) => mockFindIntegration(...a),
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findRepositories: (...a: any[]) => mockFindRepositories(...a),
  },
}))

jest.mock('@/lib/services/lumo-sync/github-tree.service', () => ({
  githubTreeService: {
    readFile: (...a: any[]) => mockReadFile(...a),
  },
}))

jest.mock('@/lib/crypto', () => ({
  decrypt: (s: string) => `dec-${s}`,
}))

jest.mock('@/lib/services/lumo-proposal/lumo-proposal.service', () => ({
  lumoProposalService: {
    generateProposal: (...a: any[]) => mockGenerateProposal(...a),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
  },
}))

beforeEach(() => jest.clearAllMocks())

function makeRequest() {
  return new Request('http://localhost/api/tasks/task-1/lumo-proposals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
}

describe('POST /api/tasks/[taskId]/lumo-proposals', () => {
  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ taskId: 'task-1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns proposal preview on success', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user-1' })
    mockFindForMemoryContext.mockResolvedValueOnce({
      id: 'task-1',
      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    mockRequireTaskMember.mockResolvedValueOnce({
      task: {
        id: 'task-1',
        projectId: 'proj-1',
        project: { workspaceId: 'ws-1' },
      },
      member: { id: 'mem-1' },
    })
    mockFindIntegration.mockResolvedValueOnce({ accessToken: 'enc' })
    mockFindRepositories.mockResolvedValueOnce([
      { fullName: 'org/repo', isDefault: true },
    ])
    mockReadFile.mockResolvedValueOnce('# LUMO.md\n')
    mockGenerateProposal.mockResolvedValueOnce({
      id: 'prop-1',
      operations: [{ type: 'add', section: 'Traps', content: 'test' }],
      summary: 'summary',
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ taskId: 'task-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('prop-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-lumo-proposals.test.ts --verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the API route**

Create `app/api/tasks/[taskId]/lumo-proposals/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { githubTreeService } from '@/lib/services/lumo-sync/github-tree.service'
import { lumoProposalService } from '@/lib/services/lumo-proposal/lumo-proposal.service'
import { decrypt } from '@/lib/crypto'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { taskId } = await params

    // Load task and verify workspace membership
    const task = await taskRepository.findForMemoryContext(taskId)
    const taskResult = await requireTaskMember(
      task
        ? { ...task, project: { workspaceId: task.project.workspaceId } }
        : null,
      userId
    )
    if (taskResult instanceof NextResponse) return taskResult
    const { member } = taskResult

    const workspaceId = task!.project.workspaceId

    // Get GitHub token
    const integration = await githubRepository.findIntegration(
      workspaceId,
      member.id
    )
    if (!integration) {
      return NextResponse.json(
        {
          error:
            'GitHub not connected. Please connect GitHub in Settings first.',
        },
        { status: 400 }
      )
    }
    const token = decrypt(integration.accessToken)

    // Get repo info
    const repos = await projectRepository.findRepositories(task!.projectId)
    const defaultRepo = repos.find(r => r.isDefault) ?? repos[0]
    if (!defaultRepo) {
      return NextResponse.json(
        { error: 'No repository linked to this project' },
        { status: 400 }
      )
    }
    const [owner, repo] = defaultRepo.fullName.split('/')

    // Read current LUMO.md from GitHub
    const currentLumoMd = await githubTreeService.readFile(
      owner!,
      repo!,
      'LUMO.md',
      token
    )

    // Generate proposal
    const proposal = await lumoProposalService.generateProposal(
      taskId,
      currentLumoMd ?? ''
    )

    return NextResponse.json(proposal)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      error instanceof Error ? error.message : 'Failed to generate proposal'
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api-lumo-proposals.test.ts --verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/tasks/\[taskId\]/lumo-proposals/route.ts __tests__/api-lumo-proposals.test.ts
git commit -m "feat: add POST /api/tasks/[taskId]/lumo-proposals route"
```

---

### Task 5: API Route — `POST /api/lumo-proposals/[proposalId]/sync`

**Files:**

- Create: `app/api/lumo-proposals/[proposalId]/sync/route.ts`
- Create: `__tests__/api-lumo-sync.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/api-lumo-sync.test.ts`:

```typescript
import { POST } from '@/app/api/lumo-proposals/[proposalId]/sync/route'

const mockRequireAuth = jest.fn()
const mockFindById = jest.fn()
const mockRequireWorkspaceMember = jest.fn()
const mockSync = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireAuth: (...a: any[]) => mockRequireAuth(...a),
  requireWorkspaceMember: (...a: any[]) => mockRequireWorkspaceMember(...a),
}))

jest.mock('@/lib/repositories/lumo-proposal.repository', () => ({
  lumoProposalRepository: {
    findById: (...a: any[]) => mockFindById(...a),
  },
}))

jest.mock('@/lib/services/lumo-sync/lumo-sync.service', () => ({
  lumoSyncService: {
    sync: (...a: any[]) => mockSync(...a),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    project: {
      findUnique: jest.fn().mockResolvedValue({ workspaceId: 'ws-1' }),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

function makeRequest() {
  return new Request('http://localhost/api/lumo-proposals/prop-1/sync', {
    method: 'POST',
  })
}

describe('POST /api/lumo-proposals/[proposalId]/sync', () => {
  it('returns prUrl on success', async () => {
    mockRequireAuth.mockResolvedValueOnce({ userId: 'user-1' })
    mockFindById.mockResolvedValueOnce({
      id: 'prop-1',
      projectId: 'proj-1',
      status: 'PENDING',
    })
    mockRequireWorkspaceMember.mockResolvedValueOnce({ id: 'mem-1' })
    mockSync.mockResolvedValueOnce({
      prUrl: 'https://github.com/org/repo/pull/1',
      prNumber: 1,
      branchName: 'lumo/sync-LUM-42-123',
    })

    const res = await POST(makeRequest(), {
      params: Promise.resolve({ proposalId: 'prop-1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.prUrl).toBe('https://github.com/org/repo/pull/1')
  })

  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ proposalId: 'prop-1' }),
    })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/api-lumo-sync.test.ts --verbose`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the API route**

Create `app/api/lumo-proposals/[proposalId]/sync/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { lumoProposalRepository } from '@/lib/repositories/lumo-proposal.repository'
import { lumoSyncService } from '@/lib/services/lumo-sync/lumo-sync.service'
import { prisma } from '@/lib/db/prisma'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { proposalId } = await params

    // Load proposal to get projectId
    const proposal = await lumoProposalRepository.findById(proposalId)
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get workspace from project and verify membership
    const project = await prisma.project.findUnique({
      where: { id: proposal.projectId },
      select: { workspaceId: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const member = await requireWorkspaceMember(project.workspaceId, userId)
    if (member instanceof NextResponse) return member

    const result = await lumoSyncService.sync(
      proposalId,
      project.workspaceId,
      member.id
    )

    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message =
      error instanceof Error ? error.message : 'Failed to sync proposal'
    return NextResponse.json({ error: message }, { status })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/api-lumo-sync.test.ts --verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/lumo-proposals/\[proposalId\]/sync/route.ts __tests__/api-lumo-sync.test.ts
git commit -m "feat: add POST /api/lumo-proposals/[proposalId]/sync route"
```

---

### Task 6: API Client + Constants

**Files:**

- Create: `lib/api-client/lumo-sync.ts`
- Modify: `app/workspace/[workspaceUrl]/constants.ts` (add `lumoSync` routes to `API`)

- [ ] **Step 1: Add API routes to constants**

In `app/workspace/[workspaceUrl]/constants.ts`, add after the `teams` entry in the `API` object:

```typescript
lumoSync: {
  generateProposal: (taskId: string) => `/api/tasks/${taskId}/lumo-proposals`,
  sync: (proposalId: string) => `/api/lumo-proposals/${proposalId}/sync`,
},
```

- [ ] **Step 2: Create API client**

Create `lib/api-client/lumo-sync.ts`:

```typescript
import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

interface SyncResult {
  prUrl: string
  prNumber: number
  branchName: string
}

export const lumoSyncClient = {
  generateProposal(taskId: string) {
    return apiFetch<ProposalPreview>(API.lumoSync.generateProposal(taskId), {
      method: 'POST',
    })
  },

  sync(proposalId: string) {
    return apiFetch<SyncResult>(API.lumoSync.sync(proposalId), {
      method: 'POST',
    })
  },
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/api-client/lumo-sync.ts app/workspace/\[workspaceUrl\]/constants.ts
git commit -m "feat: add lumo sync API client and route constants"
```

---

### Task 7: Frontend — `SyncLumoButton` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SyncLumoButton.tsx`

- [ ] **Step 1: Create the component**

Create `app/workspace/[workspaceUrl]/components/SyncLumoButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { lumoSyncClient } from '@/lib/api-client/lumo-sync'
import { SyncLumoPreviewDialog } from './SyncLumoPreviewDialog'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

type SyncState = 'idle' | 'generating' | 'previewing' | 'syncing'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

interface SyncLumoButtonProps {
  taskId: string
}

export function SyncLumoButton({ taskId }: SyncLumoButtonProps) {
  const [state, setState] = useState<SyncState>('idle')
  const [proposal, setProposal] = useState<ProposalPreview | null>(null)

  async function handleGenerate() {
    setState('generating')
    try {
      const result = await lumoSyncClient.generateProposal(taskId)
      setProposal(result)
      setState('previewing')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate proposal'
      )
      setState('idle')
    }
  }

  async function handleConfirm() {
    if (!proposal) return
    setState('syncing')
    try {
      const result = await lumoSyncClient.sync(proposal.id)
      toast.success('PR created successfully')
      window.open(result.prUrl, '_blank')
      setState('idle')
      setProposal(null)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create PR'
      )
      setState('previewing')
    }
  }

  function handleCancel() {
    setState('idle')
    setProposal(null)
  }

  return (
    <>
      <button
        onClick={handleGenerate}
        disabled={state !== 'idle'}
        className='w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600 hover:text-zinc-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      >
        <RefreshCw
          size={12}
          className={state === 'generating' ? 'animate-spin' : ''}
        />
        {state === 'generating' ? 'Generating proposal...' : 'Sync to LUMO.md'}
      </button>

      <SyncLumoPreviewDialog
        open={state === 'previewing' || state === 'syncing'}
        proposal={proposal}
        syncing={state === 'syncing'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/SyncLumoButton.tsx
git commit -m "feat: add SyncLumoButton component"
```

---

### Task 8: Frontend — `SyncLumoPreviewDialog` component

**Files:**

- Create: `app/workspace/[workspaceUrl]/components/SyncLumoPreviewDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `app/workspace/[workspaceUrl]/components/SyncLumoPreviewDialog.tsx`:

```tsx
'use client'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { ProposalOperation } from '@/lib/validation/lumo-proposal.schema'

interface ProposalPreview {
  id: string
  operations: ProposalOperation[]
  summary: string
}

const BADGE_STYLES: Record<string, string> = {
  add: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  modify:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  supersede:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
}

function OperationBadge({ type }: { type: string }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${BADGE_STYLES[type] ?? ''}`}
    >
      {type}
    </span>
  )
}

function getOperationContent(op: ProposalOperation): string {
  if (op.type === 'modify') return op.newContent
  return op.content
}

interface SyncLumoPreviewDialogProps {
  open: boolean
  proposal: ProposalPreview | null
  syncing: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function SyncLumoPreviewDialog({
  open,
  proposal,
  syncing,
  onConfirm,
  onCancel,
}: SyncLumoPreviewDialogProps) {
  if (!proposal) return null

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onCancel()
      }}
    >
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Sync to LUMO.md</DialogTitle>
        </DialogHeader>

        <div className='space-y-3'>
          <p className='text-sm text-zinc-600 dark:text-zinc-400'>
            {proposal.summary}
          </p>

          <div className='space-y-2 max-h-64 overflow-y-auto'>
            {proposal.operations.map((op, i) => (
              <div
                key={i}
                className='rounded-md border border-zinc-100 dark:border-zinc-800 p-3 space-y-1.5'
              >
                <div className='flex items-center gap-2'>
                  <OperationBadge type={op.type} />
                  <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
                    {op.section}
                  </span>
                </div>
                <p className='text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2'>
                  {getOperationContent(op)}
                </p>
                <p className='text-[11px] text-zinc-400 dark:text-zinc-500 italic'>
                  {op.rationale}
                </p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onCancel} disabled={syncing}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={syncing}>
            {syncing ? (
              <>
                <Loader2 size={14} className='animate-spin mr-1.5' />
                Creating PR...
              </>
            ) : (
              'Confirm & Create PR'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/SyncLumoPreviewDialog.tsx
git commit -m "feat: add SyncLumoPreviewDialog component"
```

---

### Task 9: Wire `SyncLumoButton` into `TaskDetailSidebar`

**Files:**

- Modify: `app/workspace/[workspaceUrl]/components/TaskDetailSidebar.tsx`

- [ ] **Step 1: Add SyncLumoButton to TaskDetailSidebar**

Add import at the top of `TaskDetailSidebar.tsx`:

```typescript
import { SyncLumoButton } from './SyncLumoButton'
```

Add the button section after the Pull Requests `</div>` (after line 361 in the current file), before the `{unlinkBranch && (` block:

```tsx
{
  /* ── Sync LUMO.md ─────────────────────────────────────────── */
}
;<div className='pt-3'>
  <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5 mb-2'>
    <RefreshCw size={12} />
    LUMO.md
  </p>
  <SyncLumoButton taskId={task.id} />
</div>
```

Add `RefreshCw` to the lucide-react import at the top:

```typescript
import {
  Check,
  Copy,
  ExternalLink,
  GitPullRequest,
  GitBranch,
  RefreshCw,
  X,
} from 'lucide-react'
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the new code.

- [ ] **Step 3: Commit**

```bash
git add app/workspace/\[workspaceUrl\]/components/TaskDetailSidebar.tsx
git commit -m "feat: wire SyncLumoButton into TaskDetailSidebar"
```

---

### Task 10: Modify `lumoProposalService.generateProposal` to return operations for preview

**Files:**

- Modify: `lib/services/lumo-proposal/lumo-proposal.service.ts`
- Modify: `__tests__/lumo-proposal.service.test.ts`

The current `generateProposal` only returns `{ id }` because the repository `create` uses `select: { id: true }`. We need it to also return `operations` and `summary` for the preview dialog.

- [ ] **Step 1: Update test expectation**

In `__tests__/lumo-proposal.service.test.ts`, update the happy path test's mock and assertion:

Change the `mockCreateProposal` return value from `{ id: 'prop-1' }` to include all preview fields:

```typescript
mockCreateProposal.mockResolvedValueOnce({ id: 'prop-1' })
```

And update the assertion to check that the result includes operations and summary:

```typescript
expect(result).toEqual({
  id: 'prop-1',
  operations: expect.any(Array),
  summary: 'Added SSO trap',
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest __tests__/lumo-proposal.service.test.ts -- --testNamePattern="happy path" --verbose`
Expected: FAIL — result only has `{ id }`, missing `operations` and `summary`.

- [ ] **Step 3: Update `generateProposal` to return preview data**

In `lib/services/lumo-proposal/lumo-proposal.service.ts`, change the `generateProposal` method to return operations and summary alongside the id:

```typescript
async generateProposal(taskId: string, currentLumoMd: string) {
  const task = await taskRepository.findForMemoryContext(taskId)
  if (!task) httpError(404, 'task not found')

  const memories = await memoryRepository.findActiveTaskMemories(taskId)
  if (memories.length === 0) httpError(400, 'task has no memories')

  const taskIdentifier = `${task.team.identifier}-${task.number}`

  const { operations, summary } = await callLumoProposalLLM(
    {
      id: task.id,
      title: task.title,
      description: task.description,
      taskIdentifier,
    },
    memories,
    currentLumoMd
  )

  const proposal = await lumoProposalRepository.create({
    projectId: task.projectId,
    taskId: task.id,
    operations,
    lumoMdSnapshot: currentLumoMd || null,
    summary,
  })

  return { ...proposal, operations, summary }
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest __tests__/lumo-proposal.service.test.ts --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/lumo-proposal/lumo-proposal.service.ts __tests__/lumo-proposal.service.test.ts
git commit -m "feat: return operations + summary from generateProposal for preview"
```

---

### Task 11: Full test run + TypeScript check

**Files:** None (verification only)

- [ ] **Step 1: Run all related tests**

Run: `npx jest --verbose __tests__/lumo-proposal.repository.test.ts __tests__/github-tree.service.test.ts __tests__/lumo-sync.service.test.ts __tests__/api-lumo-proposals.test.ts __tests__/api-lumo-sync.test.ts __tests__/lumo-proposal.service.test.ts __tests__/lumo-md-writer.test.ts`

Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests PASS (existing tests should not be broken).
