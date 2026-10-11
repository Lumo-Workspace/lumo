# Runbook：Clerk → Better Auth 用户迁移（LUM-1072 / RFC LUM-1069 T3）

> **私有文档**：位于 `docs/rfc/`，被 `oss/manifest.json` 的 `docs/rfc/**` 排除，不进开源快照。
> 本文所有步骤都**由用户在自己的机器上执行**。agent 不持有、也不应接触生产凭证、Clerk 导出数据或生产数据库。
> 依据：RFC `docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth.md` §1.3–§1.4、§6.3、§7、§8。

## 0. 工具一览

全部在仓库根目录用 `npx tsx scripts/auth-migration/<命令>.ts` 运行（逻辑在 `lib/services/auth-migration.service.ts` 与 `lib/auth-migration/`）。

| 命令      | 作用                                                                                                                     | 写什么                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `seal`    | 把明文文件（Dashboard 导出的 CSV、rekey 映射）加密成 sealed 文件                                                         | 新 sealed 文件               |
| `unseal`  | 把 sealed 文件解密到你指定的明文文件（不打印）                                                                           | 新明文文件（600）            |
| `export`  | 只读调用 Clerk Backend API（`/v1/users/count`、`/v1/users` 游标分页，429 自动退避），与 sealed CSV 合并                  | sealed 导出包                |
| `import`  | 导入 `auth_users` / `auth_accounts`；默认 dry-run，`--confirm` 才写；`--closing --since` 为收尾增量                      | 数据库（仅 `--confirm`）     |
| `verify`  | 对账：Clerk 总数 = 导入 + 跳过；附录 A 的 11 列 + `PriorityOverride.memberId` + 富文本 mention 中的 id 都在 `auth_users` | 不写                         |
| `avatars` | 把仍指向 Clerk 的头像转存到自有 Blob，改写 `auth_users.image`；默认 dry-run                                              | Blob + 数据库（`--confirm`） |
| `rekey`   | 回滚用：把窗口期 BA 新用户 id 改写为新 Clerk id（所有身份列 + mention）；默认 dry-run                                    | 数据库（仅 `--confirm`）     |

**输出只有计数、列名和 id 前缀统计**（如 `user_=3`），不含邮箱、姓名、哈希、完整 id 或凭据。需要逐个处理的 id（跳过/失败）用 `import --details-out` 写进 sealed 文件，需要时用 `unseal` 在本机查看。

### 与 RFC 的出入

- **加密**：RFC §8 写 `age`。本机未装 `age`，且不为此加 npm 依赖，改用 Node 内置 `crypto`：AES-256-GCM，密钥由 scrypt（N=2^15, r=8）从环境变量 `LUMO_MIGRATION_PASSPHRASE`（≥ 20 字符）派生；文件头 `LUMOSEAL`。效果等同「落盘即加密、密钥只在 shell 环境」；明文只在内存里存在。若更想用 `age`，可以先 `age -d` 再 `seal`，但那样会短暂落地明文，**不推荐**。
- **CSV 只取 `id`、`password_digest`、`password_hasher`、`totp_secret` 是否为空**。邮箱、验证状态、社交账号、封禁、头像全部来自 Backend API（RFC §1.3 第 2 路），所以 CSV 多值列的分隔符不影响结果。
- **Clerk 密钥变量名是 `CLERK_MIGRATION_SECRET_KEY`**，故意不用应用的 `CLERK_SECRET_KEY`，避免误拿 `.env` 里的 dev key；脚本不加载 dotenv。
- **分页**：用 `starting_after` 游标 + `order_by=+created_at`（Clerk OpenAPI 推荐游标、升序时导出期间的新注册只会追加到最后一页）。
- **verify 的「找得到」**：Clerk 里早已删除的人，其 id 仍留在历史行（停用的成员资格、审计）。这类 id 计为「缺失但无活跃成员资格」（警告）；只有**仍有活跃成员资格**的缺失 id 才判失败。
- **封禁用户**：导入只设 `banned=true`（T2 字段），不再跑 deprovision（成员资格此前已由 Clerk webhook 停用）。若担心 webhook 漏发，导入后对这些人跑一次 `scripts/auth-admin/ban.ts --user-id … --confirm`（幂等）。

## 1. 准备（一次性）

```sh
mkdir -p ~/lumo-auth-migration && chmod 700 ~/lumo-auth-migration
# 一个强口令，只放在当前 shell 会话里；记到密码管理器，回滚期结束后销毁
read -rs LUMO_MIGRATION_PASSPHRASE && export LUMO_MIGRATION_PASSPHRASE   # 输入 ≥20 字符的随机口令；不回显、不进 shell 历史
```

- 所有导出文件只放在 `~/lumo-auth-migration/`（不在任何 git 工作区内；脚本发现路径在 git 仓库里会拒绝运行）。
- 不要把任何文件或命令输出之外的内容贴进任务、PR、评论、聊天。命令输出本身只含计数，可以贴。
- 指向目标数据库：`export DATABASE_URL='<Neon 连接串>'`（生产库：`sslmode=require`；本地无 SSL 的库要加 `?sslmode=disable`）。每条命令第一行会打印 `database: <host>/<db>`，**执行前核对**。

## 2. 导出（T-1 天、T0、promote 之后各一次）

1. Clerk Dashboard → 生产实例 → Settings → **User exports** → Export users → 在导出历史里 Download CSV，存到 `~/lumo-auth-migration/`。
2. 加密 CSV，然后安全删除明文：

   ```sh
   cd <lumo 仓库>
   npx tsx scripts/auth-migration/seal.ts --in ~/lumo-auth-migration/users.csv --out ~/lumo-auth-migration/users-<日期>.csv.enc
   rm -P ~/lumo-auth-migration/users.csv
   ```

3. 拉 API 数据并合并成导出包（只读 GET）：

   ```sh
   read -rs CLERK_MIGRATION_SECRET_KEY && export CLERK_MIGRATION_SECRET_KEY   # 粘贴 sk_live_ 密钥；不回显、不进 shell 历史
   npx tsx scripts/auth-migration/export.ts --csv ~/lumo-auth-migration/users-<日期>.csv.enc --out ~/lumo-auth-migration/export-<日期>.enc
   unset CLERK_MIGRATION_SECRET_KEY
   ```

   输出 `Clerk instance: live`、`Clerk count: N; fetched: N`。两数不等会给出 WARNING（导出期间有人注册），`verify` 也会标出；必要时重导。

## 3. 导入

### 3.1 T-1 天：dry-run → 正式导入

```sh
npx tsx scripts/auth-migration/import.ts --in ~/lumo-auth-migration/export-<日期>.enc
```

逐项核对 dry-run 计数（RFC §1.4）：

- `skipped: no_email=…`：应为 0（Q5，生产只开了邮箱 + 社交）。不为 0 → 用 `--details-out` 拿 id 逐个处理。
- `email_case_conflict`：两个 Clerk 用户邮箱只差大小写，都不导入，人工处理。
- `password hashers`：非 `bcrypt` 的不导入密码；`password enabled but no importable bcrypt hash` 这些人切换后用「忘记密码」。
- `MFA enabled`、`username-only` 对应 Q5，按 RFC §2「先用密码登录、2FA 后补」。
- `pending invites to a non-primary email` 非 0 → 让邀请人重发到主邮箱。
- `banned` 应等于 Clerk Dashboard 里的封禁数。

确认后正式导入，并保存 skipped/failed 明细：

```sh
npx tsx scripts/auth-migration/import.ts --in ~/lumo-auth-migration/export-<日期>.enc --confirm --details-out ~/lumo-auth-migration/details-<日期>.enc
```

`failed` 非 0 时退出码为 1，重跑同一命令即可（按 id 幂等；第二次跑应全部为 `unchanged`）。

### 3.2 T0：增量导入，记下 T_import

重新导出（§2），再跑一次 `import --confirm`（同一模式，幂等 upsert）。输出最后一行：

```
T_import (pass to --closing --since): 2026-…Z
```

**记下这个时间戳**（不含个人信息，可以写进 LUM 任务）。

### 3.3 promote 之后立刻：收尾增量

再导出一次（§2），然后：

```sh
npx tsx scripts/auth-migration/import.ts --in ~/lumo-auth-migration/export-closing.enc --closing --since <T_import>            # dry-run
npx tsx scripts/auth-migration/import.ts --in ~/lumo-auth-migration/export-closing.enc --closing --since <T_import> --confirm --details-out ~/lumo-auth-migration/details-closing.enc
```

规则（RFC §6.3 第 5 步）：只插入 BA 还没有的用户；已有用户只在其 credential 账号 `updatedAt <= T_import` 时覆盖密码（输出 `credential changed in Better Auth after T_import (kept)` 是被保留的人数）；其他字段一律不覆盖。`email_taken` = 收尾前已在 BA 用同一邮箱注册的人：他们保留 BA 账号，其缺口期间加入的成员资格按 §6（rekey）改挂。

## 4. 对账

```sh
npx tsx scripts/auth-migration/verify.ts --in ~/lumo-auth-migration/export-closing.enc
```

通过时最后一行是 `OK`、退出码 0。每列显示 `distinct / missing / missing with active membership`；最后一项必须全为 0。`missing` 非 0 而 active 为 0 的，是早已在 Clerk 删除的人留下的历史 id，可接受。

## 5. 头像转存（Q6，必须在 T8 和删除 Clerk 实例之前）

需要生产 Blob 凭据（`BLOB_READ_WRITE_TOKEN`，从 Vercel 拉到你自己的 shell，不落盘到仓库）：

```sh
npx tsx scripts/auth-migration/avatars.ts            # dry-run：还剩多少
npx tsx scripts/auth-migration/avatars.ts --confirm  # 转存，路径同 BA 上传：avatars/<userId>/avatar-<随机>.<ext>
```

失败的（`http_404` 等）退出码为 1，可直接重跑；已转存的不会被后续导入改回 Clerk URL。跑到 `avatars still on Clerk hosts: 0` 为止。

## 6. 回滚时：rekey（Q8）

Instant Rollback 之后，窗口期在 BA 新注册的人在 Clerk 里不存在。

1. 列出窗口期 BA 新用户（id + 邮箱，写进 sealed 文件）：

   ```sh
   npx tsx scripts/auth-migration/rekey.ts --window-since <T_import> --window-out ~/lumo-auth-migration/window.enc
   npx tsx scripts/auth-migration/unseal.ts --in ~/lumo-auth-migration/window.enc --out ~/lumo-auth-migration/window.json
   ```

2. 在 Clerk Dashboard 为这些邮箱建账号，得到新的 `user_…` id。
3. 写映射 `{"<BA id>": "<新 Clerk id>", …}` 到 `~/lumo-auth-migration/map.json`，加密并删除明文：

   ```sh
   npx tsx scripts/auth-migration/seal.ts --in ~/lumo-auth-migration/map.json --out ~/lumo-auth-migration/map.enc
   rm -P ~/lumo-auth-migration/map.json ~/lumo-auth-migration/window.json
   ```

4. dry-run 看每列受影响行数，`rows already referencing a new id` 必须为 0（否则拒绝，防止把两个人合并）：

   ```sh
   npx tsx scripts/auth-migration/rekey.ts --map ~/lumo-auth-migration/map.enc
   npx tsx scripts/auth-migration/rekey.ts --map ~/lumo-auth-migration/map.enc --confirm
   ```

   在一个事务里改写附录 A 的 11 列、`PriorityOverride.memberId` 和富文本 mention（`Comment.body`、`Task.description`、`Document.content`、`DocumentRevision.content`、`DocumentComment.body`、`Project/Milestone.description`；含回收站里的任务和文档）。`auth_users` 里的 BA 行不改（Clerk 模式不读它）；若之后再切回 BA，重新导入会把这些人报告为 `email_taken`，届时人工处理。

## 7. 销毁（回滚期 14 天结束后）

```sh
rm -P ~/lumo-auth-migration/*.enc && rmdir ~/lumo-auth-migration
unset LUMO_MIGRATION_PASSPHRASE
```

从密码管理器删除口令，在 LUM 任务里记录「已销毁」及日期（不含内容）。
