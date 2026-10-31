# Lumo 平台后台（Admin Console）设计

日期：2026-10-30 · 状态：问题已答完，待用户审阅批准

## 1. 为什么做

Lumo 是 SaaS，运营方现在没有任何界面能看客户 workspace、用户、用量，也没法处理 waitlist：
`WaitlistEntry` 只是一张只进不出的表，而公开注册是敞开的——任何人注册后都能直接创建 workspace，
waitlist 形同虚设。

这个项目做两件事：

1. **一个独立的平台后台**（新 private repo，`Lumo-Workspace` 组织下），给 Lumo 运营方查看客户数据、审批 waitlist。
2. **主应用里的"创建 workspace 需批准"门禁**，让 waitlist 真正起作用。

## 2. 目标

- 后台能查看：客户 workspace、用户、用量；订阅先占位。
- 后台能管理 waitlist：列表/搜索，一键"批准并发邀请邮件"，可重发。
- 主应用：没被批准、也没被已有 workspace 邀请的人，不能创建 workspace，自动进 waitlist。
- 只有平台管理员能用后台。

## 3. 非目标（这一版不做）

- 计费/订阅本身：Lumo 目前没有任何套餐、席位或支付数据，订阅页只放占位说明。
- 在后台里任命管理员：用 `scripts/auth-admin/grant-admin.ts` / `revoke-admin.ts` 给人设 / 撤 `auth_users.role = 'admin'`。
- 在后台里改客户数据（封禁、删 workspace、改成员等）：只读。唯一的写操作是 waitlist 审批。
- 模拟登录（impersonation）：Lumo 已在 admin 插件里显式关闭（LUM-1071），保持关闭。

## 4. 反目标（做到了也算失败）

- 后台直连生产数据库，或持有能直连的凭证。
- 门禁误伤：已有客户邀请同事进 workspace 失败，或老用户被挡在门外。
- 自托管 / 本地模式的用户被门禁拦住。
- 后台接口被非管理员访问到（这些接口能看到所有租户的数据）。

## 5. 已定的决定（用户定的）

| 决定                    | 内容                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 数据访问                | 后台**只**通过主应用新开的一组管理接口取数据，不直连数据库                                                                                                   |
| 仓库                    | `Lumo-Workspace` 组织下新建 private repo                                                                                                                     |
| 注册账号                | 保持开放，全局开关 `AUTH_DISABLE_SIGNUP` 不动                                                                                                                |
| 门禁位置                | 卡在**创建 workspace**，不卡注册账号                                                                                                                         |
| 放行条件                | ① 邮箱在 waitlist 里且已被后台批准；或 ② 有已有 workspace 的成员邀请（`WorkspaceInvite`）                                                                    |
| 其余情况                | 显示在 waitlist 里（等待审核）                                                                                                                               |
| 老用户                  | 已经属于某个 workspace 的用户建第二个 workspace **不需要**批准                                                                                               |
| waitlist 动作           | 一键批准并给对方发邀请邮件（带注册链接）                                                                                                                     |
| 无 workspace 的存量账号 | **不放行**：开门禁时已注册但不属于任何 workspace 的账号（没建过、已退出、workspace 被删）一律按新人处理，进 waitlist 等审核；不做回填。PR 描述里写明这一影响 |

## 6. 我（Claude）定的决定 —— 用户可推翻

- **技术栈**：后台与主应用同栈——Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui，部署 Vercel。
- **管理员判定**：`auth_users.role = 'admin'`（Better Auth admin 插件已加的列，Lumo 目前从不分配该角色）。
  **前提**：给人设了 `admin` 之后，插件自带的 `/api/auth/admin/*`（ban / delete / set-role / set-password 等，
  且绕过 Lumo 的成员清理）就会对这个人生效。因此同一个 PR 必须把插件的全部 `/admin/*` 路径加进
  `ADMIN_DISABLED_PATHS`（`lib/auth/better-auth/admin-plugin.ts`），只保留插件的 ban 拦截 hook；
  封禁继续走 `lib/services/auth-user-admin.service.ts`。并且必须先合入这一改动，再给任何人设 `admin`。
- **邀请邮件链接**：指向 `/signin`，不是 `/signup`（后者现在就是 waitlist 表单）。按**登录账号的邮箱**（小写）
  匹配 waitlist 记录；用一个不同邮箱的社交账号登录的人匹配不上，会被当作新的待审记录——运营在后台再批一次即可。
- **门禁开关**：新环境变量（暂名 `WORKSPACE_CREATION_REQUIRES_APPROVAL`），默认关；仅托管生产环境打开。
  自托管、本地模式（`local-mode.service.ts`）永远不受影响。
- **被挡下时自动入 waitlist**：用户已登录、有邮箱，onboarding 被挡时直接用他的账号邮箱建/复用 waitlist 记录，
  不让他再填一次表；页面提示"已加入候补名单，等待审核"。
- **订阅页**：占位，写明"计费尚未上线"。

## 7. 主应用改动（lumo 主仓库）

现状核对（2026-10-30，main @ 6fe3cc779）：

- 创建 workspace 只有一个入口：`POST /api/workspaces` → `workspaceService.createWorkspace`（`lib/services/workspace.service.ts`）。
  本地模式另有一处调用（`lib/services/local-mode.service.ts`），须豁免。
- `WaitlistEntry`（`waitlist_entries`）只有 email / name / company / teamSize / createdAt，没有任何状态字段。
- `WorkspaceInvite` 有 email（小写）、status（`InviteStatus`，默认 PENDING）、expiresAt。
- 现有 `app/api/internal/*` 用 `CRON_SECRET` 鉴权、仅供自调用——**管理接口不能放在这个前缀下，也不能用这个密钥**。
- 用量数据目前只有 `WorkspaceLlmSpend`（workspace × feature × month 的 AI 花费，`usdMicros`）。

### 7.1 Schema

`WaitlistEntry` 增加（additive，单次 release 即可）：

- `status`：`PENDING`（默认）/ `APPROVED`
- `approvedAt`、`approvedById`（批准人的 auth user id）
- `lastInvitedAt`、`inviteCount`（重发计数）
- `source`：`MARKETING_FORM` / `ONBOARDING_BLOCKED`（区分来源）

邮箱匹配一律小写比较。

新增平台级审计表 `PlatformAdminAuditEvent`（**不能**复用 `AuditEvent`：后者 `workspaceId` 必填、随 workspace 级联删除、会定期清理）：
管理员 auth user id、动作（如 `waitlist.approve`、`waitlist.resend`、`workspace.view`、`user.view`）、对象类型与 id、
可选的被访问 workspaceId（只存值，不建级联外键，workspace 被删后记录保留）、时间。保留期不跟随现有审计清理任务。

### 7.2 门禁规则

`createWorkspace` 前（在 service 层，不在 route 里）判定，开关打开时按序放行：

1. 用户已是任一 workspace 的成员 → 放行（老用户）
2. 用户邮箱有 `APPROVED` 的 waitlist 记录 → 放行
3. 用户邮箱有 `PENDING` 且未过期的 `WorkspaceInvite` → 放行
4. 否则 → 写入/复用 waitlist 记录（source = `ONBOARDING_BLOCKED`），抛 403，带可识别的错误码，onboarding 页据此显示等待审核

> 第 3 条的含义：被邀请进别人 workspace 的人，正常流程是接受邀请直接进那个 workspace，并不需要创建 workspace。
> 留这条是为了不在"接受邀请之前先去 onboarding 点了新建"时误伤。

已存在的 workspace 成员邀请流程（`app/invite`、`app/api/invites`）本身不改。

### 7.3 管理接口

新前缀 `app/api/admin/*`（不是 `internal`），遵循仓库分层：route → service → repository。每个请求：

1. 鉴权：识别调用者为一个 Lumo 用户，且 `role = 'admin'`，否则 403。
2. 跨租户只读查询走专门的 admin repository，`select` 只取页面所需字段。
3. **读写都记审计**（用户定）：写到 7.1 的平台级审计表 `PlatformAdminAuditEvent`。写操作（批准、重发）记动作和对象；
   读操作至少记"哪个管理员、什么时间、看了哪个 workspace / 用户的详情"。纯列表页是否逐条记由实现者定，但查看单个租户详情必须记。
   后台提供一个审计页，按管理员 / 对象 / 时间筛选。

需要的接口（具体形状留给实现者）：

- workspace 列表（分页、按名称/slug 搜索）与详情（成员数、创建时间、owner、最近活跃、各月 AI 花费）
- 用户列表（分页、按邮箱搜索）与详情（注册时间、所属 workspace、是否封禁）
- waitlist 列表（分页、按状态/邮箱筛选）、批准并发信、重发邀请
- 用量汇总（按月的 AI 花费，按 workspace 排序）

**后台如何以管理员身份调用这些接口**：留给实现者，但必须满足：不在后台存长期共享密钥来代替人的身份；
请求可归属到具体管理员（审计需要）。可选方向：主应用已是 OAuth 提供方（`lib/auth/better-auth/mcp-oauth-*`），
后台作为 OAuth 客户端用 Lumo 账号登录，拿 access token 调接口。

### 7.4 邀请邮件

复用 `lib/integrations/email`（已有 `buildInviteEmail` 等模板），新增一个 waitlist 批准模板：
告知已通过、给出注册 / 登录链接。邮件沿用现有模板的做法（`buildInviteEmail` 等都是英文 HTML，不走 react-intl）——我的决定；onboarding 页面上的文案则走 i18n，所有 locale 都要更新。

### 7.5 onboarding 提示

被挡下时 onboarding 页显示"已加入候补名单，等待审核"；文案同样所有 locale。

## 8. 后台（新 repo）

页面：

- 登录（Lumo 账号；非管理员显示无权限）
- 概览：workspace 数、用户数、待审 waitlist 数、本月 AI 花费
- Workspaces：列表 + 详情
- Users：列表 + 详情
- Usage：按月 AI 花费
- Waitlist：列表、筛选、批准并发邀请、重发
- Audit：管理员操作记录（读 + 写）
- Subscriptions：占位

后台只做展示和调用接口，不含业务逻辑；所有判断在主应用 service 层。

## 9. 交付与发布顺序

1. 合并主应用 PR 并部署；确认 `migrate deploy` 已在生产执行（对生产库跑 `prisma migrate status`）。门禁开关此时仍默认关。
2. 给运营人员设 `role = 'admin'`：`npx tsx scripts/auth-admin/grant-admin.ts --email <运营邮箱>`（默认演练，加 `--confirm` 才写；撤销用 `revoke-admin.ts`，下一次请求即失效；已封禁用户拒绝授予）。
3. 运行 `scripts/admin-oauth/register-console-client.ts --confirm` 注册后台 OAuth 客户端（需要一个已有的 admin；客户端记在该运营用户名下，见 9.1）。
4. 配置并部署后台（LUM-1345）。
5. 在后台把现有 waitlist 积压里该放行的人批准掉。
6. 在生产设置 `WORKSPACE_CREATION_REQUIRES_APPROVAL=true` 打开门禁。

### 9.1 Provisioning the console client

动态客户端注册拿不到 `platform-admin`，所以运营人员在服务端注册一次后台这个 OAuth 客户端（机密客户端、无同意页、只授 `platform-admin`、只关联 `/api/admin` 资源、不发 refresh token）。默认是 dry run，加 `--confirm` 才写库；`DATABASE_URL` 在自己的 shell 里指向目标库：

```
npx tsx scripts/admin-oauth/register-console-client.ts --name "Lumo Admin" \
  --redirect-uri https://admin.example.com/api/auth/callback \
  --operator-email <已是 admin 的运营人员邮箱> --confirm
```

成功时只打印一次 client id 和 client secret（库里只存哈希，之后无法再看到）；把它们配进后台的环境变量。`--operator-email` 必须是已有 `role = 'admin'` 且未被封禁的用户：provider 的创建接口要求登录态，脚本为其临时建一个 5 分钟有效的会话，用完即删。

注意：客户端记在该运营用户名下（`AuthOauthClient.user` 为 `onDelete: Cascade`），删除这个账号会连带删除后台的 OAuth 客户端——建议用一个专用的运营账号来执行注册，不要用个人账号。redirect URI 必须是 https 且不能是 localhost/回环地址（provider 对 web 客户端的硬性要求），本地调试后台请用 https 隧道或域名。

## 10. 留给实现者

- 后台到主应用的鉴权具体机制（满足 7.3 的约束）。
- 接口的分页/响应形状、后台的视觉细节（沿用 shadcn/ui 默认即可）。
- 新 repo 的名字（暂定 `lumo-admin`）。
- 任务拆分方式。
