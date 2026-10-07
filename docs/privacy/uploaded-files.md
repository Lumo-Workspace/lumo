# 上传文件:谁能打开

> LUM-916 · 2026-09-30。本文说明访问模型的事实依据,不是对外文案;对外发布前需法务审阅。

## 一句话结论

测试用例证据(截图、日志)和编辑器里上传的图片都存成**私有** Vercel Blob,只能通过 Lumo 的鉴权路由 `GET /api/files/<路径>` 打开:**只有所属工作区的成员**(浏览器登录态或 API key)能读。公开分享文档里嵌的图是唯一例外(见下文)。工作区 logo 仍然是公开 blob。

## 访问规则

| 文件        | 存放路径                                     | 谁能打开                                                             |
| ----------- | -------------------------------------------- | -------------------------------------------------------------------- |
| 测试证据    | `test-evidence/<taskId>/<caseId>/<id>`(私有) | 该任务所在工作区的成员                                               |
| 编辑器图片  | `workspaces/<workspaceId>/images/<id>`(私有) | 该工作区的成员;公开分享文档里嵌的图,另外对持有该文档分享链接的人开放 |
| 工作区 logo | `workspaces/<workspaceId>/logo-…`(**公开**)  | 任何人                                                               |

- 未登录且没带分享 token → 401;其他情况(别的工作区的成员、token 不对、文件不存在)一律 404,不暴露文件是否存在。
- **公开分享文档的例外**:`/share/<token>` 页面渲染时,会给正文里的图片链接加上 `?share=<token>`。路由只在同时满足以下条件时放行:token 对应一篇公开文档、该文档属于图片所在的工作区、文档正文确实引用了这张图。拿到 token 的人只能看到这一篇文档自己的图,看不到工作区里的其他图,也看不到任何测试证据。关闭分享(清空 `publicToken`)后,这些图随即对匿名访客失效。
- 响应头带 `X-Content-Type-Options: nosniff` 和沙箱 CSP(`default-src 'none'; … sandbox`),`Cache-Control: private`:用户上传的 SVG/文本即使在 Lumo 域名下被直接打开,也无法以 Lumo 的身份执行脚本,也不会被共享缓存留存。

### 为什么 logo 保持公开

logo 是工作区 owner 主动上传的品牌标识,不含客户代码,也不含应用数据。它和证据截图的风险完全不同:证据截图可能拍到客户数据,链接一旦外传就无法撤回;logo 被别人看到并没有损失。所以公开访问的代价可以接受,而且保持公开以后,将来在邀请邮件这类没有登录态的地方显示 logo 时,不需要再单独开一个口子。目前 logo 只在登录后的侧边栏和设置页里显示。logo 存在 `workspaces/<id>/` 下,删除工作区时会一并清理;换 logo 时旧文件会被删除。

## 两个 store

Vercel Blob 的访问级别是**按 store** 设置的:公开 store 会直接拒绝 `access: 'private'` 的写入(报错 "Cannot use private access on a public store")。因此:

| store                      | 环境变量                        | 存什么                                                           |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| 原有 store(Access=Public)  | `BLOB_READ_WRITE_TOKEN`         | 工作区 logo;以及迁移前的历史公开 blob                            |
| 私有 store(Access=Private) | `BLOB_PRIVATE_READ_WRITE_TOKEN` | 测试证据、编辑器图片、工作区导出包(LUM-858)、SARIF 上传(LUM-735) |

所有私有读写都显式传私有 store 的 token(`lib/blob/private-store.ts`);没配置时直接报错,不会悄悄退回到公开 store。在 LUM-916 之前,导出包和 SARIF 上传代码里写的是 `access: 'private'`,用的却是公开 store 的默认 token,所以在生产上无法工作;这次一并迁到了私有 store。

## 自托管后端(LUM-1021)

所有 blob 读写都经 `lib/blob/` 的 `BlobStorage` 接口(`getBlobStorage()`);SDK 只允许在 `lib/blob/` 里 import(`__tests__/lib/blob/blob-sdk-import-guard.test.ts` + ESLint)。后端按环境变量选:`BLOB_STORAGE` 显式指定 > 有 Vercel Blob token → `vercel` > `S3_BUCKET` → `s3` > `LOCAL_BLOB_DIR` → `disk`。三种后端都把公开/私有放在**分开的命名空间**,私有读永远解析不到公开对象,反之亦然:

| 对象                       | Vercel(SaaS)           | S3 / MinIO                                  | 本地磁盘                         | 谁能读                                                 |
| -------------------------- | ---------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| 测试证据、编辑器图片(私有) | 私有 store             | `private/<路径>`,bucket 不设公开策略        | `<dir>/private/<路径>`,文件 0600 | `GET /api/files/…`:所属工作区成员;公开分享文档内嵌的图 |
| 工作区导出包(私有)         | 私有 store             | `private/…`                                 | `<dir>/private/…`                | 导出下载路由:仅 OWNER                                  |
| SARIF 上传(私有)           | 私有 store(客户端直传) | 不支持直传(上传路由回 501)                  | 同左                             | 仅服务端 ingest                                        |
| 工作区 logo(公开)          | 公开 store 的 CDN URL  | `public/…`,经 `GET /api/blob/public/…` 提供 | `<dir>/public/…`,同左            | 任何人(该路由只读公开命名空间、只认 logo 形状的路径)   |

**后端歧义告警**:同时配了多种后端(例如残留的 `BLOB_READ_WRITE_TOKEN` 加上 `S3_BUCKET`)且没设 `BLOB_STORAGE` 时,仍按上面的优先级选(SaaS 只配 Vercel token,行为不变),但服务端会打一条 warn 日志,写明选中了哪个后端、以及用 `BLOB_STORAGE=…` 覆盖。自托管请显式设 `BLOB_STORAGE`。

**S3 不覆盖语义**:默认(未传 `allowOverwrite`)的写入绝不替换已有对象。很多 S3 兼容服务(旧版 MinIO、部分网关)会**忽略** PutObject 的 `If-None-Match: *` 直接覆盖,另一些会**拒绝**该头(501 NotImplemented,或错误信息点名 If-None-Match / conditional 的 400;其他 400 照常抛出,不回退)。因此 S3 后端先用 HeadObject 查存在(存在 → 409),再在服务端支持时带条件头写(堵住竞态;412 与并发条件写冲突 409 ConditionalRequestConflict 都映射为 409);服务端拒绝条件头时去掉它重试,之后的写入不再尝试。在忽略条件头的服务上仍有一个小竞态:两个并发写同一个**新**路径的请求可能都通过检查、后写者胜出——Lumo 的不覆盖写入都用随机或内容唯一的路径,这里只是兜底。HeadObject 对不存在的键须返回 404:AWS 上需要 `s3:ListBucket` 权限(`get()` 本来就依赖它),否则 403 会直接抛出而不会盲写。

**切换后端不迁移数据**:把已有部署从 Vercel Blob 换到 S3 / 磁盘时,数据库里已存的 Vercel Blob URL **不会**随之迁移。私有文件(测试证据、编辑器图片、导出包)的 Vercel URL 会被新后端拒绝(`not a blob reference of this backend`,鉴权路由读不出);工作区 logo 存的是 Vercel CDN 地址,只在旧 Vercel store 仍存在时还能显示,且删除/按前缀清理都碰不到它们。切换前须自行把对象搬到新后端并改写库里的引用(本仓库未提供迁移脚本)。

S3 额外提供 `signedReadUrl()`(预签名 GET,默认 300 秒、上限 7 天);Vercel 与磁盘不提供(回 501),私有文件一律由鉴权路由在服务端读出再流给调用方。`LOCAL_BLOB_DIR` 不允许放在 Next 的 `public/` 目录下(启动即报错)。

## 删除

- 删除任务:一并删除 `test-evidence/<taskId>/` 下的证据 blob(此前只有删除整个工作区才会删)。删除项目时,项目下每个任务的证据也一并删除。blob 清理在数据库删除提交之后进行,失败只记日志,不会让删除本身失败。
- 删除工作区:按前缀清理 `workspaces/<id>/`(logo、编辑器图片、导出包)和每个任务的证据目录(LUM-861)。
- 以上按前缀的清理都会**两个 store 各跑一遍**:历史公开 blob 在公开 store,新文件在私有 store。S3 / 磁盘后端同样把 `public/` 与 `private/` 两个命名空间各扫一遍。

## 存量迁移(LUM-916 之前上传的公开 blob)

LUM-916 之前,证据存放在 `test-evidence/…/<uuid>.<ext>`,编辑器图片存放在 `documents/<folder>/…`,两者都是**公开** blob。迁移脚本:

```bash
npx tsx scripts/migrate-public-blobs.ts
```

默认**只读**:输出公开证据/图片 blob 的数量、各表引用了它们的行数、要复制多少份私有副本、孤儿(没有任何引用)、失效引用(blob 已不存在)和需要保留公开的数量。

加 `--apply --confirm-host <数据库 host>` 后:

1. 把每个被引用的公开 blob 复制成私有副本:证据保留原来的任务/用例目录;图片按**引用它的工作区**各复制一份,放到 `workspaces/<id>/images/`(同一张图被两个工作区引用,就各有一份)
2. 把库里所有引用改写成 `/api/files/…` 链接。覆盖的字段:任务描述、任务/想法评论、文档正文与 markdown 源、文档历史版本、文档模板、文档评论、里程碑/项目/Initiative 描述、Initiative 进展、测试 run 的证据、草稿。改写不会改变这些行的 `updatedAt`
3. 所有引用都改写完成后,删除公开原件
4. 只有加了 `--delete-orphans` 才会删除没有任何引用的公开 blob

回收站(LUM-918)里的任务和文档照常扫描和改写:它们可以被恢复,漏扫会让其中的图片被当成孤儿删掉(恢复后裂图)或永远保持公开(LUM-922)。

分批与回滚(LUM-922):

- `--limit N`:本次只迁移前 N 个被引用的公开 blob(连同它的全部副本、改写和原件处理),输出里的 `batch.remaining` 是剩余数量;重复执行直到为 0
- `--keep-originals`:只复制和改写,**不删除任何公开 blob**,旧链接继续可用;不能和 `--delete-orphans` 同时用。保留下来的原件在下一次运行时会计入孤儿,确认私有副本没问题后再用 `--apply --delete-orphans` 清掉
- 每次 `--apply` 都会写一份 manifest(公开 URL → 替换成的新链接,默认在系统临时目录,`--manifest <file>` 可指定),原件保留期间可据此把改写反向改回

需要保留公开的情况:只被**全局**文档模板(不属于任何工作区)引用的图片,以及所属任务已彻底删除、但仍被别处引用的证据。这些 blob 保持原状,以免把仍在使用的内容弄裂。

脚本可以重复执行:私有副本的路径由源 URL 推导,中途崩溃后重跑会覆盖同一批副本;完整跑完一次之后,再跑什么也不做。

**生产环境执行需要负责人在看过只读统计之后明确授权**,不在部署流程里自动跑。

### 对旧链接的影响

迁移删除公开原件之后,**旧的公开链接会永久失效**,Lumo 库里的引用都已改成新链接,不受影响。受影响的是 Lumo **库外**的副本:

- 已经贴进 GitHub PR 评论、Slack 消息、外部文档或日志里的旧 blob 链接会返回 404
- 旧证据链接里的截图在 PR 评论中会裂图
- 需要的话,从 Lumo 里重新复制新链接即可;新链接只对工作区成员可用,这正是本次改动的目的

这是预期行为:公开链接一旦被转发就无法撤回,删除原件是让它们失效的唯一办法。
