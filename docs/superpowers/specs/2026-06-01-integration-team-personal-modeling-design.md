# Integration 团队级 / 个人级正式建模 + GitHub 团队 App 模型

**日期**: 2026-06-01
**状态**: 设计已批准（v2，范围已收窄），待实现

> **v2 变更说明**：v1 把 GitHub 建模为 DUAL（个人 OAuth + 团队 App 双轨）并设计了 kind 驱动的凭证 resolver。讨论后收窄为：**GitHub 归 TEAM**、本期不做 personal 轨；同时砍掉 resolver 层——因为没有 DUAL 之后，现有整合的 scope 已被各自函数签名锁死（Figma/Drive 强制要 memberId、Slack/Sentry 只收 workspaceId），再包 resolver 是纯 churn、零新增保证。

## 背景与目标

Lumo 现有 5 个 integration（Slack、Sentry、Figma、Google Drive、GitHub），它们的"团队级 / 个人级"语义已被 schema 的唯一约束形状隐式定死：

| 类别     | 整合                  | 约束形状                                      | 语义                               |
| -------- | --------------------- | --------------------------------------------- | ---------------------------------- |
| TEAM     | Slack、Sentry、GitHub | `workspaceId @unique`（或全工作区共享的安装） | 无主体的系统行为：一次安装全团队用 |
| PERSONAL | Figma、Google Drive   | `@@unique([workspaceId, memberId])`           | 跟个人账号访问权限走：各连各的     |

> 注：`GitHubIntegration` 表虽然是 `@@unique([workspaceId, memberId])`，但本期把 GitHub 的**整合级别**归类为 TEAM——团队 App 安装（agent 自动开 PR 的稳定后端）是主干。现有的个人 OAuth 代码不删、不动，只是本期不把它当作一条要正式建模/扩展的 personal 能力线。

现状两个问题：

1. **分类只是隐式的**——没有任何代码层的真相源声明每个整合是 TEAM 还是 PERSONAL。
2. **GitHub 团队 App 安装没有进 DB**——它现在靠 `GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID` 三个环境变量跑（[lib/integrations/github/auth.ts](../../../lib/integrations/github/auth.ts)），是**一份全局安装**。多 workspace 上线时，agent 自动开 PR 没有 per-workspace 的稳定安装可依赖。

**本期目标**：

- **A. 代码层真相源**：定义 `IntegrationKind`（TEAM / PERSONAL）+ descriptor 登记表，作为每个整合 kind 的单一真相源。
- **B. 补 GitHub 团队 App 模型**：把环境变量驱动的全局安装，改成 per-workspace 的 DB 模型 `GitHubAppInstallation`，`getGithubInstallationToken` 支持按 workspaceId 解析、env 降级 fallback。

**非目标（YAGNI）**：

- **不建凭证 resolver 层**——无 DUAL 后纯 churn。
- **不做 GitHub personal 轨**——现有个人 OAuth 代码原样保留，不删不扩。
- **不合并 5 张异构表为单表**。
- **不改 integrations 设置页前端分组展示**——registry 让它成为后续 trivial follow-up，本期不做。
- **不加 i18n key（nameKey）**——只服务于上面的分组 UI，等做 UI 时再加，避免本期改 16 个 locale 文件却没人消费。
- **不改各整合内部既有取 token 逻辑**（needsReauth / refresh / decrypt 原样保留）。

## 1. IntegrationKind + descriptor 登记表

```ts
// lib/integrations/registry.ts
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

`as const satisfies Record<IntegrationId, IntegrationDescriptor>` 保证：每个 id 都有条目（漏一个则编译失败）、kind 是合法字面量。registry-completeness 测试再加运行期兜底。

## 2. `GitHubAppInstallation` 模型 + 迁移 + 过渡 fallback

```prisma
model GitHubAppInstallation {
  id             String   @id @default(cuid())
  workspaceId    String   @unique          // 团队级：一 workspace 一份安装
  installationId Int                        // GitHub 给的 installation id
  accountLogin   String?                    // 安装到的 org/user
  accountType    String?                    // "Organization" | "User"
  repositories   String[]                   // 选定仓库（可选）
  installedBy    String?
  installer      WorkspaceMember? @relation("GitHubAppInstaller", fields: [installedBy], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([installationId])
  @@map("github_app_installations")
}
```

反向关系字段：`Workspace` 加 `gitHubAppInstallation GitHubAppInstallation?`；`WorkspaceMember` 加 `gitHubAppInstalls GitHubAppInstallation[] @relation("GitHubAppInstaller")`。

- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` 留在 env（**一个 Lumo App、多份 installation**，App 凭证本就是全局的）；只有 `installationId` 下沉到 per-workspace。
- `getGithubInstallationToken()` → `getGithubInstallationToken(workspaceId?: string)`：传了 workspaceId 且查到 `GitHubAppInstallation` 就用该 `installationId` 铸 token；否则**降级读 `GITHUB_APP_INSTALLATION_ID` 环境变量并打 warn 日志**（过渡期，覆盖当前单租户 prod）。`workspaceId` 可选 → 调用点改造可增量、过渡期安全。
- 新 workspace 的安装走 GitHub App 的 `installation` webhook 落库。**本期范围**：建表 + 写入函数（repository）+ 留 TODO 接 webhook 路由；webhook handler 本身后续接。当前 prod 那一份由 env fallback 覆盖。
- 迁移按 CLAUDE.md：本地 `prisma migrate dev`；PR 描述注明"prod 需 `migrate deploy`"，**纯加表、无数据破坏**。

## 3. 调用点改造（workspaceId 透传）

`getGithubInstallationToken` 加可选 `workspaceId` 后，在能轻松拿到 workspaceId 的调用点传入（拿不到的先不传，由 env fallback 兜底）：

- [lib/agent/execute.ts:121](../../../lib/agent/execute.ts) — `resolveCredentials()`，上层有 task/workspace 上下文，传入。
- [lib/services/pr-comment-mirror.service.ts](../../../lib/services/pr-comment-mirror.service.ts)（多处）— 操作对象有 `PullRequest.workspaceId`，传入。
- [lib/services/task-pr-sync.service.ts:18](../../../lib/services/task-pr-sync.service.ts) — `syncPullRequestStatus(openPrs)` 入参不带 workspaceId；**本期不强改签名**，留 env fallback，加注释说明。

## 4. 测试

- **registry-completeness**：5 个 id 都有 descriptor、kind ∈ {TEAM, PERSONAL}；`getIntegrationKind` 返回正确。
- **`githubAppInstallationRepository`** CRUD：`findByWorkspace` 命中 / 未命中、`upsert` create+update 路径、`delete`。
- **`getGithubInstallationToken(workspaceId?)`**：
  - 传 workspaceId 且 DB 有行 → 用 DB 的 installationId 铸 token。
  - 传 workspaceId 但 DB 无行 → 降级 env，打 warn。
  - 不传 workspaceId → 用 env。
  - env 也缺 → 抛错。
  - mock `@octokit/auth-app` 的 `createAppAuth` 与 `githubAppInstallationRepository`，保持 mock 干净。

## 5. 风险与注意

- **GitHub App 过渡期**：env fallback 必须保留到所有 workspace 都有 `GitHubAppInstallation` 行，否则现网单租户会断。fallback 命中要打 warn 日志以便观测迁移进度。
- **现有个人 OAuth 代码**：本期完全不动 `GitHubIntegration` 相关的 service/repository/route——避免误删在用的 PR 评论镜像、webhook 等逻辑。
- **分层架构**：`registry.ts` 是纯常量/类型模块，无依赖；`getGithubInstallationToken` 读 repository 属于 integration 模块对 repository 的正常组合；Prisma 访问只在 repository 层。
- **迁移漂移**：若 `prisma migrate dev` 撞 P3008/P3012，按 CLAUDE.md 的手写 SQL + `db execute` + `migrate resolve --applied` 流程，**不得** reset 或直改 `_prisma_migrations`。
