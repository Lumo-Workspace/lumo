# LUM-226 文档选区锚定评论 — Plan #6（@提及通知 + 服务端作者校验）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ① 文档评论 @提及某人时发通知（站内 inbox + 尽力 Slack DM），镜像任务评论的 `notifyMentions`；② 落实已决权限边界（设计 §13）：**编辑/删除仅作者**（服务端强制），resolve/reopen 维持对任意有访问权者开放。

**Architecture:** 数据层加 `DOCUMENT_COMMENT_MENTIONED` 枚举 + `Notification.documentCommentId/documentId` 可空列（离线迁移，drift-safe）。`documentComment.service` 加 `notifyDocMentions`（复用 `parseMentionedClerkIds` 思路 + `memberRepository.findByWorkspaceAndClerkIds` + `shouldNotifyBatch` + `notificationRepository.createMany` + `sendDMNotification`），在 `createCommentWithSideEffects` 里 fire-and-forget 调用；update/delete 加 `existing.authorActorId === callerActorId` 校验（route 解析 actorId 传入）。

**Tech Stack:** Next.js, Prisma + Neon, Slack 集成, Jest (SWC, mocks Prisma).

**前置（全在 main）:** Plan #1–#4 已合并（service/repo/route/schema、`getHumanActorId`、`getActorClerkId`、`parseMentionedClerkIds`@comment.service、`notificationRepository.createMany`、`shouldNotifyBatch`、`sendDMNotification`、`memberRepository.findByWorkspaceAndClerkIds`）。Plan #5（#309）未合并但不冲突（本计划不碰 getComments/anchor）。**执行前若 #309 已合并，从最新 main 重切分支或 merge origin/main。**

**Scope 取舍（写进 PR）:**

- Slack：仅 **DM 提及者**，复用现有 `comment_mention` SlackEventType（不新增事件类型，不做 channel 广播——文档非可靠 project-scoped，channel 广播延后）。
- 偏好门：`DOCUMENT_COMMENT_MENTIONED` 复用现有 mention 偏好字段（`notifyInAppMention`/`notifySlackMention`），不新增用户偏好开关。

**Out of scope:** i18n 全量 → **Plan #7**；Slack channel 广播 / 专用通知偏好开关 → 后续可选。

---

## 关键约定

- 分支 `lumo/LUM-226-doc-comments-notify`（off origin/main）；NEVER checkout/switch/reset/stash；只 add/commit 本任务文件；测试 cwd 在仓库内。
- TS strict（`field?: T | undefined`；下标先取值再判空）；service 抛 `Object.assign(new Error,{status})`；副作用 fire-and-forget `.catch()` 或 `waitUntil`。
- **DB 安全**：`migrate dev` 若遇 drift → STOP（不 reset）。本计划用**离线迁移**（见 Task 1），不触 dev DB。
- 改完测试通过才 commit；msg `type: desc [LUM-226]` + Co-Authored-By。

## 文件结构

**新建：**

- `lib/utils/buildDocumentUrl.ts` + `__tests__/lib/buildDocumentUrl.test.ts`
- `prisma/migrations/<ts>_add_document_comment_notification/migration.sql`

**修改：**

- `prisma/schema.prisma` — `NotificationType` 加 `DOCUMENT_COMMENT_MENTIONED`；`Notification` 加 `documentCommentId String?`、`documentId String?`。
- `lib/repositories/notification.repository.ts` — `createMany` data 类型加 `documentCommentId?`、`documentId?`。
- `lib/notifications/preferenceGate.ts` — `INAPP_MAP`/`SLACK_MAP` 加 `DOCUMENT_COMMENT_MENTIONED`。
- `lib/services/documentComment.service.ts` — `notifyDocMentions` + 在 create 里调用；update/delete 加作者校验。
- `app/api/documents/[id]/comments/[commentId]/route.ts` — update/delete 解析并传 `actorId`。
- 测试：`__tests__/lib/services/documentComment.service.test.ts`（作者校验 + notify）。

---

## Task 1: 数据层（枚举 + 列 + 离线迁移 + repo + 偏好门）

**Files:** Modify `prisma/schema.prisma`, `lib/repositories/notification.repository.ts`, `lib/notifications/preferenceGate.ts`; Create migration

- [ ] **Step 1: schema**
- `enum NotificationType { … DOCUMENT_COMMENT_MENTIONED }`（追加到末尾，紧跟 SPRINT_CLOSED）。
- `model Notification` 追加：

  ```prisma
  documentId        String?
  documentCommentId String?
  ```

  （沿用现有 `commentId`/`taskId` 的无显式 @relation 风格——它们也只是裸 String? 字段。）

- [ ] **Step 2: 离线生成迁移**（drift-safe，遵循 memory「离线生成迁移绕过 dev-DB drift」）

```bash
cd /Users/chaoli/Desktop/lumo/lumo
# 看 Prisma 会生成的 SQL（不碰 DB）
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script 2>/dev/null \
  | grep -iE "DOCUMENT_COMMENT_MENTIONED|documentCommentId|notifications" | head
```

手写 `prisma/migrations/<timestamp>_add_document_comment_notification/migration.sql`（timestamp 取当前、晚于已有最新迁移）：

```sql
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DOCUMENT_COMMENT_MENTIONED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "documentId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "documentCommentId" TEXT;
```

> 确认表名（`notifications` 还是 `Notification`）——以 `prisma migrate diff` 输出 / 现有迁移里的真实表名为准（任务通知用的是 `notifications`，见 explore）。`ADD VALUE IF NOT EXISTS` 是仓库现有惯例（idempotent）。
> 然后 `npx prisma generate`（离线，产出 client 类型）。**不要** `migrate dev`/`db execute`（dev DB drift）。

- [ ] **Step 3: repo createMany 扩类型** —— `lib/repositories/notification.repository.ts`

```typescript
async createMany(
  data: {
    workspaceId: string
    recipientActorId: string
    type: NotificationType
    taskId?: string | null
    sprintId?: string | null
    commentId?: string
    documentId?: string | null
    documentCommentId?: string | null
    triggerActorId: string | null
  }[]
) {
  return prisma.notification.createMany({ data })
}
```

- [ ] **Step 4: 偏好门** —— `lib/notifications/preferenceGate.ts`
      在 `INAPP_MAP` 与 `SLACK_MAP` 各加一行，复用现有 mention 偏好字段（读 `TASK_MENTIONED` 那行用的字段名，照抄）：

```typescript
// INAPP_MAP
DOCUMENT_COMMENT_MENTIONED: 'notifyInAppMention',
// SLACK_MAP
DOCUMENT_COMMENT_MENTIONED: 'notifySlackMention',
```

> 字段名以文件里 `TASK_MENTIONED` 实际映射为准；若 map 是 `Record<NotificationType, …>` 全量类型，加了枚举值后 TS 会要求补这一项（正好提醒别漏）。

- [ ] **Step 5: 校验**
      `cd /Users/chaoli/Desktop/lumo/lumo && npx prisma generate && npx tsc --noEmit 2>&1 | grep -iE "notification|preferenceGate" || echo clean` → clean。
      （无单测；类型 + 迁移文件即产物。）

- [ ] **Step 6: Commit**

```bash
cd /Users/chaoli/Desktop/lumo/lumo
git add prisma/schema.prisma prisma/migrations lib/repositories/notification.repository.ts lib/notifications/preferenceGate.ts
git commit -m "feat: DocumentComment mention notification schema + prefs [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 服务端作者校验（编辑/删除仅作者）

**Files:** Modify `lib/services/documentComment.service.ts`, `app/api/documents/[id]/comments/[commentId]/route.ts`; extend service test

- [ ] **Step 1: 失败测试** —— `__tests__/lib/services/documentComment.service.test.ts`

```typescript
describe('author-only edit/delete', () => {
  it('rejects edit by a non-author (403)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-owner',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.updateCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-someone-else',
        body: 'x',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('allows edit by the author', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-me',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    repo.update.mockResolvedValue({ id: 'c1' } as never)
    await documentCommentService.updateCommentWithSideEffects({
      commentId: 'c1',
      memberId: 'm-me',
      workspaceId: 'w1',
      actorId: 'a-me',
      body: 'x',
      waitUntil: noop,
    })
    expect(repo.update).toHaveBeenCalledWith('c1', { body: 'x' })
  })

  it('rejects delete by a non-author (403)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-owner',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.deleteCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-x',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.softDelete).not.toHaveBeenCalled()
  })
})
```

（既有 update/delete 测试需补 `actorId` 入参——把它们的调用加上 `actorId` 与各自 comment 的 `authorActorId` 对应，保持通过。）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现** —— service 改 `updateCommentWithSideEffects` / `deleteCommentWithSideEffects` 签名加 `actorId: string | null`，在取到 `existing` 后、动作前加：

```typescript
if (existing.authorActorId && existing.authorActorId !== actorId) {
  throw Object.assign(new Error('Forbidden'), { status: 403 })
}
```

（resolve/`setStatusWithSideEffects` **不**加此校验——维持对任意访问者开放。）

- [ ] **Step 4: route 传 actorId** —— `[commentId]/route.ts`
- PATCH 的 body-update 分支：`const actorId = await getHumanActorId(identity.memberId)`（status 分支已有，可提到前面共用），传 `actorId` 给 `updateCommentWithSideEffects`。
- DELETE：同样解析并传 `actorId` 给 `deleteCommentWithSideEffects`。

- [ ] **Step 5: 测试 + tsc** → green / 0。
- [ ] **Step 6: Commit**

```bash
git add lib/services/documentComment.service.ts "app/api/documents/[id]/comments/[commentId]/route.ts" __tests__/lib/services/documentComment.service.test.ts
git commit -m "feat: author-only edit/delete enforcement for doc comments [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `notifyDocMentions` + buildDocumentUrl + 接入 create

**Files:** Create `lib/utils/buildDocumentUrl.ts` (+test); Modify `lib/services/documentComment.service.ts`; extend service test

- [ ] **Step 1: buildDocumentUrl（TDD）**
      测试 `__tests__/lib/buildDocumentUrl.test.ts`：

```typescript
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'
it('builds a workspace document url', () => {
  expect(buildDocumentUrl('acme', 'spec-3')).toMatch(
    /\/workspace\/acme\/documents\/spec-3$/
  )
})
```

实现 `lib/utils/buildDocumentUrl.ts`（镜像 `buildTaskUrl`）：

```typescript
export function buildDocumentUrl(
  workspaceSlug: string,
  docSlug: string
): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/documents/${docSlug}`
}
```

- [ ] **Step 2: 失败测试（notifyDocMentions 建 inbox 通知）** —— service test

```typescript
describe('notifyDocMentions', () => {
  it('creates DOCUMENT_COMMENT_MENTIONED inbox notifications for mentioned non-authors', async () => {
    // author clerk resolved; one mentioned member
    jest.spyOn(actorModule, 'getActorClerkId').mockResolvedValue('author-clerk') // adapt to how getActorClerkId is imported/mocked
    memberRepo.findByWorkspaceAndClerkIds.mockResolvedValue([
      { clerkId: 'bob-clerk', actor: { id: 'a-bob' } },
    ] as never)
    // both inApp + slack gates allow a-bob
    notifyGate.shouldNotifyBatch.mockResolvedValue(new Set(['a-bob']))
    notificationRepo.createMany.mockResolvedValue({ count: 1 } as never)

    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: '<span data-type="mention" data-id="bob-clerk">@Bob</span> hi',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'Spec',
      workspaceSlug: 'acme',
      docSlug: 'spec-3',
      waitUntil: noop,
    })
    expect(notificationRepo.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DOCUMENT_COMMENT_MENTIONED',
          recipientActorId: 'a-bob',
          documentId: 'd1',
          documentCommentId: 'c1',
          triggerActorId: 'a-me',
          workspaceId: 'w1',
        }),
      ])
    )
  })
})
```

> 按测试文件现有的 mock 方式 mock：`@/lib/repositories`（memberRepository/notificationRepository）、`@/lib/services/notification.service`（shouldNotifyBatch）、`@/lib/integrations/slack`（sendDMNotification）、`@/lib/actor`（getActorClerkId）。对照 `comment.service.test` 的 mock 写法照搬。

- [ ] **Step 3: 实现 `notifyDocMentions`**（镜像 `comment.service.notifyMentions`，DM-only）

```typescript
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { shouldNotifyBatch } from '@/lib/services/notification.service'
import { sendDMNotification } from '@/lib/integrations/slack'
import { getActorClerkId } from '@/lib/actor'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'
// reuse the mention regex (extract a shared parseMentionedClerkIds or inline the same regex)

async notifyDocMentions(params: {
  documentId: string; documentCommentId: string; body: string
  authorActorId: string | null; workspaceId: string
  docTitle: string; workspaceSlug: string; docSlug: string
  waitUntil: (p: Promise<unknown>) => void
}) {
  const authorClerkId = params.authorActorId ? await getActorClerkId(params.authorActorId) : null
  const mentionedClerkIds = parseMentionedClerkIds(params.body, authorClerkId ?? '')
  if (mentionedClerkIds.length === 0) return
  const members = await memberRepository.findByWorkspaceAndClerkIds(params.workspaceId, mentionedClerkIds)
  const recipientActorIds = members.map(m => m.actor?.id).filter((x): x is string => !!x)
  if (recipientActorIds.length === 0) return

  const [inAppAllowed, slackAllowed] = await Promise.all([
    shouldNotifyBatch(recipientActorIds, 'inApp', 'DOCUMENT_COMMENT_MENTIONED'),
    shouldNotifyBatch(recipientActorIds, 'slack', 'DOCUMENT_COMMENT_MENTIONED'),
  ])

  const url = buildDocumentUrl(params.workspaceSlug, params.docSlug)
  for (const m of members) {
    const actorId = m.actor?.id
    if (actorId && slackAllowed.has(actorId) && m.clerkId) {
      params.waitUntil(
        sendDMNotification(params.workspaceId, m.clerkId, 'comment_mention', {
          taskTitle: params.docTitle, taskUrl: url, commentBody: params.body,
        })
      )
    }
  }

  const inAppRecipients = recipientActorIds.filter(id => inAppAllowed.has(id))
  if (inAppRecipients.length > 0) {
    await notificationRepository.createMany(
      inAppRecipients.map(recipientActorId => ({
        workspaceId: params.workspaceId,
        recipientActorId,
        type: 'DOCUMENT_COMMENT_MENTIONED' as const,
        documentId: params.documentId,
        documentCommentId: params.documentCommentId,
        triggerActorId: params.authorActorId,
      }))
    )
  }
}
```

> 把 `parseMentionedClerkIds` 抽成共享工具（`lib/services/comment.service.ts` 已有同名方法——可 export 复用或抽到 `lib/utils/`）。最省事：在 documentComment.service 内放一份同样的私有函数（与 comment.service 一致的正则），避免跨 service import。

- [ ] **Step 4: 接入 `createCommentWithSideEffects`**
      在创建成功后（拿到 `comment`），fire-and-forget 调用（仿任务评论 `.catch()` 风格）。需要 docTitle/slug + workspaceSlug：
- `doc`（`findWithPermission` 返回）已有 `title`、`slug`；workspaceSlug 用 `workspaceRepository.findNameAndSlug(workspaceId)`（或给 `findWithPermission` 的 include 加 `workspace.slug`——优先单独查，少改动）。

```typescript
const ws = await workspaceRepository.findNameAndSlug(workspaceId)
documentCommentService
  .notifyDocMentions({
    documentId,
    documentCommentId: comment.id,
    body: input.body,
    authorActorId,
    workspaceId,
    docTitle: doc.title,
    workspaceSlug: ws?.slug ?? '',
    docSlug: doc.slug,
    waitUntil,
  })
  .catch(err =>
    console.error('[notify] DOCUMENT_COMMENT_MENTIONED failed:', err)
  )
```

> 仅顶层与回复都可 @人——两种都通知（不像 content-patch 只限顶层）。确认 `doc.slug` 存在（Document 有 slug 字段）。

- [ ] **Step 5: 测试 + tsc** → green / 0。
- [ ] **Step 6: Commit**

```bash
git add lib/utils/buildDocumentUrl.ts __tests__/lib/buildDocumentUrl.test.ts lib/services/documentComment.service.ts __tests__/lib/services/documentComment.service.test.ts
git commit -m "feat: @mention notifications for document comments [LUM-226]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 收尾验证

- [ ] `npx prisma generate && npx tsc --noEmit` → 0。
- [ ] 全量相关测试：service（作者校验 + notify）+ buildDocumentUrl → 绿。
- [ ] 无 `console.log`（用 `console.error`）；无新 npm 包。
- [ ] **PR 描述**：①新增迁移 `add_document_comment_notification`（加枚举值 + 两列），**prod 需 `migrate deploy`**，无数据破坏；②权限边界已定：编辑/删除仅作者（服务端强制），resolve 开放；③Slack 仅 DM、复用 `comment_mention` 事件，channel 广播延后；④i18n 全量留 Plan #7。
- [ ] 合并 + 部署后按 memory 手动 `DOTENV_CONFIG_PATH=.env.production prisma migrate deploy` + `migrate status`（需你授权）。

## 自查（spec coverage）

| 设计要求                       | 本计划       | 备注                                        |
| ------------------------------ | ------------ | ------------------------------------------- |
| @提及 + 通知（inbox）          | Task 1+3     | DOCUMENT_COMMENT_MENTIONED + createMany     |
| @提及 Slack                    | Task 3       | DM-only，复用 comment_mention，channel 延后 |
| 权限边界（§13）编辑/删除仅作者 | Task 2       | 服务端 403 强制                             |
| resolve 开放                   | 维持现状     | 不加校验                                    |
| @通知偏好门                    | Task 1       | 复用 mention 偏好字段                       |
| i18n 全量                      | ❌ → Plan #7 |                                             |
| Slack channel 广播             | ❌（延后）   | 文档非可靠 project-scoped                   |
