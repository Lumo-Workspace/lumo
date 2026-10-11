# RFC：生产认证从 Clerk 迁移到 Better Auth（LUM-1069）

> 状态：**已裁定（2026-10-10）**，结论见 §12；Q5 等用户在 Clerk Dashboard 查数。基线 `origin/main` @ 9db0c7993（2026-10-10）。代码结论都在该 commit 上核对过；外部能力以文中链接的官方文档为准（2026-10-10 抓取）；本仓库锁定 `better-auth` 1.7.7、`@better-auth/oauth-provider` 1.7.7（`package.json`）。
>
> 背景裁定：2026-10-10 用户决定把托管 SaaS（www.uselumo.ai）的认证从 Clerk 迁到 Better Auth（下称 BA）。BA 实现已在自托管上线（LUM-1026 抽象层、LUM-1027/1043 邮箱密码与 GitHub/Google、LUM-1044 MCP OAuth、LUM-1041 SMTP）。

## 0. 结论摘要

1. **可以做，而且可以做到业务表一行不改**：从 Clerk 导出用户后，按原 `user_xxx` id 写入 `auth_users`。身份列共 11 列、分布在 10 张表（附录 A 命令复现），另有 1 列名字看不出来的（`PriorityOverride.memberId`）和富文本里的 `@mention` `data-id`。只要 id 不变，这些都不用动。
2. **密码能带过去**：Clerk Dashboard 的「Export users」CSV 含哈希密码（Clerk 官方文档），BA 的迁移指南说明这是 bcrypt。BA 的 `emailAndPassword.password.verify` 可以自定义，按前缀识别 bcrypt 后用 `bcryptjs` 校验即可（新增 npm 依赖，**已批准，引入前跑 `npm audit`**，Q2）。CSV 拿不到或某些行不是 bcrypt 时，退路是「忘记密码」邮件重置。
3. **社交登录不需要按邮箱猜**：导入时把 Clerk 的 `external_accounts`（provider + `provider_user_id`）直接写成 `auth_accounts` 行。BA 1.7.7 登录时**先按 (providerId, accountId) 找账号**，找不到才按邮箱关联（已在 `node_modules/better-auth/dist/oauth2/link-account.mjs` 核实）。GitHub OAuth App 现在允许 10 个回调 URL，可以和 Clerk 的回调并存，所以回滚时不用改 OAuth app。
4. **客户端影响**：web 会话全部失效，用户要重新登录一次。**CLI 不受影响**：它用 `lum_` API key，校验只查 DB，不经过 Clerk。**MCP 要重新授权一次**：issuer 从 `clerk.uselumo.ai` 换成 `www.uselumo.ai`，BA 侧 DCR 和 consent 页（LUM-1044）已经实现，只需配好 `BETTER_AUTH_URL`。
5. **上线前必须补的 BA 缺口**（自托管可以不补，SaaS 不行）：①忘记/重置密码（现在没有接 `sendResetPassword`，也没有页面）；②限流存储：BA 默认用进程内存，在 Vercel 多实例上基本无效，要改成数据库存储，需要一个 additive 迁移；③封禁/删号等运维操作的入口，用来替代 Clerk Dashboard 加 webhook；④新用户 id 加 `user_` 前缀，`audit-query` 依赖这个前缀。
6. **切换方式**：用 Vercel 的 staged production build（带 BA 环境变量构建，但不自动挂域名），验证后再 promote。**回滚**用 Vercel Instant Rollback 切回切换前的部署：它用的是那次构建的原环境变量，Clerk 实例原样保留，秒级生效。
7. **工作量**：8 个可以独立合并的任务（T1–T8），按 §12 的裁定调整后约 **11–12.5 人日**（agent，即 §9 逐项估算之和）。用户要亲自做的步骤约 3–4 小时，外加一个约 60 分钟的切换窗口，见 §9。
8. **代码清理**：稳定 30 天后**删除 Clerk 实现**（保留 `lib/auth` 接口和 `clerkId` 这类列名），见 §10。
9. **托管 MCP 的临时方案（已裁定，Q3）**：切换前在 Clerk Dashboard 打开「Publish DCR support」作为临时方案。打开后用 MCP Inspector 实测：`registration_endpoint` 出现且能连通就保留；实测失败就关掉，等 BA。详见 §4.3。

---

## 1. 账号：导出与导入

### 1.1 现状核对

- `lib/auth/provider.ts`：`AUTH_PROVIDER` 未设或为 `clerk` 时用 Clerk，为 `better-auth` 时用 BA，其他值直接抛错。
- BA 的用户表是 `AuthUser`（`auth_users`）、`AuthAccount`、`AuthSession`、`AuthVerification`，另有 MCP OAuth 的 `AuthOauth*` 和 `AuthJwks`（`prisma/schema.prisma` 第 3939 行起）。**这些表已经通过迁移在生产库里了**：迁移是全局的，只是 Clerk 模式从不读写它们。所以导入前不需要新的 schema。
- Lumo 没有自己的用户表。成员资格（`WorkspaceMember`）在建 workspace 或接受邀请时创建，`clerkId` 存的是认证方的 user id。BA 模式下写进同一列（schema 注释、`lib/auth/better-auth/server.ts` 文件头）。

### 1.2 存用户 id 的列（从 schema 推导，附录 A 可复现）

推导规则：`prisma/schema.prisma` 中，字段名含 `clerk`（不区分大小写），**或**字段上方 `///` 文档注释写明 "Clerk (user) id" 的字段。`Auth*` 表是 BA 自己的表，不在其中。结果是 11 列、10 张表：

| 表.列                                         | 可空 | 用途                        |
| --------------------------------------------- | ---- | --------------------------- |
| `WorkspaceMember.clerkId`                     | 否   | 成员身份（核心）            |
| `McpConnection.clerkUserId`                   | 否   | MCP 连接所属用户            |
| `McpAuditLog.clerkUserId`                     | 否   | MCP 调用审计                |
| `AuditEvent.actorId`                          | 是   | MEMBER 类型审计事件的操作者 |
| `SubprocessorNoticeDelivery.clerkId`          | 否   | 子处理者变更通知的收件人    |
| `Task.deletedByClerkId`                       | 是   | 删任务的人                  |
| `Document.deletedByClerkId`                   | 是   | 删文档的人                  |
| `Workspace.deletionRequestedByClerkId`        | 是   | 申请删 workspace 的人       |
| `WorkspaceDeletionReceipt.requestedByClerkId` | 否   | 删除回执                    |
| `WorkspaceExport.requestedByClerkId`          | 否   | 导出申请人                  |
| `WorkspaceExport.lastDownloadedByClerkId`     | 是   | 最后下载人                  |

**名字推不出来、靠代码交叉核对查到的**（附录 A 第 2 条命令）：

- `PriorityOverride.memberId`：`app/api/tasks/priority-override/route.ts` 写入的是 `requireAuth()` 返回的 `userId`，也就是 Clerk user id，不是 `WorkspaceMember.id`。列名有误导性，但 id 不变就不受影响。另开清理任务时可以顺手改名，与本迁移无关。
- **富文本里的 mention**：评论和文档 HTML 中的 `data-id`（`data-mention-type="user"`）就是 user id（`lib/editor/parse-mentions.ts`）。这类 id 嵌在正文里，**是「保留原 id」方案必须选的决定性理由**：换 id 就得改写所有正文。
- 名字像用户、实际存别的 id 的候选列（`createdById`、`installedBy`、`dispositionedById`、`authorId`、`ownerId` 等）已逐个核对，存的都是 `WorkspaceMember.id` 或 `Actor.id`，与认证方无关（附录 A 第 3 条）。
- 不落库的派生用途：Pusher 频道名、`lib/actor.ts#getActorClerkId`（Slack DM、推送）、CLI 本地凭据里的 `userId`。id 不变就都不受影响。

**结论**：导入时保留 Clerk 的 `user_xxx` id，上表所有列都不动，也不需要回填迁移。

### 1.3 从 Clerk 导出（由用户执行）

两路数据，都由用户在本机完成（见 §8 的落地规则）：

1. **Dashboard CSV**（主数据，含密码哈希）：Clerk Dashboard → 实例 Settings → **User exports** → Export users → 在导出历史里 Download。官方文档说 CSV「includes their hashed passwords」，只有管理员或个人 workspace 能导出；文档**未写套餐要求**。<https://clerk.com/docs/guides/development/migrating/overview>
   - BA 的迁移指南使用其中的 `password_digest`、`password_hasher` 列。<https://better-auth.com/docs/guides/clerk-migration-guide>
   - 导出是某一时刻的快照，所以切换窗口开始时要**再导一次**做增量（§6）。
2. **Backend API `GET /v1/users`**（补 CSV 没有的字段：外部账号、各邮箱的验证状态、`banned`、`locked`、头像）：
   - 分页：`limit` 1–500（默认 10），`offset`，`order_by` 默认 `-created_at`，返回 `data` 和 `totalCount`。<https://clerk.com/docs/reference/backend/user/get-user-list>
   - 字段：`id`、`emailAddresses[].verification.status`、`primaryEmailAddressId`、`externalAccounts[]`（provider、`providerUserId`、`approvedScopes`、`emailAddress`，**含未验证的**）、`passwordEnabled`、`banned`、`locked`、`imageUrl`、`createdAt`。User 对象**不含密码哈希**。<https://clerk.com/docs/reference/backend/types/backend-user>、<https://clerk.com/docs/reference/backend/types/backend-email-address>
   - 限流：按实例计算，生产 1000 次/10 秒，超限返回 429。<https://clerk.com/docs/guides/how-clerk-works/system-limits>。每页 500，几百个用户只需个位数请求，不会碰到限流。
   - 总数：`GET /v1/users/count`（SDK 的 `users.getCount()`）。<https://clerk.com/docs/reference/backend/user/get-count>
   - 这一步要用生产 `CLERK_SECRET_KEY`，**只能由用户在本机运行**导出脚本（§9 的 T3 会提供脚本，凭据从用户 shell 的环境变量读，脚本不打印）。

**用户数（不含个人信息）**：Clerk Dashboard 首页的用户数，或上面的 count 接口。有成员资格的人数可以对生产库只读查询 `WorkspaceMember` 里不同 `clerkId` 的个数（附录 B），这一项也由用户执行。两数之差就是「在 Clerk 注册了、但没进任何 workspace」的人，他们同样要导入，否则无法登录。

### 1.4 导入到 BA（T3 脚本，由用户对生产库执行）

逐个 Clerk 用户：

| BA 目标                                      | 来源                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `auth_users.id`                              | Clerk `id`（原样保留 `user_xxx`）                                                                                                |
| `email`                                      | 主邮箱（`primaryEmailAddressId`），转小写                                                                                        |
| `emailVerified`                              | **主邮箱**的 `verification.status === 'verified'`（比 BA 指南的「任一邮箱已验证」更严，因为 BA 只有一个 email 字段）             |
| `name` / `firstName` / `lastName`            | Clerk `firstName` / `lastName`，`name` 按 `nameFieldsForCreate` 规则生成（`lib/auth/better-auth/user-shape.ts`）                 |
| `image`                                      | 见下方「头像」                                                                                                                   |
| `createdAt`                                  | Clerk `createdAt`                                                                                                                |
| `auth_accounts`（`providerId='credential'`） | `accountId = userId`，`password = password_digest`（仅当 `password_hasher` 是 bcrypt）                                           |
| `auth_accounts`（github / google）           | `providerId` = provider 去掉 `oauth_` 前缀，`accountId = providerUserId`，`scope = approvedScopes`；不导入 token（Clerk 也不给） |

- **写法**：用 Prisma 直接 upsert，按 id 幂等。这些表是我们自己的 schema（BA 指南里用的 `forceAllowId` 是绕过 BA adapter 的做法，我们不需要）。`auth_accounts.id` 用确定性 id（例如 `clerk-<userId>-<provider>`），这样重跑不会产生重复行。
- **dry-run 报告只输出计数**：总数、无邮箱数、主邮箱未验证数、各 `password_hasher` 的数量、各 provider 的数量、邮箱大小写冲突数、`banned` 数。**不输出任何邮箱或姓名**。
- **边界情况**：
  - **没有邮箱**（只用手机号或用户名注册）：BA 的 `email` 必填。报告计数，逐个人工处理；如果生产 Clerk 只开了邮箱和社交登录，这一项应为 0。
  - **多个邮箱**：只有主邮箱进 BA。次邮箱已验证、且有人用次邮箱发了未接受的邀请时，Clerk 能匹配，BA 不能匹配（`getVerifiedEmails` 在 BA 下只返回主邮箱，见 `lib/auth/index.ts` 和 `user-shape.ts`）。dry-run 报告「有多个已验证邮箱的用户数」和「发往次邮箱的待接受邀请数」，非 0 就让邀请人重发。
  - **小写后邮箱冲突**（两个 Clerk 用户的邮箱只差大小写）：不导入，逐个人工处理。
  - **`banned=true`**：导入后同步设成 BA 的封禁状态（需要 T2 的 admin 字段）；成员资格此前已被 webhook 停用，不受影响。
  - **头像**：Clerk 的 `imageUrl` 指向 `img.clerk.com`，Clerk 实例删除后可能失效。**已裁定转存（Q6）**：导入时先记录原 URL，由 T3 的 `avatars` 子命令把仍指向 Clerk 的头像转存到自有 Blob（`lib/blob/storage`，路径与 BA 上传头像相同），再改写 `auth_users.image`。转存必须在 T8 和 Clerk 实例删除之前完成。
- **新用户 id 前缀**：`lib/services/audit-query.service.ts` 用 `ref.startsWith('user_')` 识别「原始 user id」。BA 默认生成的 id 没有这个前缀。T1 用 `advanced.database.generateId`（1.7.7 签名 `({ model, size }) => string | false`）只给 `user` 模型生成 `user_<随机>`，这样新老用户的 id 形状一致。

## 2. 密码

- **能导出**：只有 Dashboard CSV 一个途径，Backend API 不返回哈希（见 §1.3 的链接）。早期 Clerk 文档要求联系客服才能导出，现行文档已改为自助导出。
- **算法**：Clerk 现行文档没写自己用什么算法。BA 的 Clerk 迁移指南说 Clerk 存的是 bcrypt：用户被导入 Clerk 时如果带的是 md5、sha256 这类弱哈希，**Clerk 自己**会在其首次登录时升级成 bcrypt（<https://better-auth.com/docs/guides/clerk-migration-guide>）。这是 Clerk 内部的行为，意思是导出的哈希应该基本都是 bcrypt；它和 BA 侧要不要重新哈希无关（BA 侧不做，见下文）。**以导出 CSV 中 `password_hasher` 的实际值为准**：dry-run 会按 hasher 计数，非 bcrypt 的行不写 password。
- **BA 怎么校验**：`emailAndPassword.password = { hash, verify }`，1.7.7 类型为 `verify: ({ hash, password }) => Promise<boolean>`（`node_modules/@better-auth/core/dist/types/init-options.d.mts`）。文档：<https://better-auth.com/docs/authentication/email-password>。实现方式：
  - `hash` 不覆盖，新密码继续用 BA 默认的 scrypt。
  - `verify` 看前缀：`$2a$`、`$2b$`、`$2y$` 走 `bcryptjs.compare`，其余调用 `better-auth/crypto` 的 `verifyPassword`。
  - **BA 侧不做任何重新哈希**：登录成功后不把 bcrypt 改写成 scrypt。BA 没有现成的钩子，收益也小。只有用户改密码或重置密码时，新哈希才是 scrypt，bcrypt 会随用户活动逐步淘汰。
  - **新依赖**：仓库里没有 bcrypt 实现。建议用 `bcryptjs`（纯 JS、MIT，不需要原生编译）。用户已批准（Q2）；引入前跑 `npm audit`，并在 T1 的 PR 描述里注明（CLAUDE.md）。
- **导不出时的退路**（全部依赖 T1 先补好「忘记密码」）：

| 方案                                                       | 优点                         | 缺点                                                                                                |
| ---------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| A. 首次登录走「忘记密码」重置（导入时不写 password）       | 实现最简单；不留旧哈希       | 每个密码用户都多一步；依赖邮件送达；大规模重置邮件可能被当成钓鱼                                    |
| B. magic link 插件（BA 1.7.7 自带，`better-auth/plugins`） | 不用记密码；也能兼作重置入口 | 默认 300 秒过期，`disableSignUp` 默认 false（未注册邮箱会被自动注册，必须关）；多一条登录入口要维护 |
| C. 社交登录用户不受影响                                    | Google/GitHub 用户无感       | 只覆盖有社交账号的人                                                                                |

magic link 文档：<https://better-auth.com/docs/plugins/magic-link>。**建议**：主路径用 bcrypt 导入；退路用 A，只对少数非 bcrypt 用户生效；不引入 B，以免多一个攻击面。

- **MFA**：如果生产 Clerk 有用户开了 TOTP 或备用码，现行文档没说导出里是否包含这些密钥。Lumo 的 BA 也**没有启用** `two-factor` 插件。待用户在 Clerk Dashboard 看有没有 MFA 用户（Q5）。为 0 就忽略；不为 0，就让这些用户切换后先用密码登录，再由 T1 的后续任务补 2FA。

## 3. 社交登录

- **关联方式**：导入时直接写 `auth_accounts`（§1.4）。BA 1.7.7 在 OAuth 回调里先用 `findAccountOwnerByKey({ providerId, accountId })` 找已有账号，命中就直接登录，**不看邮箱**。所以 GitHub 主邮箱后来变了的人也能登录。没导入的社交身份（窗口期新绑的）才会走按邮箱的隐式关联，规则如下：
  - 默认只在提供方声明 `email_verified` 时关联。另外 `requireLocalEmailVerified` 默认 true，即本地用户也必须 `emailVerified`，防止有人先用别人的邮箱注册未验证账号、再劫持对方的 OAuth 身份。文档：<https://better-auth.com/docs/concepts/users-accounts>，源码核实于 `link-account.mjs`。
  - **不把 github/google 放进 `trustedProviders`**：放进去后，即使邮箱未验证也会关联，文档明确提示有接管风险。
  - `allowDifferentEmails` 保持 false。
- **主邮箱未验证的导入用户**：密码能登录。社交登录如果账号已导入能登录；未导入的会因为 `requireLocalEmailVerified` 被拒，提示先验证邮箱。T1 要让这个错误有可读文案。
- **邮箱冲突**（社交身份的邮箱等于另一个本地用户的邮箱）：按上面的规则，要么不关联并报错，要么关联到邮箱已验证的那个用户。不会新建重复用户，因为 `auth_users.email` 有唯一约束。
- **回调 URL**：
  - BA 的回调路径是 `<BETTER_AUTH_URL>/api/auth/callback/<provider>`（`docs/self-hosting/README.md`），生产为 `https://www.uselumo.ai/api/auth/callback/github` 和 `…/callback/google`。
  - **GitHub OAuth App** 现在最多可登记 10 个回调 URL；不开通配匹配时要求完全一致。<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app>、<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>
  - **Google** 可以登记多个 redirect URI，必须完全一致且用 https。<https://developers.google.com/identity/protocols/oauth2/web-server>
  - **建议沿用 Clerk 生产正在用的同一对 OAuth app**（Clerk 生产要求自带凭据，由用户在 Clerk Dashboard → SSO connections 确认，Q4），只**追加**新回调、不删旧回调，这样回滚时不用改 OAuth app。
  - 沿用同一个 app 还有一个好处：GitHub 的用户 id 是全局的；Google 的 `sub` 文档写明「unique among all Google accounts and never reused」，不随 client 变。所以 Clerk 记的 `provider_user_id` 就是 BA 收到的 `accountId`。
  - 用户把 client id 和 secret 填进 Vercel 的 `AUTH_GITHUB_CLIENT_ID/SECRET`、`AUTH_GOOGLE_CLIENT_ID/SECRET`。这两组变量不要和 GitHub 集成的 `GITHUB_CLIENT_*` 混淆（`lib/auth/better-auth/config.ts`）。

## 4. 会话与客户端

### 4.1 Web 会话

切换后 Clerk 的会话 cookie 不再被认，所有用户需要重新登录一次（BA 迁移指南也写明会话会失效）。BA 会话默认 7 天，开了 5 分钟的 cookie 缓存（`SESSION_COOKIE_CACHE_SECONDS`），也就是说封禁后**最多 5 分钟**才完全生效。<https://better-auth.com/docs/concepts/session-management>

### 4.2 CLI —— 不受影响（已查代码）

- `cli/src/commands/auth-login.ts`：用户在网页 Settings → API Keys 生成 `lum_` key，粘到 CLI 里。CLI 调用 `GET /api/auth/verify`（`cli/src/lib/api.ts#verifyToken`），之后所有请求都带 `Authorization: Bearer lum_…`。
- 服务端 `lib/auth/bearer.ts` → `authService.verifyApiKey` 是**纯 DB 查询**（key 哈希 → `WorkspaceMember` → `clerkId`），不调 Clerk。只有 `/api/auth/verify` 为了显示邮箱和姓名会调一次 `fetchUserProfile`，它走 `lib/auth/users.ts`，BA 下读 `auth_users`。
- `app/api/auth/verify/route.ts` 与 BA 的 `app/api/auth/[...all]` 并存，Next 优先匹配具体路由。LUM-1028 TC3 已在自托管 BA 上验证过 CLI 登录。
- **结论**：已存的 `lum_` key、`~/.lumo` 凭据、hook 上报，切换后全部照常工作，**CLI 不需要发版**。唯一的前提是 user id 不变（§1）。

### 4.3 MCP

- **BA 侧（LUM-1044 已实现）**：`@better-auth/oauth-provider` + `jwt`，提供 `/api/auth/oauth2/{authorize,token,register,consent,revoke,introspect}`。
  - 根路径 `/.well-known/oauth-authorization-server` 和 `/.well-known/oauth-protected-resource` 由 `lib/auth/oauth-metadata.ts` 按 provider 分派。
  - 开放 DCR（`allowDynamicClientRegistration` + `allowUnauthenticatedClientRegistration`），PKCE S256 必填，redirect URI 必须完全匹配，每个 IP 每分钟最多 5 次注册，consent 页在 `/oauth/consent`（`lib/auth/better-auth/mcp-oauth-plugins.ts`、`mcp-oauth-config.ts`）。
  - BA 1.7 已把 MCP 插件移到 `@better-auth/mcp`，底层就是 oauth-provider。官方现在更推荐 CIMD，DCR 要显式开启（<https://better-auth.com/docs/plugins/mcp>、<https://better-auth.com/docs/guides/1-7-upgrade-guide>）。我们直接用 oauth-provider，与此一致。
- **生产配置**：只需要 `BETTER_AUTH_URL=https://www.uselumo.ai`。issuer 由此变成 `https://www.uselumo.ai`，资源（token 的 `aud`）是 `https://www.uselumo.ai/api/mcp`。不设这个变量时 `/api/mcp` 返回 501（`resolveMcpOAuthUrls`）。
- **已授权的连接**：Clerk 签发的 token 在 BA 下校验失败，`/api/mcp` 返回 401 并带 `WWW-Authenticate`，客户端会重新发现、注册、征求同意。用户看到的是「重新授权一次」。
  - `McpConnection` 按 `(clerkUserId, clientId)` 唯一。新 client id 会生成新行，**之前选定的 active workspace 要重选一次**。旧行留作历史，不删。
- **切换前要定的策略**：BA 目前只允许 `https://` 和 `http://localhost` 的 redirect URI，**`cursor://` 这类自定义 scheme 注册不了**（自托管 README 已写明）。Clerk 侧现在本来就不可用，所以这不是回退，但 SaaS 上 Cursor 用户会受影响。**已裁定（Q7）**：允许自定义 scheme，但只限 allowlist（例如 `cursor`、`vscode`），授权确认页照常显示。安全取舍：自定义 scheme 可能被其他本地应用抢注，所以靠必填 PKCE S256、每个新 client 都要用户确认、scheme 白名单三层兜底（RFC 8252 §7.1 的 private-use URI scheme）。实现放在 T4：`mcp-oauth-config.ts` 的 redirect URI 分类加一个 `native-scheme` 分支，allowlist 写成常量，不做成可配置，并补测试；同时更新自托管 README 里「cursor:// 不能注册」那句。
- **迁移完成前的临时方案（用户尚未决定）**：
  - 现状：LUM-1039（#1340）和 LUM-1047（#1354）已合并，Clerk 模式下 MCP 只差 DCR。
  - Clerk 的开关在 Dashboard → OAuth applications → Settings → Client onboarding → **Publish DCR support**（另有 Publish CIMD support）。开启 DCR 后 consent 页强制开启、不能关。<https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth>
  - **文档没有说明**开启后元数据里是否出现 `registration_endpoint`，示例里没有这个字段，所以开启后要实测。
  - **已裁定（Q3）：切换前开启**。理由：MCP 现在完全不可用；开关可逆；consent 强制开启，安全上与 BA 侧等价；代价只是用户切换后再授权一次。
  - 开启后由用户用 MCP Inspector 实测一遍（发现 → 注册 → 授权 → `tools/list` → `tools/call`）。没有出现 `registration_endpoint` 或注册失败，就关掉开关、等 BA。
  - 开了 DCR 的 Clerk 实例会积累 MCP 客户端注册出来的 OAuth app，在 Clerk 实例销毁时（§10）一并清掉。

## 5. Clerk 专属功能的替代

| Clerk 功能                                                                            | Lumo 现在怎么用                                                                                                                                                | BA 侧做法                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Webhook**（`user.deleted`、`user.updated` 带 `banned`）                             | `app/api/webhooks/clerk/route.ts` → `memberDeprovisionService.deprovisionClerkUser`：停用所有成员资格、吊销 API key、写审计（LUM-906）                         | BA 下用户就在我们自己的库里，**不需要 webhook**。T2 提供服务端运维入口：封禁或删除用户时，在同一个 service 里直接调用 deprovision（`lib/members/deactivation.ts` 的 `MEMBER_DEACTIVATION_REASONS` 新增 `AUTH_USER_DELETED` / `AUTH_USER_BANNED`。`WorkspaceMember.deactivationReason` 是字符串列，不需要迁移；旧的 `CLERK_*` 值保留作历史值）。webhook 路由在 Clerk 代码删除前保留（回滚用）。                |
| **封禁、删号（管理员）**                                                              | 在 Clerk Dashboard 操作，经 webhook 生效                                                                                                                       | BA 的 admin 插件（1.7.7 自带）提供 `banUser`（同时撤销会话，可设到期时间）、`unbanUser`、`removeUser`、撤销会话。<https://better-auth.com/docs/plugins/admin>。需要 additive 迁移：`auth_users` 加 `role`、`banned`、`banReason`、`banExpires`，`auth_sessions` 加 `impersonatedBy`。**不做管理 UI**，T2 提供 `scripts/auth-admin/*.ts`（dry-run 加 `--confirm`，由用户对生产库执行）。**关闭 impersonate**。 |
| **用户自助删号**                                                                      | Lumo 现在没有入口（未暴露 Clerk 的 UserProfile）                                                                                                               | 维持现状，不开 BA 的 `user.deleteUser`（默认关）。需要时另开任务（删号必须走 deprovision 和最后一个 OWNER 的保护）。                                                                                                                                                                                                                                                                                          |
| **`accounts.uselumo.ai`**（Clerk Account Portal）、`clerk.uselumo.ai`（Frontend API） | 托管的登录、用户资料页；代码里没有引用（已 grep）                                                                                                              | 登录和注册已有 `/signin`、`/signup`（BA 表单）。**缺忘记密码、重置密码、改密码**，T1 补齐。Clerk 实例销毁时再删这两个子域名的 DNS 记录（由用户执行），回滚期内保留。                                                                                                                                                                                                                                          |
| **Organization**（`force_organization_selection=true`）                               | 代码里**没有任何 organization 引用**（已 grep `lib/auth`、`app`、`components`、`proxy.ts`）。这是 Clerk Dashboard 上的设置，只会给新用户加一步无关的「建组织」 | **不需要替代**。Lumo 的租户是自己的 `Workspace` 和 `WorkspaceMember`。切换后这一步自然消失，是净改进。                                                                                                                                                                                                                                                                                                        |
| **邀请流程**                                                                          | Lumo 自己的 `WorkspaceInvite`，按 IdP 已验证邮箱匹配（`invite.service`、`getVerifiedEmails`）                                                                  | 不变。BA 下只有主邮箱，是否已验证取 `emailVerified`（多邮箱的情况见 §1.4）。                                                                                                                                                                                                                                                                                                                                  |
| **邮件验证**                                                                          | Clerk 发                                                                                                                                                       | BA 的 `emailVerification.sendOnSignUp` 已接 Lumo 的邮件客户端（`lib/integrations/email/client.ts`，SaaS 默认走 Resend relay，LUM-1041）。`requireEmailVerification: false` 保持不变（未验证的邮箱匹配不到邀请，拿不到任何权限）。                                                                                                                                                                             |
| **`deletionRequestedByClerkId` 等 `*ByClerkId` 列**                                   | 存 user id                                                                                                                                                     | id 不变，**不用改**。改名属于 §10 的可选清理。                                                                                                                                                                                                                                                                                                                                                                |
| **登录防护**（Clerk 的 bot 检测、暴力破解锁定）                                       | 托管提供                                                                                                                                                       | BA 默认在生产开启限流，但存储是进程内存（1.7.7 的 `create-context.mjs`），在 Vercel 多实例上基本无效。T1 改为 `rateLimit.storage: 'database'`（additive 迁移：`rateLimit` 表，字段 `key` 唯一、`count`、`lastRequest`），MCP 注册限流也依赖它。要不要加 captcha 插件，等观察一段时间再定。                                                                                                                    |
| **用户资料与头像**                                                                    | `lib/auth/users.ts` 的 UserDirectory 走 Clerk API                                                                                                              | BA 实现已经有了（读写 `auth_users`，头像存 Blob）。                                                                                                                                                                                                                                                                                                                                                           |

## 6. 切换方案

### 6.1 演练（preview，生产切换前必须做）

- **不用生产数据副本**：Neon 分支会带上全部个人信息，脱敏后又无法验证密码哈希。演练改用**Clerk 开发实例 + 测试账号**：
  - 在 Clerk dev 实例造约 10 个账号，覆盖：仅密码、仅 GitHub、仅 Google、密码加社交、主邮箱未验证、多邮箱、已封禁。
  - 让这些账号在一个 Neon 分支库里加入 workspace，并产生任务、评论 mention、审计、MCP 连接。
  - 然后用 T3 的脚本「导出 → 导入」到这个分支库，起一个 `AUTH_PROVIDER=better-auth` 的 preview 部署，逐项验证：每类账号都能登录，并看到原来的 workspace、任务、mention 和审计归属；CLI 的旧 `lum_` key 能用；MCP 能重新授权；封禁脚本能触发 deprovision；Instant Rollback 演练一次。
- **preview 的特殊点**：preview 的 URL 每次不同，`BETTER_AUTH_URL` 要指向固定的 preview 别名（例如分支域名），OAuth app 也要为这个别名再登记一个回调（GitHub 最多 10 个）。

### 6.2 生产环境变量（Vercel → Production，由用户设置）

| 变量                                                             | 值                                     | 说明                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_PROVIDER`                                                  | `better-auth`                          | **构建期和运行期都要**（静态页会把构建时的值烘焙进去，`lib/auth/provider.ts` 注释）。在 Vercel 上，设置后必须**重新构建**才生效                |
| `BETTER_AUTH_SECRET`                                             | `openssl rand -hex 32` 生成，≥ 32 字符 | 签 cookie，并加密 `auth_jwks` 私钥。**设定后不能随意更换**：换了所有人掉线、MCP token 失效                                                     |
| `BETTER_AUTH_URL`                                                | `https://www.uselumo.ai`               | issuer、MCP 资源和 origin 校验都由它派生。已裁定（Q4）；apex 域名需继续跳转到 www，T7 冒烟时核对                                               |
| `AUTH_GITHUB_CLIENT_ID/SECRET`、`AUTH_GOOGLE_CLIENT_ID/SECRET`   | 沿用 Clerk 正在用的那对 OAuth app      | §3                                                                                                                                             |
| `AUTH_DISABLE_SIGNUP`                                            | 不设                                   | SaaS 开放注册                                                                                                                                  |
| `AUTH_DISABLE_PASSWORD`                                          | `true`                                 | LUM-1082：对齐 Clerk 生产（邮箱验证码 + Google，无密码框）；邮箱验证码走 `RESEND_API_KEY`。登录 client 不得与 Drive 的 `GOOGLE_CLIENT_ID` 相同 |
| `CLERK_*`、`NEXT_PUBLIC_CLERK_*`、`CLERK_WEBHOOK_SIGNING_SECRET` | **保留**                               | 回滚要用，§10 清理时再删                                                                                                                       |

### 6.3 生产切换步骤（窗口约 60 分钟，选低峰）

前置条件：T1–T5 已合并并部署（它们在 Clerk 模式下不改行为）；演练通过；对外通知已提前 48 小时发出。

1. **T-1 天（用户）**：Clerk 全量导出（CSV 加 API），本机加密落地；对生产库跑导入的 dry-run，然后正式导入。Clerk 模式不读 `auth_*` 表，所以提前导入没有副作用。
2. **T0（用户）**：
   1. 再导出一次，跑增量导入（按 id 幂等 upsert，覆盖这一天里注册的用户和改过的密码）。记下这次导入的时间戳 `T_import`。
   2. 可选：如果 Clerk Dashboard 能把注册模式改为受限（以 Dashboard 实际提供的选项为准），在这里打开，缩小下面所说的缺口。
   3. 在 Vercel 设好 §6.2 的变量，**关闭生产域名自动分配**，然后从 `main` 触发一次生产构建，得到 staged deployment。
   4. 记下当前（Clerk）部署的 id，回滚时用。
3. **验证 staged 部署（用户 + agent）**：在 deployment URL 上检查 `/.well-known/oauth-authorization-server` 的 issuer、`/api/auth/lumo/config`（社交按钮）。完整登录要等 promote 之后，因为 origin 必须等于 `BETTER_AUTH_URL`。
4. **Promote（用户，即「切换按钮」）**：Vercel → Deployments → Promote（<https://vercel.com/docs/deployments/promoting-a-deployment>）。
5. **收尾增量（用户，promote 后立刻做）**：从 T0 增量导出到 promote 之间，Clerk 仍在服务，这段时间（几十分钟）里新注册的人和改过密码的人不在 BA 里。promote 之后应用不再把任何人带到 Clerk，所以这时 Clerk 的数据实际上已冻结。再导出一次，用 T3 的 `--closing` 模式导入：
   - 只**插入** `auth_users` 里还没有的用户及其账号；
   - 只有当 BA 一侧的 `auth_accounts.updatedAt <= T_import`（说明切换后用户没在 BA 改过密码）时，才覆盖 credential 的 password；
   - 其他字段一律不覆盖。

   在这一步完成前，缺口里改过密码的人可以用「忘记密码」自救；缺口里新注册的人会暂时无法登录。如果其中有人在收尾前又在 BA 用同一邮箱注册，邮箱唯一约束会让收尾导入跳过他并报告；这类人保留 BA 账号，他在缺口期间加入的成员资格用 T3 的 rekey 脚本改挂到新 id 上。人数预计是个位数。

6. **冒烟（15 分钟）**：密码账号、GitHub 账号、Google 账号各登录一次；进入已有 workspace；CLI `lumo auth login` 用已有 key；MCP Inspector 授权一次并调用一个工具；新注册一个账号并收到验证邮件。
7. **恢复**生产域名自动分配。Clerk 的 webhook 端点保持不动：Clerk 侧不会再有事件；即使回滚，Clerk 的事件也能照常处理。

### 6.4 对外通知文案（草稿，发给所有 workspace 的 owner 和成员）

> **标题**：Lumo 登录系统升级（{日期} {时间} UTC，约 1 小时）
>
> 我们将把登录服务从第三方提供商迁移到 Lumo 自己的认证系统。升级后：
>
> - 你需要**重新登录一次**；邮箱、密码、Google/GitHub 登录方式都不变。
> - 新用户注册不再需要创建「Organization」。
> - **Lumo CLI 无需任何操作**，现有 API key 继续有效。
> - 已连接的 **MCP 客户端**（Claude、Cursor 等）需要**重新授权一次**，并重新选择 workspace。
> - 如果无法用密码登录，请使用登录页的「忘记密码」。
>
> 升级期间可能有几分钟无法登录。如有问题请联系 {支持邮箱}。

i18n：这是邮件或站内公告，不是产品 UI 字符串。如果要做成站内横幅，按 CLAUDE.md 要求补齐全部 16 个 locale。

## 7. 回滚

- **方式**：Vercel **Instant Rollback** 到切换前的 Clerk 部署。它复用那次构建和当时的环境变量（文档原话是「There are no change in Environment Variables」），秒级生效（<https://vercel.com/docs/instant-rollback>）。之后再把 Vercel 里的 `AUTH_PROVIDER` 删掉，避免下一次推送重新切回 BA。注意：回滚后生产域名的自动分配会被关闭，要用 Undo Rollback 或 promote 恢复。
- **前提**：Clerk 实例、DNS、OAuth app 的旧回调、`CLERK_*` 变量在回滚期（建议 14 天）内一律不动。T1–T5 的迁移都是 additive，旧代码不读新列，不会冲突。
- **窗口期内产生的数据怎么对齐**：
  - **在 BA 新注册的用户**：Clerk 里没有这个人，而且 Clerk **不能指定 id**，所以回滚后他们无法登录，成员资格也挂在 BA id 上。处理办法：
    - 用户量小（预计个位数）：回滚后由用户在 Clerk 里为这些人建账号，再用一次性脚本把 §1.2 列出的所有列和 mention 中的 BA id 改写成新的 Clerk id（T3 附带，dry-run 加 `--confirm`）。
    - 也可以接受让他们重新注册、重新被邀请：数据少，但他们创建的内容归属会断。
    - 建议：**回滚期内每天跑一次统计**，看「BA 新用户数」，作为是否继续等待的依据。
  - **在 BA 改了密码的用户**：回滚后 Clerk 里还是旧密码，可以用旧密码登录或在 Clerk 重置。BA 的 scrypt 哈希 Clerk 不支持导入（Clerk 支持的 hasher 列表里没有 BA 的格式），**不同步**，在通知里说明。
  - **改了姓名或头像的**：回滚后显示的是 Clerk 里的旧值，可以接受，不同步。
  - **MCP**：回滚后 BA 签发的 token 失效，用户要再授权一次 Clerk（前提是 Clerk 开了 DCR）。
- **触发条件**（满足任意一条，并且 30 分钟内修不好）：
  - 密码用户登录成功率明显下降：冒烟失败，或切换后 1 小时内有 ≥ 3 位用户报告无法登录，且根因不是个人问题。
  - 社交登录有任一提供方整体失败。
  - 出现越权：用户看到别人的 workspace，或 id 映射错误。**这一条一旦发现立即回滚，不等 30 分钟。**
  - `/api/auth/*` 的 5xx 持续升高。
- **超过 14 天**：数据分叉太大，回滚成本高于修复成本，不再回滚，只向前修复。

## 8. 数据与合规

- **导出文件的落地规则**（写进 T3 的 runbook，由用户执行）：
  - 只放在仓库之外的目录，例如 `~/lumo-auth-migration/`，权限 `700`。这个目录不在任何 git 工作区里；脚本启动时检查：路径位于 git 仓库内就拒绝运行。
  - 落盘即加密：用 `age`（或 macOS 加密 APFS 磁盘映像）。导入脚本读密文，在内存里解密，不写明文临时文件。
  - **不进 git，不贴进任务、PR、评论、聊天**。dry-run 和导入报告只输出计数。
  - 导出时使用的生产凭据只从用户 shell 的环境变量读取，脚本从不打印。
  - **销毁**：回滚期结束（§7，14 天）后删除密文和密钥，在 LUM 任务里记录「已销毁」及日期（不含内容）。
- **法律文本与站内文案**（T6，在切换生效后合并）：
  - `lib/legal/subprocessors.ts` 删掉 `clerk` 一项，在 `lib/legal/subprocessor-changes.ts` 记一条 `removed`，`effectiveAt` 设为 Clerk 停止处理数据的日期。文件头规则写明「A removal needs no notice」，所以**不需要提前 30 天通知**；drift 测试会校验。
  - 同步修改 live doc `docs/live-docs/legal-subprocessors.md`（主表那一行和 Change history），按 `docs/live-docs/README.md` 的流程，以 `--raw` 为编辑基底。
  - `docs/live-docs/legal-privacy-policy.md` 第 92 行（「Sign-in is handled by Clerk」）、`docs/live-docs/legal-dpa-template.md` 第 136 行（「User authentication through Clerk」）改成「Lumo 自己的认证服务，数据存在我们的数据库（Neon）里」。
  - i18n 的 `security.auth.signin`、`security.subprocessors.purpose.clerk`：改第一个，删第二个，**16 个 locale 全部更新**（CLAUDE.md i18n 规则）。
  - 时机：Clerk 实例在回滚期内仍然保存着用户数据，**是真实的子处理者**。所以 `effectiveAt` 应该是 Clerk 实例删除那天（§10），不是切换那天。隐私政策和 DPA 可以在切换当天更新「认证由谁提供」，子处理者清单要等实例删除后再删 Clerk。
- **Clerk 侧的数据删除**：回滚期结束后，由用户在 Clerk Dashboard 删除生产实例（Clerk 删除时会一并删掉用户数据），并删除 `clerk.`、`accounts.` 及 Clerk 邮件相关的 DNS 记录。

## 9. 工作量与任务拆分

每一项都能独立合并。T1–T5 在 Clerk 模式下**不改变生产行为**，可以先合并、先部署。

| #   | 任务                                                                                                                                                                                                                                                                                                                                                                             | Schema（additive，由部署网关自动应用）        | 估算                      | 依赖                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------- | ------------------------------------- |
| T1  | **BA 生产加固**：忘记、重置、修改密码（`sendResetPassword` 加页面和邮件模板，16 个 locale）；兼容 bcrypt 的 `password.verify`（`bcryptjs`，先 `npm audit`）；`rateLimit.storage='database'`（Q10，先不加 captcha）；`generateId` 给 user 加 `user_` 前缀；显式写出 `accountLinking`（不加 trusted providers）及错误文案。建议拆成 T1a（密码相关）和 T1b（限流、id、关联）两个 PR | `rateLimit` 表                                | 2.5–3 人日                | —                                     |
| T2  | **运维与注销对等**：admin 插件（关闭 impersonate）；`scripts/auth-admin/{ban,unban,remove}.ts`，在同一个 service 里调用 deprovision；新增 `AUTH_USER_*` 停用原因（字符串常量）；测试                                                                                                                                                                                             | `auth_users` 加 4 列，`auth_sessions` 加 1 列 | 1.5 人日                  | —                                     |
| T3  | **导入工具**：`scripts/auth-migration/` 下的 export、import、`--closing` 收尾增量、verify 对账、rekey（Q8，回滚用）、`avatars` 头像转存（Q6）；runbook                                                                                                                                                                                                                           | 无                                            | 3–3.5 人日                | T2（封禁字段）                        |
| T4  | **MCP 生产策略**：协助实测 Clerk DCR 临时方案（Q3）；BA 下的自定义 scheme allowlist（Q7）；`McpConnection` 重选 workspace 的体验；文档                                                                                                                                                                                                                                           | 无                                            | 1 人日                    | —（与 T1–T3 并行）                    |
| T5  | **preview 演练**：Clerk dev 测试账号矩阵、Neon 分支、preview 别名和 OAuth 回调、按 §6.1 逐项留证（含 allowlist scheme 的 MCP 客户端）、Instant Rollback 演练和 rekey 演练                                                                                                                                                                                                        | 无                                            | 1 人日（含用户约 1 小时） | T1–T4                                 |
| T6  | **合规与文案**：两份 live doc、i18n、子处理者记录（§8，分两次合并：切换当天、实例删除那天）                                                                                                                                                                                                                                                                                      | 无                                            | 0.5 人日                  | T7                                    |
| T7  | **切换与稳定期**：通知、窗口、冒烟、14 天回滚期内每日统计 BA 新用户数                                                                                                                                                                                                                                                                                                            | 无                                            | 0.5 人日 + 窗口           | T1–T5                                 |
| T8  | **Clerk 清理**（§10，Q9）                                                                                                                                                                                                                                                                                                                                                        | 无（列名不改）                                | 1–1.5 人日                | T7 稳定 30 天，且 T3 的头像转存已完成 |

**合计约 11–12.5 人日**，即上表逐项之和：下限 2.5+1.5+3+1+1+0.5+0.5+1=11，上限 3+1.5+3.5+1+1+0.5+0.5+1.5=12.5。

**关键路径**：（T1 ∥ T2）→ T3 → T5 → T7。T3 依赖 T2 的封禁字段，所以 T2 也在关键路径上；T1 和 T2 可以并行，T4 与 T1–T3 并行。按 max(T1, T2) 3 + T3 3.5 + T5 1 + T7 0.5 计算，约 8 个工作日，日历上约 1.5–2 周。T6 和 T8 在切换之后。

**必须由用户执行的步骤**：

1. ~~裁定 §11 的问题~~（已完成，见 §12）；在 Clerk Dashboard 查 Q5 的数据。
2. 在 Clerk Dashboard 打开 DCR（Q3），用 MCP Inspector 实测，失败就关掉。
3. 在 Clerk Dashboard 查看：用户总数、有 MFA 的用户数、sign-in 方式（是否有纯手机号或用户名用户）、生产 SSO 用的是哪对 OAuth app。
4. 给 GitHub 和 Google 的 OAuth app **追加**回调 URL（生产一个，preview 别名一个）。
5. 演练时在 Clerk dev 实例造测试账号。
6. T-1 天和 T0：导出 CSV（Dashboard）和 API 数据（本机脚本），加密落地，对生产库跑导入的 dry-run、正式导入和增量导入。
7. 设置 Vercel 生产环境变量，关闭域名自动分配，构建 staged 部署，**Promote**；需要时 **Instant Rollback**。
8. 发对外通知。
9. 回滚期结束：销毁导出文件；删除 Clerk 实例和 DNS；删除 `CLERK_*` 变量和 OAuth app 的旧回调。

## 10. 代码清理

**建议：稳定 30 天后删除 Clerk 实现，保留 `lib/auth` 抽象层。**

- **为什么删**：
  - 自托管默认就是 BA（LUM-1043），SaaS 切换后再没有部署使用 Clerk。留着会让 CI 和测试矩阵翻倍（`__tests__` 里大量 `jest.mock('@clerk/nextjs/server')`），还要继续升级 `@clerk/nextjs`、`@clerk/mcp-tools` 及其安全公告。
  - LUM-1027 当初「SaaS 留 Clerk」的前提已经被这次裁定推翻。
- **删什么**：
  - 代码：`lib/auth/clerk/**`、`lib/auth/clerk-webhook.ts`、`app/api/webhooks/clerk/`、`deprovisionTriggerFromClerkEvent`、`lib/utils/clerk-helpers`、`provider.ts` 里的 `clerk` 分支（`AUTH_PROVIDER` 改为可选，默认 `better-auth`）。
  - 依赖：两个 `@clerk/*`。
  - 配置：`.env.example` 和 Dockerfile 里的 Clerk 变量、`eslint.config.mjs` 和 `jest.config.js` 中的 Clerk 条目、`.agents/skills/clerk-*`（如果不再需要）。
- **不删什么**：`lib/auth` 接口（换实现的成本已经证明很低）；`clerkId` 这类**列名**；`CLERK_USER_*` 停用原因值（历史行仍在用）。
- **列改名（可选，不建议现在做）**：可以只改 Prisma 字段名、用 `@map` 保持 DB 列名不变（例如 `clerkId` → `userId @map("clerkId")`），没有迁移风险，但会改动几百处调用点。收益是可读性，建议在 T8 之后单独评估。`PriorityOverride.memberId` 的误导性命名可以一起修。
- **备选**：保留 Clerk 实现，让自托管可选。不推荐：自托管用户没有动机选 Clerk，等于只为假想用户付维护成本。

## 11. 需要用户裁定的问题（原始提问，结论见 §12）

| #   | 问题                                                                                                                              | 建议                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Q1  | 是否按本 RFC 做（保留 id、导入 bcrypt、staged 部署 + Instant Rollback、14 天回滚期）                                              | 做                                                 |
| Q2  | 批准新增 npm 依赖 `bcryptjs`（MIT，纯 JS）用于校验 Clerk 导出的哈希                                                               | 批准；不批准就走「忘记密码」退路（§2 方案 A）      |
| Q3  | 托管 MCP 在切换前是否打开 Clerk DCR                                                                                               | 切换日期在 2 周以后就开，并实测；1 周内能切就不开  |
| Q4  | 生产 OAuth app 是否沿用 Clerk 正在用的那对（只追加回调）；`BETTER_AUTH_URL` 是 `https://www.uselumo.ai`、apex 跳转到 www 是否确认 | 沿用；确认 www                                     |
| Q5  | Clerk 生产有没有 MFA 用户、纯手机号或用户名用户（由用户在 Dashboard 查）；有的话是否接受「切换后先用密码登录、2FA 后补」          | 先查数                                             |
| Q6  | Clerk 头像是否转存到 Blob（不转存的话，Clerk 实例删除后头像可能失效）                                                             | 转存，放在 T8 前做                                 |
| Q7  | MCP 是否允许自定义 scheme 的 redirect URI（例如 `cursor://`）                                                                     | 先不放开，观察 Cursor 的需求；需要时单独做安全评审 |
| Q8  | 回滚期长度（建议 14 天），以及回滚时 BA 新用户的处理方式（rekey 脚本还是让他们重新注册）                                          | 14 天；用户少就用 rekey                            |
| Q9  | 稳定 30 天后删除 Clerk 实现（§10）                                                                                                | 删                                                 |
| Q10 | 是否加 captcha 或更严的登录限流（替代 Clerk 的 bot 防护）                                                                         | 先只用数据库限流，观察 2 周                        |

---

## 12. 裁定（2026-10-10，记在 LUM-1069 Decisions）

| #   | 结论                                                                                                                                                     | 影响的章节与任务                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Q1  | 按本 RFC 推进                                                                                                                                            | 全文                                   |
| Q2  | 批准新增 `bcryptjs`，引入前跑 `npm audit`                                                                                                                | §2；T1                                 |
| Q3  | 切换前打开 Clerk DCR 作临时方案；实测 `registration_endpoint` 出现且 MCP Inspector 能连通就保留，失败就关                                                | §4.3；T4（agent 协助实测）与用户步骤 2 |
| Q4  | 沿用 Clerk 生产现有的 GitHub/Google OAuth app（只追加回调）；`BETTER_AUTH_URL=https://www.uselumo.ai`                                                    | §3、§6.2；T5、T7                       |
| Q5  | **待定**：MFA、纯手机号、用户名注册的用户数，由用户在 Clerk Dashboard 查后告知。非 0 时按 §2 的「先用密码登录、2FA 后补」处理，并在 T3 的 dry-run 里核对 | §2、§1.4；T3、T7                       |
| Q6  | 头像转存到自有存储                                                                                                                                       | §1.4；T3 `avatars`；T8 依赖它          |
| Q7  | 允许 MCP 自定义 scheme 回调，限 allowlist（`cursor`、`vscode` 等），授权确认页照常                                                                       | §4.3；T4、T5                           |
| Q8  | 回滚期 14 天；回滚时窗口期新用户走 rekey                                                                                                                 | §7；T3 `rekey`；T5 演练                |
| Q9  | 稳定 30 天后删除 Clerk 实现，保留 `lib/auth` 抽象                                                                                                        | §10；T8                                |
| Q10 | 先上数据库限流，captcha 视滥用情况再加                                                                                                                   | §5；T1                                 |

## 附录 A：身份列清单的复现命令

在仓库根目录、`origin/main` @ 9db0c7993 上运行。

**1）从 schema 推导**（字段名含 clerk，或 `///` 注释写明 Clerk (user) id），输出 11 行：

```sh
awk '
/^model /{m=$2; doc=""; next}
/^}/{m=""; next}
!m{next}
/^[[:space:]]*\/\/\//{doc=doc" "$0; next}
/^[[:space:]]*($|\/\/)/{next}
$1 ~ /^@@/{doc=""; next}
{ if (tolower($1) ~ /clerk/ || doc ~ /Clerk (user )?id/) print m"."$1"\t"$2; doc="" }
' prisma/schema.prisma | sort
```

**2）代码交叉核对**：把认证得到的 user id 写进**名字看不出来**的键。输出要人工判读，`*ClerkId` 形式的 service 参数不是列；本次判读出 `PriorityOverride.memberId`：

```sh
grep -rnE "^\s*[A-Za-z]+:\s*[A-Za-z.?]*(clerkId|clerkUserId|userId)\b,?\s*$" lib app \
  --include='*.ts' --include='*.tsx' | grep -v __tests__ \
  | grep -vE "\s(clerkId|clerkUserId|userId|actorId|deletedByClerkId|requestedByClerkId|lastDownloadedByClerkId|deletionRequestedByClerkId|id|user):"
```

富文本中的 mention：`grep -n "data-id" lib/editor/parse-mentions.ts`。

**3）名字像用户、实际存别的 id 的候选列**（46 行，逐个核对后都是 `WorkspaceMember.id`、`Actor.id`、第三方账号 id 或 `Auth*` 内部外键）：

```sh
awk '/^model /{m=$2} /^}/{m=""} m && $1 !~ /^@@/ && $1 ~ /([Uu]ser|[Aa]ctor|[Aa]uthor|By|[Oo]wner|[Rr]eviewer|[Ii]nviter|[Rr]equester|[Cc]reator)(Id|ClerkId)?$/ && $2 ~ /^String/ {print m"."$1}' prisma/schema.prisma | sort
```

核对依据（写入点）：`installedBy` ← `memberId`（`app/api/slack/callback/route.ts`、`sentry.service`、`github-app-install.service`）；`PrSecurityFinding.dispositionedById` ← `actorMemberId`；`DocumentRevision.authorId` ← `memberId`；`Project.ownerId` ← `Actor.id`（`project.service`）；`*Link.createdById` ← `actorMemberId`；`AuditEvent.actorId` 已由第 1 条命令收录。

## 附录 B：不含个人信息的用户计数（由用户对生产库只读执行）

```sh
# DATABASE_URL 由用户在自己的 shell 中提供；只输出一个数字
npx tsx -e "import { prisma } from './lib/db/prisma'; prisma.workspaceMember.groupBy({ by: ['clerkId'] }).then(r => { process.stdout.write(String(r.length) + '\n'); return prisma.\$disconnect() })"
```

Clerk 侧的总数：Dashboard 首页，或 `GET /v1/users/count`。

## 附录 C：引用

- Clerk：[迁移概览与导出](https://clerk.com/docs/guides/development/migrating/overview) · [getUserList](https://clerk.com/docs/reference/backend/user/get-user-list) · [User 类型](https://clerk.com/docs/reference/backend/types/backend-user) · [EmailAddress 类型](https://clerk.com/docs/reference/backend/types/backend-email-address) · [getCount](https://clerk.com/docs/reference/backend/user/get-count) · [限流](https://clerk.com/docs/guides/how-clerk-works/system-limits) · [OAuth 与 DCR/CIMD](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) · [MCP 服务端](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server)
- Better Auth：[Clerk 迁移指南](https://better-auth.com/docs/guides/clerk-migration-guide) · [邮箱密码](https://better-auth.com/docs/authentication/email-password) · [用户与账号关联](https://better-auth.com/docs/concepts/users-accounts) · [数据库与 hooks](https://better-auth.com/docs/concepts/database) · [admin 插件](https://better-auth.com/docs/plugins/admin) · [magic link](https://better-auth.com/docs/plugins/magic-link) · [邮件](https://better-auth.com/docs/concepts/email) · [会话](https://better-auth.com/docs/concepts/session-management) · [MCP 插件](https://better-auth.com/docs/plugins/mcp) · [oauth-provider](https://better-auth.com/docs/plugins/oauth-provider) · [1.7 升级指南](https://better-auth.com/docs/guides/1-7-upgrade-guide)
- GitHub / Google：[创建 OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) · [授权与回调匹配](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) · [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- Vercel：[Instant Rollback](https://vercel.com/docs/instant-rollback) · [Promote / staged production](https://vercel.com/docs/deployments/promoting-a-deployment)
- 本地核实（1.7.7 类型与源码）：`node_modules/@better-auth/core/dist/types/init-options.d.mts`（`password.verify`、`accountLinking`、`generateId`、`rateLimit.storage`）、`node_modules/better-auth/dist/oauth2/link-account.mjs`（先按账号键、再按邮箱）、`node_modules/better-auth/dist/context/create-context.mjs`（限流默认值）、`node_modules/better-auth/dist/plugins/admin/schema.mjs`（admin 字段）
