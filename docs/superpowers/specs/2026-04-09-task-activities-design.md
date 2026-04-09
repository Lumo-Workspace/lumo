# Task Activities Design

## Overview

为 Lumo 的 Task 添加完整的 Activity 系统，包括变更审计日志和统一的 Activity Timeline UI。Timeline 将 activity 事件和评论合并为一条时间线展示在 task 详情页。

## 需求总结

- 记录 task 上所有关键变更（字段变更、协作事件、Agent 事件、Git/PR 事件）
- 在 task 详情页提供 Activity / Comments 两个 tab
  - **Activity tab**: activity 事件 + comments 交织，按 createdAt 正序（旧→新）
  - **Comments tab**: 仅显示评论，复用现有组件
- Activity 事件和 Comment 各自独立存储，API 层查询时合并（方案 A）
- 写入采用 Event-driven 架构，Service emit 事件，ActivityListener 负责写入
- 首次加载最近 30 条，顶部"加载更早记录"按钮分页

## 数据模型

### TaskActivityType Enum

```prisma
enum TaskActivityType {
  TASK_CREATED
  STATUS_CHANGED
  PRIORITY_CHANGED
  ASSIGNEE_CHANGED
  REVIEWER_CHANGED
  TITLE_CHANGED
  DESCRIPTION_CHANGED
  DUE_DATE_CHANGED
  PARENT_CHANGED
  TAGS_CHANGED
  REPOSITORY_CHANGED
  COMMENT_ADDED
  COMMENT_DELETED
  SUBTASK_ADDED
  SUBTASK_REMOVED
  SPEC_GENERATED
  BRANCH_CREATED
  PR_LINKED
  PR_UNLINKED
  PR_CREATED
  PR_MERGED
  AGENT_RUN_STARTED
  AGENT_RUN_COMPLETED
  AGENT_RUN_FAILED
  AGENT_INPUT_REQUIRED
}
```

### TaskActivity Model (修改现有)

```prisma
model TaskActivity {
  id        String           @id @default(cuid())
  taskId    String
  actorId   String?
  type      TaskActivityType  // 从 String 改为 enum
  payload   Json?
  createdAt DateTime         @default(now())

  task  Task   @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor Actor? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([taskId, createdAt])  // 新增复合索引
  @@index([taskId])
  @@map("task_activities")
}
```

### Payload 约定

每种 activity type 对应固定的 JSON 结构：

| type                   | payload                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| `TASK_CREATED`         | `{}`                                                                      |
| `STATUS_CHANGED`       | `{ "from": "TODO", "to": "IN_PROGRESS" }`                                 |
| `PRIORITY_CHANGED`     | `{ "from": "MEDIUM", "to": "HIGH" }`                                      |
| `ASSIGNEE_CHANGED`     | `{ "fromActorId": null, "toActorId": "actor_xxx", "toName": "张三" }`     |
| `REVIEWER_CHANGED`     | `{ "fromActorId": null, "toActorId": "actor_yyy", "toName": "李四" }`     |
| `TITLE_CHANGED`        | `{ "from": "旧标题", "to": "新标题" }`                                    |
| `DESCRIPTION_CHANGED`  | `{}` (仅记录变更事实)                                                     |
| `DUE_DATE_CHANGED`     | `{ "from": null, "to": "2026-04-15" }`                                    |
| `PARENT_CHANGED`       | `{ "fromTaskId": null, "toTaskId": "task_xxx", "toTitle": "父任务" }`     |
| `TAGS_CHANGED`         | `{ "added": ["bug"], "removed": ["feature"] }`                            |
| `REPOSITORY_CHANGED`   | `{ "fromRepoId": null, "toRepoId": "repo_xxx", "toName": "lumo/lumo" }`   |
| `COMMENT_ADDED`        | `{ "commentId": "cmt_xxx" }`                                              |
| `COMMENT_DELETED`      | `{ "commentId": "cmt_xxx" }`                                              |
| `SUBTASK_ADDED`        | `{ "childTaskId": "task_xxx", "childTitle": "子任务", "childNumber": 5 }` |
| `SUBTASK_REMOVED`      | `{ "childTaskId": "task_xxx", "childTitle": "子任务" }`                   |
| `SPEC_GENERATED`       | `{}`                                                                      |
| `BRANCH_CREATED`       | `{ "branchName": "lumo/LUM-12-fix" }`                                     |
| `PR_LINKED`            | `{ "prId": "pr_xxx", "prNumber": 42, "prUrl": "..." }`                    |
| `PR_UNLINKED`          | `{ "prId": "pr_xxx", "prNumber": 42 }`                                    |
| `PR_CREATED`           | `{ "prNumber": 42, "prUrl": "...", "prTitle": "..." }`                    |
| `PR_MERGED`            | `{ "prNumber": 42, "prUrl": "..." }`                                      |
| `AGENT_RUN_STARTED`    | `{ "runId": "run_xxx", "runNumber": 3 }`                                  |
| `AGENT_RUN_COMPLETED`  | `{ "runId": "run_xxx", "runNumber": 3 }`                                  |
| `AGENT_RUN_FAILED`     | `{ "runId": "run_xxx", "runNumber": 3, "errorCode": "..." }`              |
| `AGENT_INPUT_REQUIRED` | `{ "runId": "run_xxx", "reason": "spec_review" }`                         |

payload 中冗余存了 name/title 等快照字段，timeline 展示时不需要再关联查询。

## 后端架构

### Event Bus (`lib/events/event-bus.ts`)

基于 Node.js EventEmitter 的类型安全封装：

```typescript
type TaskEvents = {
  'task.created': { taskId: string; actorId: string; tx?: PrismaTx }
  'task.status_changed': {
    taskId: string
    actorId: string
    from: string
    to: string
    tx?: PrismaTx
  }
  'task.priority_changed': {
    taskId: string
    actorId: string
    from: string
    to: string
    tx?: PrismaTx
  }
  'task.assignee_changed': {
    taskId: string
    actorId: string
    fromActorId: string | null
    toActorId: string | null
    toName: string | null
    tx?: PrismaTx
  }
  'task.reviewer_changed': {
    taskId: string
    actorId: string
    fromActorId: string | null
    toActorId: string | null
    toName: string | null
    tx?: PrismaTx
  }
  'task.title_changed': {
    taskId: string
    actorId: string
    from: string
    to: string
    tx?: PrismaTx
  }
  'task.description_changed': { taskId: string; actorId: string; tx?: PrismaTx }
  'task.due_date_changed': {
    taskId: string
    actorId: string
    from: string | null
    to: string | null
    tx?: PrismaTx
  }
  'task.parent_changed': {
    taskId: string
    actorId: string
    fromTaskId: string | null
    toTaskId: string | null
    toTitle: string | null
    tx?: PrismaTx
  }
  'task.tags_changed': {
    taskId: string
    actorId: string
    added: string[]
    removed: string[]
    tx?: PrismaTx
  }
  'task.repository_changed': {
    taskId: string
    actorId: string
    fromRepoId: string | null
    toRepoId: string | null
    toName: string | null
    tx?: PrismaTx
  }
  'task.comment_added': {
    taskId: string
    actorId: string
    commentId: string
    tx?: PrismaTx
  }
  'task.comment_deleted': {
    taskId: string
    actorId: string
    commentId: string
    tx?: PrismaTx
  }
  'task.subtask_added': {
    taskId: string
    actorId: string
    childTaskId: string
    childTitle: string
    childNumber: number
    tx?: PrismaTx
  }
  'task.subtask_removed': {
    taskId: string
    actorId: string
    childTaskId: string
    childTitle: string
    tx?: PrismaTx
  }
  'task.spec_generated': { taskId: string; actorId: string; tx?: PrismaTx }
  'task.branch_created': {
    taskId: string
    actorId: string
    branchName: string
    tx?: PrismaTx
  }
  'task.pr_linked': {
    taskId: string
    actorId: string
    prId: string
    prNumber: number
    prUrl: string
    tx?: PrismaTx
  }
  'task.pr_unlinked': {
    taskId: string
    actorId: string
    prId: string
    prNumber: number
    tx?: PrismaTx
  }
  'task.pr_created': {
    taskId: string
    actorId: string | null
    prNumber: number
    prUrl: string
    prTitle: string
    tx?: PrismaTx
  }
  'task.pr_merged': {
    taskId: string
    actorId: string | null
    prNumber: number
    prUrl: string
    tx?: PrismaTx
  }
  'task.agent_run_started': {
    taskId: string
    actorId: string | null
    runId: string
    runNumber: number
    tx?: PrismaTx
  }
  'task.agent_run_completed': {
    taskId: string
    actorId: string | null
    runId: string
    runNumber: number
    tx?: PrismaTx
  }
  'task.agent_run_failed': {
    taskId: string
    actorId: string | null
    runId: string
    runNumber: number
    errorCode: string
    tx?: PrismaTx
  }
  'task.agent_input_required': {
    taskId: string
    actorId: string | null
    runId: string
    reason: string
    tx?: PrismaTx
  }
}
```

进程内同步事件，支持 `emit()` 和 `on()`，类型安全。

### Activity Listener (`lib/events/listeners/activity-listener.ts`)

统一注册所有事件的监听器，负责写入 TaskActivity 记录。每个 handler：

1. 接收事件 payload + 可选 `tx`
2. 调用 activityRepository.create() 构造对应的 type + payload
3. 事务提交后触发 Pusher 推送

所有 activity 写入逻辑集中在此文件，Service 层只负责 emit。

### Event 注册初始化 (`lib/events/index.ts`)

```typescript
import { taskEventBus } from './event-bus'
import { registerActivityListeners } from './listeners/activity-listener'

registerActivityListeners(taskEventBus)
```

在 Next.js instrumentation.ts 或全局初始化中 import 一次。

### Activity Repository (`lib/repositories/activity-repository.ts`)

```typescript
create(data: { taskId, actorId?, type, payload? }, tx?: PrismaTx)
findByTaskId(taskId, { cursor?, limit: 30 })  // createdAt ASC
```

### Timeline Service (`lib/services/timeline-service.ts`)

负责合并 activity 和 comment 为统一 timeline：

```typescript
getTimeline(taskId, { cursor?, limit: 30 }): { items: TimelineEntry[]; hasMore: boolean; nextCursor: string | null }
```

逻辑：

1. 分别从 activity 表和 comment 表按 createdAt ASC 查询，各取 limit + 1 条
2. 内存中按 createdAt 合并排序
3. 截取前 limit 条返回

cursor 格式：`{ timestamp: string; id: string; source: "activity" | "comment" }` — 用 id 作为二级排序键，避免同一时间戳的记录被跳过。查询时使用 `(createdAt > cursor.timestamp) OR (createdAt = cursor.timestamp AND id > cursor.id)` 条件。

### API Route

```
GET /api/tasks/:id/timeline?cursor=xxx&limit=30
```

返回：

```json
{
  "items": [TimelineEntry],
  "hasMore": true,
  "nextCursor": "encoded-cursor"
}
```

## Service 集成点

需要在以下现有 service 方法中添加 `taskEventBus.emit()` 调用：

### Task Service

| 操作         | 事件                                  |
| ------------ | ------------------------------------- |
| 创建任务     | `task.created`                        |
| 更新状态     | `task.status_changed`                 |
| 更新优先级   | `task.priority_changed`               |
| 更新负责人   | `task.assignee_changed`               |
| 更新审核人   | `task.reviewer_changed`               |
| 更新标题     | `task.title_changed`                  |
| 更新描述     | `task.description_changed`            |
| 更新截止日期 | `task.due_date_changed`               |
| 更新父任务   | `task.parent_changed`                 |
| 更新标签     | `task.tags_changed`                   |
| 更新关联仓库 | `task.repository_changed`             |
| 分解子任务   | `task.subtask_added` (每个子任务一条) |

### Comment Service

| 操作     | 事件                   |
| -------- | ---------------------- |
| 添加评论 | `task.comment_added`   |
| 删除评论 | `task.comment_deleted` |

### Agent 相关

| 操作           | 事件                        |
| -------------- | --------------------------- |
| Agent 开始运行 | `task.agent_run_started`    |
| Agent 完成     | `task.agent_run_completed`  |
| Agent 失败     | `task.agent_run_failed`     |
| Agent 请求输入 | `task.agent_input_required` |
| Spec 生成完成  | `task.spec_generated`       |

### Branch / PR 相关

| 操作              | 事件                  |
| ----------------- | --------------------- |
| 创建分支          | `task.branch_created` |
| 关联 PR           | `task.pr_linked`      |
| 取消关联 PR       | `task.pr_unlinked`    |
| PR 创建 (webhook) | `task.pr_created`     |
| PR 合并 (webhook) | `task.pr_merged`      |

原则：emit 在业务操作的同一个 `$transaction` 内，传递 `tx`；Pusher 推送在事务提交后执行。

## 前端架构

### Tab 切换

task 详情页评论区域上方添加 tab：`[ Activity | Comments ]`

- Activity tab: 统一 timeline (activity + comments)，默认选中
- Comments tab: 仅评论，复用现有 `TaskDetailComments`

### 组件结构

```
TaskDetailTimeline/
├── TimelineTabs.tsx               # tab 切换
├── ActivityTimeline.tsx           # Activity tab 主体
├── TimelineEntryRenderer.tsx      # 按 entry 类型分发渲染
├── items/
│   ├── CompactActivityItem.tsx    # 紧凑单行 (字段变更类)
│   ├── CommentTimelineItem.tsx    # 评论卡片
│   ├── AgentRunItem.tsx           # Agent 运行卡片
│   └── PrItem.tsx                 # PR 卡片
└── hooks/
    └── useTimeline.ts             # 数据获取 + 分页
```

### 渲染规则

**紧凑单行** (`CompactActivityItem`):

- 所有字段变更类、任务创建、评论删除、子任务增减、Spec 生成、分支创建
- 格式: `[头像] 张三 将状态从 TODO 改为 IN_PROGRESS     2小时前`

**卡片式**:

- `CommentTimelineItem`: 评论内容，支持回复/引用
- `AgentRunItem`: Agent 运行事件，展示 runNumber、步骤摘要、耗时
- `PrItem`: PR 事件，展示 PR 编号、标题、链接

### 数据加载 (`useTimeline` hook)

- 首次加载最近 30 条
- 顶部 "加载更早记录" 按钮加载更多
- 使用 cursor-based 分页
- Activity tab 切换时才触发加载

### 交互细节

- "加载更早记录" 按钮在列表顶部，prepend 旧数据，保持滚动位置
- 紧凑行 hover 显示完整时间戳 tooltip

## Realtime 推送

### Pusher 事件

```
channel: task-${taskId}
event: activity-created
payload: TimelineEntry
```

### 写入后推送

由于 Prisma `$transaction` 没有原生 afterCommit 回调，采用以下策略：

- Listener 在事务内写入 activity，收集待推送的 Pusher 事件到数组
- Service 方法在 `$transaction` 回调结束后（事务已提交），统一执行 Pusher 推送
- 具体实现：taskEventBus.emit 返回 `{ pusherEvents: PusherEvent[] }`，service 在事务外执行

```typescript
// service 层
const pusherEvents: PusherEvent[] = []
await prisma.$transaction(async (tx) => {
  const task = await tx.task.update({ ... })
  const events = taskEventBus.emit('task.status_changed', { ..., tx })
  pusherEvents.push(...events)
})
// 事务已提交，安全推送
for (const e of pusherEvents) {
  pusher.trigger(e.channel, e.event, e.data)
}
```

### 前端消费

`useTimeline` hook 中监听 Pusher 事件，追加到 entries 末尾：

```typescript
usePusherEvent(`task-${taskId}`, 'activity-created', entry => {
  setEntries(prev => [...prev, entry])
})
```
