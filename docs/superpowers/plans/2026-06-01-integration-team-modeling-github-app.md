# Integration TEAM/PERSONAL 真相源 + GitHub 团队 App 模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 5 个 integration 建一个代码层 kind 真相源（TEAM/PERSONAL，GitHub=TEAM），并把 GitHub 团队 App 安装从全局环境变量下沉为 per-workspace 的 `GitHubAppInstallation` DB 模型。

**Architecture:** 新增纯常量/类型模块 `lib/integrations/registry.ts` 声明每个整合的 kind；新增 `GitHubAppInstallation` Prisma 模型 + repository；`getGithubInstallationToken` 加可选 `workspaceId`，命中 DB 用对应 installationId、否则降级到现有 env 变量（过渡期 fallback）。不建凭证 resolver、不动 GitHub personal OAuth 代码。

**Tech Stack:** Next.js 14、TypeScript strict、Prisma + Neon Postgres、Jest（`@jest-environment node`）、`@octokit/auth-app`。

参考 spec：[docs/superpowers/specs/2026-06-01-integration-team-personal-modeling-design.md](../specs/2026-06-01-integration-team-personal-modeling-design.md)

---

## File Structure

- Create: `lib/integrations/registry.ts` — kind 真相源（类型 + 常量 + `getIntegrationKind`）。
- Create: `__tests__/lib/integrations/registry.test.ts` — completeness 测试。
- Modify: `prisma/schema.prisma` — 加 `GitHubAppInstallation` 模型 + `Workspace` / `WorkspaceMember` 反向关系。
- Create: `prisma/migrations/<ts>_add_github_app_installation/migration.sql` — 由 `prisma migrate dev` 生成。
- Create: `lib/repositories/github-app-installation.repository.ts` — CRUD。
- Create: `__tests__/lib/repositories/github-app-installation.repository.test.ts`。
- Modify: `lib/integrations/github/auth.ts` — `getGithubInstallationToken(workspaceId?)` + env fallback。
- Create: `__tests__/lib/integrations/github/auth.test.ts`。
- Modify: `lib/agent/execute.ts`、`lib/services/pr-comment-mirror.service.ts`、`lib/services/task-pr-sync.service.ts` — workspaceId 透传 / 注释。

---

## Task 1: registry 真相源

**Files:**

- Create: `lib/integrations/registry.ts`
- Test: `__tests__/lib/integrations/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/integrations/registry.test.ts
import {
  INTEGRATIONS,
  getIntegrationKind,
  type IntegrationId,
} from '@/lib/integrations/registry'

describe('integration registry', () => {
  const ALL_IDS: IntegrationId[] = [
    'slack',
    'sentry',
    'github',
    'figma',
    'googleDrive',
  ]

  it('has a descriptor for every integration id', () => {
    for (const id of ALL_IDS) {
      expect(INTEGRATIONS[id]).toBeDefined()
      expect(INTEGRATIONS[id].id).toBe(id)
    }
    expect(Object.keys(INTEGRATIONS).sort()).toEqual([...ALL_IDS].sort())
  })

  it('classifies kinds correctly (GitHub is TEAM)', () => {
    expect(getIntegrationKind('slack')).toBe('TEAM')
    expect(getIntegrationKind('sentry')).toBe('TEAM')
    expect(getIntegrationKind('github')).toBe('TEAM')
    expect(getIntegrationKind('figma')).toBe('PERSONAL')
    expect(getIntegrationKind('googleDrive')).toBe('PERSONAL')
  })

  it('only uses valid kind values', () => {
    for (const id of ALL_IDS) {
      expect(['TEAM', 'PERSONAL']).toContain(INTEGRATIONS[id].kind)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- registry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/registry'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/integrations/registry.ts
/**
 * Single source of truth for each integration's "level" (kind).
 *
 * TEAM     — workspace-wide, ownerless system behavior (one install serves all).
 * PERSONAL — scoped to an individual member's account access.
 *
 * GitHub is classified TEAM: the team App installation (stable backend for
 * agent-created PRs) is the backbone. The existing personal OAuth code is left
 * untouched and is not modeled as a personal capability line this phase.
 */
export type IntegrationKind = 'TEAM' | 'PERSONAL'

export type IntegrationId =
  | 'slack'
  | 'sentry'
  | 'github'
  | 'figma'
  | 'googleDrive'

export interface IntegrationDescriptor {
  id: IntegrationId
  kind: IntegrationKind
}

export const INTEGRATIONS = {
  slack: { id: 'slack', kind: 'TEAM' },
  sentry: { id: 'sentry', kind: 'TEAM' },
  github: { id: 'github', kind: 'TEAM' },
  figma: { id: 'figma', kind: 'PERSONAL' },
  googleDrive: { id: 'googleDrive', kind: 'PERSONAL' },
} as const satisfies Record<IntegrationId, IntegrationDescriptor>

export function getIntegrationKind(id: IntegrationId): IntegrationKind {
  return INTEGRATIONS[id].kind
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- registry.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/registry.ts __tests__/lib/integrations/registry.test.ts
git commit -m "feat: integration kind registry (TEAM/PERSONAL truth source)"
```

---

## Task 2: GitHubAppInstallation Prisma 模型 + 迁移

**Files:**

- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

在 `prisma/schema.prisma` 里、紧跟 `GitHubWebhook` 模型之后（约 `prisma/schema.prisma:706` 之后）加入：

```prisma
model GitHubAppInstallation {
  id             String   @id @default(cuid())
  workspaceId    String   @unique
  installationId Int
  accountLogin   String?
  accountType    String?
  repositories   String[]
  installedBy    String?
  installer      WorkspaceMember? @relation("GitHubAppInstaller", fields: [installedBy], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([installationId])
  @@map("github_app_installations")
}
```

- [ ] **Step 2: Add reverse relations**

在 `model Workspace { ... }`（`prisma/schema.prisma:159`）的关系字段区加一行：

```prisma
  gitHubAppInstallation GitHubAppInstallation?
```

在 `model WorkspaceMember { ... }` 的关系字段区加一行（命名关系与上面的 `installer` 对应）：

```prisma
  gitHubAppInstalls GitHubAppInstallation[] @relation("GitHubAppInstaller")
```

- [ ] **Step 3: Generate migration + client**

Run: `npx prisma migrate dev --name add_github_app_installation`
Expected: 新建 `prisma/migrations/<ts>_add_github_app_installation/migration.sql`，输出 `Your database is now in sync with your schema.`，并自动 `prisma generate`。

> 若撞 P3008/P3012 漂移：按 CLAUDE.md 手写 SQL → `npx prisma db execute --file <path>` → `npx prisma migrate resolve --applied <name>` → `npx prisma generate`。**不得** `migrate reset` 或直改 `_prisma_migrations`。

- [ ] **Step 4: Verify client type exists**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: 无与 `GitHubAppInstallation` 相关的报错。（若报 "not exported"，先 `npx prisma generate` 再 tsc——见 CLAUDE.md "stale generated client" 备注。）

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add GitHubAppInstallation model (per-workspace team App install)"
```

---

## Task 3: githubAppInstallationRepository

**Files:**

- Create: `lib/repositories/github-app-installation.repository.ts`
- Test: `__tests__/lib/repositories/github-app-installation.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/repositories/github-app-installation.repository.test.ts
/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    gitHubAppInstallation: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { prisma } from '@/lib/db/prisma'

const prismaMock = prisma as unknown as {
  gitHubAppInstallation: {
    findUnique: jest.Mock
    upsert: jest.Mock
    delete: jest.Mock
  }
}

beforeEach(() => jest.clearAllMocks())

describe('githubAppInstallationRepository', () => {
  it('findByWorkspace returns the row scoped by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue({
      id: 'gai_1',
      workspaceId: 'ws_1',
      installationId: 42,
    })

    const row = await githubAppInstallationRepository.findByWorkspace('ws_1')

    expect(prismaMock.gitHubAppInstallation.findUnique).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
      select: { id: true, workspaceId: true, installationId: true },
    })
    expect(row?.installationId).toBe(42)
  })

  it('findByWorkspace returns null when absent', async () => {
    prismaMock.gitHubAppInstallation.findUnique.mockResolvedValue(null)
    const row = await githubAppInstallationRepository.findByWorkspace('ws_x')
    expect(row).toBeNull()
  })

  it('upsert writes create + update payloads keyed by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.upsert.mockResolvedValue({ id: 'gai_1' })

    await githubAppInstallationRepository.upsert({
      workspaceId: 'ws_1',
      installationId: 42,
      accountLogin: 'acme',
      accountType: 'Organization',
      repositories: ['acme/web'],
      installedBy: 'mem_1',
    })

    expect(prismaMock.gitHubAppInstallation.upsert).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
      create: {
        workspaceId: 'ws_1',
        installationId: 42,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositories: ['acme/web'],
        installedBy: 'mem_1',
      },
      update: {
        installationId: 42,
        accountLogin: 'acme',
        accountType: 'Organization',
        repositories: ['acme/web'],
      },
    })
  })

  it('delete removes by workspaceId', async () => {
    prismaMock.gitHubAppInstallation.delete.mockResolvedValue({ id: 'gai_1' })
    await githubAppInstallationRepository.delete('ws_1')
    expect(prismaMock.gitHubAppInstallation.delete).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1' },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github-app-installation.repository.test.ts`
Expected: FAIL — `Cannot find module '@/lib/repositories/github-app-installation.repository'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/repositories/github-app-installation.repository.ts
import { prisma } from '@/lib/db/prisma'

export interface UpsertGitHubAppInstallationData {
  workspaceId: string
  installationId: number
  accountLogin?: string | null
  accountType?: string | null
  repositories?: string[]
  installedBy?: string | null
}

export const githubAppInstallationRepository = {
  async findByWorkspace(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: { id: true, workspaceId: true, installationId: true },
    })
  },

  async upsert(data: UpsertGitHubAppInstallationData) {
    return prisma.gitHubAppInstallation.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
        installedBy: data.installedBy ?? null,
      },
      update: {
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
      },
    })
  },

  async delete(workspaceId: string) {
    return prisma.gitHubAppInstallation.delete({ where: { workspaceId } })
  },
}
```

> 注意：测试里 `upsert` 入参带 `installedBy: 'mem_1'`，但断言的 `update` 块**不含** `installedBy`（安装人只在首次 create 记录，后续 update 不覆盖）——实现与断言一致，勿在 update 里加 installedBy。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github-app-installation.repository.test.ts`
Expected: PASS (4 passing)。

- [ ] **Step 5: Commit**

```bash
git add lib/repositories/github-app-installation.repository.ts __tests__/lib/repositories/github-app-installation.repository.test.ts
git commit -m "feat: githubAppInstallationRepository CRUD"
```

---

## Task 4: getGithubInstallationToken(workspaceId?) — DB 解析 + env 降级

**Files:**

- Modify: `lib/integrations/github/auth.ts`
- Test: `__tests__/lib/integrations/github/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/integrations/github/auth.test.ts
/**
 * @jest-environment node
 */
jest.mock('@octokit/auth-app', () => ({
  createAppAuth: jest.fn(),
}))
jest.mock('@/lib/repositories/github-app-installation.repository', () => ({
  githubAppInstallationRepository: { findByWorkspace: jest.fn() },
}))

import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'

const createAppAuthMock = createAppAuth as unknown as jest.Mock
const findByWorkspaceMock =
  githubAppInstallationRepository.findByWorkspace as jest.Mock

function mockAuthReturning(token: string) {
  const authFn = jest.fn().mockResolvedValue({ token })
  createAppAuthMock.mockReturnValue(authFn)
  return authFn
}

const ORIGINAL_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...ORIGINAL_ENV,
    GITHUB_APP_ID: '111',
    GITHUB_APP_PRIVATE_KEY:
      '-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----\\n',
    GITHUB_APP_INSTALLATION_ID: '999',
  }
})
afterEach(() => {
  process.env = ORIGINAL_ENV
})

describe('getGithubInstallationToken', () => {
  it('uses the per-workspace installationId when DB has a row', async () => {
    findByWorkspaceMock.mockResolvedValue({
      id: 'gai_1',
      workspaceId: 'ws_1',
      installationId: 42,
    })
    mockAuthReturning('tok_db')

    const token = await getGithubInstallationToken('ws_1')

    expect(token).toBe('tok_db')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 111, installationId: 42 })
    )
  })

  it('falls back to env installationId when workspace has no DB row', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockAuthReturning('tok_env')

    const token = await getGithubInstallationToken('ws_unknown')

    expect(token).toBe('tok_env')
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 999 })
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('uses env installationId when called without workspaceId', async () => {
    mockAuthReturning('tok_env')

    const token = await getGithubInstallationToken()

    expect(token).toBe('tok_env')
    expect(findByWorkspaceMock).not.toHaveBeenCalled()
    expect(createAppAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: 999 })
    )
  })

  it('throws when no DB row and no env installation id', async () => {
    findByWorkspaceMock.mockResolvedValue(null)
    delete process.env.GITHUB_APP_INSTALLATION_ID

    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /installation/i
    )
  })

  it('throws when app id / private key missing', async () => {
    delete process.env.GITHUB_APP_ID
    await expect(getGithubInstallationToken('ws_1')).rejects.toThrow(
      /GITHUB_APP_ID/
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- github/auth.test.ts`
Expected: FAIL — 现有 `getGithubInstallationToken` 不接受参数、不查 DB，DB 路径断言失败。

- [ ] **Step 3: Rewrite implementation**

把 `lib/integrations/github/auth.ts` 整体替换为：

```ts
import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

/**
 * Returns a short-lived GitHub installation token for the Lumo Agent app.
 *
 * App credentials (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) stay in env — one
 * Lumo App, many installations. The installationId is resolved per-workspace
 * from GitHubAppInstallation; if a workspace has no row (or no workspaceId is
 * passed) we fall back to the legacy global GITHUB_APP_INSTALLATION_ID env var
 * during the transition, logging a warning so we can observe migration progress.
 */
async function resolveInstallationId(workspaceId?: string): Promise<number> {
  if (workspaceId) {
    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (row) return row.installationId
    console.warn(
      `[github/auth] no GitHubAppInstallation for workspace ${workspaceId}; falling back to GITHUB_APP_INSTALLATION_ID`
    )
  }
  const envId = process.env.GITHUB_APP_INSTALLATION_ID
  if (!envId) {
    throw new Error(
      'No GitHubAppInstallation for workspace and GITHUB_APP_INSTALLATION_ID not set'
    )
  }
  return Number(envId)
}

export async function getGithubInstallationToken(
  workspaceId?: string
): Promise<string> {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error(
      'Missing GitHub App env vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY'
    )
  }

  const installationId = await resolveInstallationId(workspaceId)

  // Private key may be stored as:
  // 1. Full PEM (with BEGIN/END markers and newlines)
  // 2. PEM with escaped newlines (\\n → \n)
  // 3. Raw base64 DER content (no PEM headers)
  let decodedKey: string
  if (privateKey.includes('BEGIN')) {
    decodedKey = privateKey.replace(/\\n/g, '\n')
  } else {
    const lines = privateKey.match(/.{1,64}/g) ?? [privateKey]
    decodedKey = `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----\n`
  }

  const auth = createAppAuth({
    appId: Number(appId),
    privateKey: decodedKey,
    installationId,
  })

  const { token } = await auth({ type: 'installation' })
  return token
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- github/auth.test.ts`
Expected: PASS (5 passing)。

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/github/auth.ts __tests__/lib/integrations/github/auth.test.ts
git commit -m "feat: getGithubInstallationToken resolves per-workspace installationId with env fallback"
```

---

## Task 5: 透传 workspaceId 到 App token 调用点

**Files:**

- Modify: `lib/services/pr-comment-mirror.service.ts`
- Modify: `lib/agent/execute.ts`
- Modify: `lib/services/task-pr-sync.service.ts`

> 调用点签名兼容（workspaceId 可选）；本任务把能轻松拿到 workspaceId 的地方传上，其余靠 env fallback。无新增测试——Task 4 已覆盖行为；本任务靠 `tsc` + 既有测试不回归来验证。

- [ ] **Step 1: pr-comment-mirror.service.ts — 每个 App token 调用点传 PR 的 workspaceId**

该文件里所有 `await getGithubInstallationToken()` 调用（约 line 171、280、375、378、460、463、847）改为传入当前处理对象的 `workspaceId`。这些调用都在已加载了 PullRequest（含 `workspaceId` 字段，见 `prisma/schema.prisma:746`）的上下文里。逐处定位最近的 PR 变量（如 `pr`、`mirror.pullRequest`、`record.workspaceId`），改成：

```ts
const appToken = await getGithubInstallationToken(pr.workspaceId)
```

若某处的 PR 变量未 select `workspaceId`，在对应 repository 查询的 `select` 里补 `workspaceId: true`。**不要**改成传 memberId 或其它字段——团队 App 只按 workspaceId 解析。

- [ ] **Step 2: execute.ts — resolveCredentials 接 workspaceId**

把 `resolveCredentials` 签名改为接收 workspaceId 并透传：

```ts
async function resolveCredentials(workspaceId?: string): Promise<{
  githubToken: string
  anthropicKey: string
}> {
  const githubToken = await getGithubInstallationToken(workspaceId).catch(
    err => {
      throw new AgentError('CLONE_FAILED', 'Failed to get GitHub token', err)
    }
  )
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')
  return { githubToken, anthropicKey }
}
```

两个调用点（约 line 370、421）改为传入 task 所属 workspace 的 id。定位这两个函数里 `task` 的加载处（其 `select` 含 `project`），在 `project` 的 select 里加 `workspaceId: true`，然后调用改为：

```ts
const { githubToken } = await resolveCredentials(task.project.workspaceId)
```

（若 `task` 类型上已存在直达的 `workspaceId`，优先用 `task.workspaceId`。）改完用 `tsc` 确认无 "workspaceId does not exist" 报错——有则说明 select 没补全。

- [ ] **Step 3: task-pr-sync.service.ts — 加注释，保持 env fallback**

`syncPullRequestStatus(openPrs)` 的入参不带 workspaceId（来自 `pullRequestRepository`，跨多 PR 批量）。本期不改签名，在 `const token = await getGithubInstallationToken()`（line 18 附近）上方加一行注释：

```ts
// workspaceId not threaded here (batch across PRs); relies on GITHUB_APP_INSTALLATION_ID
// env fallback during the per-workspace migration. See spec §3.
const token = await getGithubInstallationToken()
```

- [ ] **Step 4: 验证无回归**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无新增报错。

Run: `npm test -- pr-comment-mirror task-pr-sync 2>&1 | tail -20`
Expected: 既有相关测试仍通过（若这些 service 有测试套件）。

- [ ] **Step 5: Commit**

```bash
git add lib/services/pr-comment-mirror.service.ts lib/agent/execute.ts lib/services/task-pr-sync.service.ts
git commit -m "feat: thread workspaceId into GitHub App token call sites (env fallback for batch path)"
```

---

## Task 6: 最终验证

- [ ] **Step 1: 全量类型检查**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: 0 errors。

- [ ] **Step 2: 跑新增 + 相关测试**

Run: `npm test -- registry github-app-installation github/auth`
Expected: 全绿。

- [ ] **Step 3: 确认无 console.log（仅允许 warn/error）**

Run: `git diff --stat HEAD~5 && grep -rn "console.log" lib/integrations/github/auth.ts lib/integrations/registry.ts lib/repositories/github-app-installation.repository.ts`
Expected: 无 `console.log`（auth.ts 里只有过渡期 `console.warn`，符合邻居约定）。

- [ ] **Step 4: token 基线（如触发 lint:tokens 钩子）**

本期不碰颜色/UI，预期 `lint:tokens` 无新基线。若 pre-commit 钩子报 token 问题，停下核对是否误改了样式文件。

---

## 实现注意（汇总）

- **不动 GitHub personal OAuth**：`GitHubIntegration` 相关 service/repository/route 一律不改——它们在跑 PR 评论镜像、webhook、PR 链接（见 spec §5）。
- **env fallback 是过渡期生命线**：在所有目标 workspace 都有 `GitHubAppInstallation` 行之前不能删 `GITHUB_APP_INSTALLATION_ID`。
- **PR 描述**：含 schema 变更，注明"prod 需 `migrate deploy`，纯加表无数据破坏"。
- **分支/PR 命名**：等拿到 LUM 编号后按 `lumo/{task-id}-{desc}` 重命名分支、PR 标题带 `[LUM-N]`。
- **webhook 落库**：`installation` webhook 接线为后续工作，本期只到 repository 写入函数 + TODO。
