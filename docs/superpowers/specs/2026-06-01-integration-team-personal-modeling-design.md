# Integration 团队级 / 个人级正式建模 + GitHub 团队 App 模型

**日期**: 2026-06-01
**状态**: 设计已批准，待实现

## 背景与目标

Lumo 现有 5 个 integration（Slack、Sentry、Figma、Google Drive、GitHub），它们的"团队级 / 个人级"语义其实已被 schema 的唯一约束形状隐式定死：

| 类别     | 整合                | 约束形状                                            | 语义                                        |
| -------- | ------------------- | --------------------------------------------------- | ------------------------------------------- |
| TEAM     | Slack、Sentry       | `workspaceId @unique`                               | 无主体的系统行为：一次安装全团队用          |
| PERSONAL | Figma、Google Drive | `@@unique([workspaceId, memberId])`                 | 跟个人账号访问权限走：各连各的              |
| DUAL     | GitHub              | 个人轨 `@@unique([workspaceId, memberId])` + 团队轨 | 双轨：个人 OAuth 提 PR + 团队 App 自动开 PR |

现状两个问题：

1. **这套分类只是隐式的**——没有任何代码层的真相源，也没有任何东西阻止某个 service 用 `workspaceId`-only 去越权读个人级整合的凭证。
2. **GitHub 团队 App 轨没有进 DB**——它现在靠 `GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID` 三个环境变量跑（[lib/integrations/github/auth.ts](../../../lib/integrations/github/auth.ts)），是**一份全局安装**。多 workspace 上线时，agent 自动开 PR 没有 per-workspace 的稳定安装可依赖。

**本设计的两个目标**：

- **A. 代码层正式建模**：定义 `IntegrationKind`（TEAM / PERSONAL / DUAL）+ descriptor 登记表，并让 kind **真正驱动** service 层的凭证解析（不只是文档）。
- **B. 补 GitHub 团队 App 模型**：把环境变量驱动的全局安装，改成 per-workspace 的 DB 模型 `GitHubAppInstallation`。

**非目标（YAGNI）**：

- 不合并 5 张异构表为单表（爆炸半径过大、丢强类型列）。
- 不改 integrations 设置页的前端分组展示（descriptor 让它成为后续 trivial follow-up，但本次不做）。
- 不改各整合内部既有的 token 逻辑（needsReauth / refresh / decrypt 原样保留）。

## 1. 架构与数据流

保留现有 5 张异构表的结构，新增两层：

```
descriptor 登记层  lib/integrations/registry.ts    ← 唯一真相源：每个 integration 声明 kind
凭证解析层        lib/integrations/credentials.ts  ← 按 kind 分发 + 类型强制 scoping
                          │
   ┌──────────────────────┼───────────────────────┐
 TEAM loader          PERSONAL loader          DUAL loader
 (slack/sentry)       (figma/drive)            (github: team + personal)
   │                       │                        │
 各 integration 模块导出自己的 loader（内部仍走现有 repository/service 取 token 逻辑）
```

调用方不再直接 import 某个 service 的取 token 函数，而是走 `resolveTeamCredential(id, ctx)` / `resolvePersonalCredential(id, ctx)`。符合分层架构：loader 在 `lib/integrations/<svc>`，resolver 是其上的薄分发层，Service 通过 resolver 拿凭证。

## 2. IntegrationKind + descriptor 登记表

```ts
// lib/integrations/registry.ts
export type IntegrationKind = 'TEAM' | 'PERSONAL' | 'DUAL'
export type IntegrationId =
  | 'slack'
  | 'sentry'
  | 'figma'
  | 'googleDrive'
  | 'github'

export interface IntegrationDescriptor {
  id: IntegrationId
  kind: IntegrationKind
  nameKey: string // i18n key，不存英文字面量
}

export const INTEGRATIONS = {
  slack: { id: 'slack', kind: 'TEAM', nameKey: 'integrations.slack.name' },
  sentry: { id: 'sentry', kind: 'TEAM', nameKey: 'integrations.sentry.name' },
  figma: { id: 'figma', kind: 'PERSONAL', nameKey: 'integrations.figma.name' },
  googleDrive: {
    id: 'googleDrive',
    kind: 'PERSONAL',
    nameKey: 'integrations.googleDrive.name',
  },
  github: { id: 'github', kind: 'DUAL', nameKey: 'integrations.github.name' },
} as const satisfies Record<IntegrationId, IntegrationDescriptor>
```

`as const satisfies` 让每个 kind 在类型层是字面量，供第 3 节推导。registry-completeness 测试保证 5 个 id 都在且 kind 合法。descriptor 字段只放 id / kind / nameKey（图标、docs 暂不进，YAGNI）。

## 3. CredentialContext 判别式 + resolver（强制力所在）

凭证返回体各整合不同（Slack `{token}`、Figma `{accessToken, refreshToken, needsReauth}`、GitHub 两轨各异），因此返回类型按整合泛型化，resolver 只负责**分发 + scoping 强制**：

```ts
// 由 registry 的 kind 在类型层推导出"哪些 id 允许团队 / 个人访问"
type Kind<K extends IntegrationId> = (typeof INTEGRATIONS)[K]['kind']
type TeamCapableId     = { [K in IntegrationId]: Kind<K> extends 'TEAM' | 'DUAL' ? K : never }[IntegrationId]
type PersonalCapableId = { [K in IntegrationId]: Kind<K> extends 'PERSONAL' | 'DUAL' ? K : never }[IntegrationId]

resolveTeamCredential(id: TeamCapableId,     ctx: { workspaceId: string }): Promise<Cred | null>
resolvePersonalCredential(id: PersonalCapableId, ctx: { workspaceId: string; memberId: string }): Promise<Cred | null>
```

**强制力（teeth）**：

- `resolvePersonalCredential('slack', …)` → 编译报错（slack 是 TEAM）
- `resolveTeamCredential('figma', …)` → 编译报错（figma 是 PERSONAL）
- GitHub（DUAL）两个入口都收

这把"个人级整合绝不能用 workspaceId-only 越权拿到别人凭证"变成类型层强制。运行期再加一道断言兜底（防止 `as any` 绕过）。

每个整合在自己模块里导出符合 kind 契约的 loader，registry 旁的 `LOADERS` 把 id ↔ loader 绑定。GitHub 的 DUAL loader 暴露 `.team(workspaceId)` 和 `.personal(workspaceId, memberId)` 两个访问器。

## 4. `GitHubAppInstallation` 模型 + 迁移 + 过渡 fallback

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

- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` 留在 env（**一个 Lumo App、多份 installation**，App 凭证本就是全局的）；只有 `installationId` 下沉到 per-workspace。
- `getGithubInstallationToken()` → `getGithubInstallationToken(workspaceId: string)`：先查 `GitHubAppInstallation`，命中就用该 `installationId` 铸 token；**未命中降级读 `GITHUB_APP_INSTALLATION_ID` 环境变量并打 warn 日志**（过渡期，覆盖当前单租户 prod）。
- 新 workspace 的安装走 GitHub App 的 `installation` webhook 落库。**本次范围**：建表 + 写入函数（repository + service）+ 留 TODO 接 webhook 路由；webhook handler 本身后续接。当前 prod 那一份由 env fallback 覆盖。
- 迁移按 CLAUDE.md：本地 `prisma migrate dev`；PR 描述注明"prod 需 `migrate deploy`"，**纯加表、无数据破坏**。

## 5. 调用点改造清单

`getGithubInstallationToken` 加 `workspaceId` 参数后，3 个文件要把 workspaceId 透传进来（实现时逐个核实上下文能拿到）：

- [lib/agent/execute.ts:121](../../../lib/agent/execute.ts)
- [lib/services/pr-comment-mirror.service.ts](../../../lib/services/pr-comment-mirror.service.ts)（6 处）
- [lib/services/task-pr-sync.service.ts:18](../../../lib/services/task-pr-sync.service.ts)

个人级 / 团队级 service（figma / drive / slack / sentry）取 token 处改为经 resolver，但**内部 token 逻辑（needsReauth / refresh / decrypt）原样保留**——只是把入口收口到 resolver。

## 6. 测试

- registry-completeness：5 个 id 都有 descriptor、kind 合法。
- resolver 分发 + 运行期 scoping 断言（TEAM 传 memberId、PERSONAL 缺 memberId 各自的行为）。
- 类型层 negative 测试（`@ts-expect-error` 断言越权调用编译失败）。
- `GitHubAppInstallation` repository CRUD。
- `getGithubInstallationToken(workspaceId)`：DB 命中路径 + env 降级路径（mock `createAppAuth` / octokit，保持 mock 干净）。

## 风险与注意

- **越权 scoping 绕过**：类型层是主防线，运行期断言是 `as any` 兜底——两者都要有。
- **GitHub App 过渡期**：env fallback 必须保留到所有 workspace 都有 `GitHubAppInstallation` 行，否则现网单租户会断。fallback 命中要打 warn 日志以便观测迁移进度。
- **i18n**：新增 `integrations.<id>.name` key 要按 CLAUDE.md 更新**每个** locale 文件，不留英文 fallback。
- **分层架构**：resolver 是 integration 模块之上的薄层，不得反向依赖 Service；Prisma 访问只在 repository 层。
