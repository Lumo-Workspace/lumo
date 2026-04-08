# Modular Architecture Refactoring Design Spec

**Date:** 2026-04-07
**Goal:** 全面重构代码库，建立清晰的模块划分和层间接口，降低耦合度，消除代码重复。

---

## 1. 分层架构总览

### 数据流

```
Component → API Client → API Route → Service → Repository → Prisma/DB
```

### 层职责定义

| 层             | 位置                            | 职责                                             | 禁止                           |
| -------------- | ------------------------------- | ------------------------------------------------ | ------------------------------ |
| **Repository** | `lib/repositories/`             | 封装 Prisma 查询，返回领域模型                   | 不含业务逻辑、不做权限校验     |
| **Service**    | `lib/services/`                 | 业务逻辑编排：状态机、通知、权限校验             | 不直接访问 Prisma，不处理 HTTP |
| **API Route**  | `app/api/`                      | 参数解析、Zod 校验、调用 Service、返回 Response  | 不含业务逻辑，不含 Prisma 查询 |
| **API Client** | `lib/api-client/`               | 封装 `fetch()`，统一错误处理，返回类型安全的数据 | 不含 UI 逻辑                   |
| **Component**  | `components/`、`app/workspace/` | 渲染 UI、调用 API Client、管理局部 UI 状态       | 不直接 fetch，不含业务逻辑     |

### 目录结构变更

```
lib/
├── repositories/              # NEW — 数据访问层
│   ├── task.repository.ts
│   ├── comment.repository.ts
│   ├── project.repository.ts
│   ├── document.repository.ts
│   ├── workspace.repository.ts
│   └── index.ts
├── services/                  # NEW — 业务逻辑层
│   ├── task.service.ts
│   ├── comment.service.ts
│   ├── project.service.ts
│   ├── document.service.ts
│   ├── agent.service.ts
│   └── index.ts
├── api-client/                # NEW — 前端 API 封装
│   ├── base.ts                # 基础 fetch 封装、错误处理
│   ├── tasks.ts
│   ├── comments.ts
│   ├── projects.ts
│   ├── documents.ts
│   └── index.ts
├── dto/                       # NEW — 数据转换
│   ├── task.mapper.ts
│   ├── comment.mapper.ts
│   └── index.ts
├── auth/                      # 保留，不变
├── db/                        # 保留，不变
├── validation/                # 重构 — 按域拆分
│   ├── task.schema.ts
│   ├── project.schema.ts
│   ├── workspace.schema.ts
│   ├── document.schema.ts
│   ├── comment.schema.ts
│   └── index.ts
```

### 模块接口设计原则

1. **Repository 接口** — 只暴露 CRUD + 查询方法，参数为简单值类型，返回领域模型
2. **Service 接口** — 接收 userId/workspaceId 等上下文 + 操作参数，返回操作结果
3. **API Client 接口** — 接收类型安全参数，返回 `Promise<T>`，统一错误处理

---

## 2. Repository 层接口

以 Task 为核心示例（当前 `/api/tasks/[id]/route.ts` 内嵌 ~60 行 Prisma 查询）：

```typescript
// lib/repositories/task.repository.ts
export const taskRepository = {
  findById(id: string, opts?: { includeComments?: boolean; includePR?: boolean }): Promise<TaskWithRelations | null>,
  findByWorkspace(workspaceId: string, filters: TaskFilters): Promise<Task[]>,
  findByProject(projectId: string, filters: TaskFilters): Promise<Task[]>,
  create(data: CreateTaskData): Promise<Task>,
  update(id: string, data: UpdateTaskData): Promise<Task>,
  delete(id: string): Promise<void>,
  findDescendants(id: string): Promise<string[]>,  // 提取自 isDescendant() 递归
}
```

其他 Repository 同理：`commentRepository`、`projectRepository`、`documentRepository`、`workspaceRepository`。

---

## 3. Service 层接口

Service 编排业务逻辑，依赖 Repository：

```typescript
// lib/services/task.service.ts
export const taskService = {
  getTaskDetail(userId: string, workspaceId: string, taskId: string): Promise<TaskDetailDTO>,
  createTask(userId: string, workspaceId: string, data: CreateTaskInput): Promise<Task>,
  updateTask(userId: string, workspaceId: string, taskId: string, data: UpdateTaskInput): Promise<Task>,
  deleteTask(userId: string, workspaceId: string, taskId: string): Promise<void>,
  validateParentReference(taskId: string, parentId: string): Promise<boolean>,
}
// 内部处理：权限校验、状态机转换、循环引用检测、通知派发、PR 同步

// lib/services/agent.service.ts — 提取自 lib/agent/execute.ts (1,438 行)
export const agentService = {
  executeAgent(options: ExecuteAgentOptions): Promise<AgentResult>,
  loadTaskContext(taskId: string): Promise<RunContext>,
  resolveRepo(workspaceId: string, projectId: string): Promise<RepoInfo>,
  createAgentRun(taskId: string, context: RunContext): Promise<AgentRun>,
}
```

### API Route 瘦身目标

```typescript
// app/api/tasks/[id]/route.ts — 从 533 行 → ~50 行
export async function GET(req, { params }) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const member = await requireWorkspaceMember(auth.userId, params.workspaceUrl)
  if (member instanceof NextResponse) return member

  const task = await taskService.getTaskDetail(
    auth.userId,
    member.workspaceId,
    params.id
  )
  return NextResponse.json(task)
}
```

---

## 4. API Client 层

```typescript
// lib/api-client/base.ts
export async function apiRequest<T>(url: string, options?: RequestInit): Promise<T>
export class ApiError extends Error { status: number; code: string }

// lib/api-client/tasks.ts
export const tasksClient = {
  getById(workspaceUrl: string, taskId: string): Promise<TaskDetailDTO>,
  list(workspaceUrl: string, filters?: TaskFilters): Promise<Task[]>,
  create(workspaceUrl: string, data: CreateTaskInput): Promise<Task>,
  update(workspaceUrl: string, taskId: string, data: UpdateTaskInput): Promise<Task>,
  delete(workspaceUrl: string, taskId: string): Promise<void>,
  getComments(workspaceUrl: string, taskId: string): Promise<Comment[]>,
  addComment(workspaceUrl: string, taskId: string, data: AddCommentInput): Promise<Comment>,
}
```

其他 Client（`projectsClient`、`documentsClient`、`workspaceClient`）同理。

---

## 5. 组件重构

### 5.1 TaskDetail 合并

当前 TaskDetailPage（1,732 行）和 TaskDetailPanel（1,599 行）合并为核心组件 + 薄包装：

```
components/tasks/
├── TaskDetail.tsx               # 核心组件 — 组合以下子组件
├── TaskHeader.tsx               # 标题、状态、操作按钮
├── TaskFields.tsx               # 字段编辑区（拆自 TaskFieldSelects 866 行）
│   ├── StatusSelect.tsx
│   ├── AssigneeSelect.tsx
│   ├── ReviewerSelect.tsx
│   ├── PrioritySelect.tsx
│   ├── ProjectSelect.tsx
│   ├── DatePicker.tsx
│   └── ParentTaskSelect.tsx
├── TaskDescription.tsx          # 描述区域（包装 DescriptionEditor）
├── TaskComments.tsx             # 评论列表 + 发布
├── TaskBranches.tsx             # 分支 / PR 显示
├── TaskAgentSection.tsx         # Agent 面板包装
└── hooks/
    ├── useTaskDetail.ts         # 数据获取 + 缓存（调用 tasksClient）
    ├── useTaskMutation.ts       # 字段更新、乐观更新
    └── useTaskComments.ts       # 评论 CRUD
```

Page 和 Panel 变为薄包装：

```typescript
// TaskDetailPage.tsx — ~30 行
export function TaskDetailPage({ taskId }) {
  return <TaskDetail taskId={taskId} layout="page" />
}

// TaskDetailPanel.tsx — ~30 行
export function TaskDetailPanel({ taskId, onClose }) {
  return <TaskDetail taskId={taskId} layout="panel" onClose={onClose} />
}
```

### 5.2 WorkspaceApp 拆分

1,465 行的 WorkspaceApp 拆为：

```
app/workspace/[workspaceUrl]/
├── WorkspaceApp.tsx              # 精简为 ~100 行，只做组合
├── WorkspaceRouter.tsx           # 路由状态管理（pageToPath/pathToPage）
├── WorkspaceDataProvider.tsx     # 数据获取协调（projects、members、tasks）
├── WorkspaceModals.tsx           # 所有模态框集中管理
└── hooks/
    └── useWorkspaceRouter.ts     # URL ↔ Page 映射逻辑
```

### 5.3 DescriptionEditor 拆分

1,314 行拆为：

```
components/editor/
├── DescriptionEditor.tsx         # 精简为 ~150 行，组合以下模块
├── EditorToolbar.tsx             # 格式化工具栏
├── BubbleMenuBar.tsx             # 选中文本浮动菜单
├── MentionList.tsx               # @提及下拉列表
├── SlashCommandMenu.tsx          # / 命令菜单
├── extensions/
│   ├── index.ts                  # 所有扩展统一注册
│   ├── mention.ts                # mention 扩展配置
│   ├── slash-command.ts          # slash command 扩展配置
│   └── image-upload.ts           # 图片上传扩展
└── hooks/
    ├── useEditorConfig.ts        # Tiptap 编辑器初始化配置
    └── useImageUpload.ts         # 图片上传逻辑
```

---

## 6. Shared 包扩展 + Agent 去重

### 6.1 Shared 包结构

当前 `shared/src/index.ts` 只有 Agent 错误类型。扩展为：

```
shared/src/
├── types/
│   ├── task.ts              # Task、TaskStatus、TaskPriority
│   ├── project.ts           # Project 相关类型
│   ├── agent.ts             # AgentResult、ExecuteAgentOptions、RunContext
│   ├── workspace.ts         # Workspace、WorkspaceMember
│   └── index.ts
├── validation/
│   ├── task.schema.ts       # 跨项目共用的 Zod schemas
│   └── index.ts
├── errors/
│   ├── agent.error.ts       # 现有 AgentError（从 index.ts 迁出）
│   ├── api.error.ts         # 通用 API 错误定义
│   └── index.ts
├── constants/
│   ├── task.ts              # 状态机转换规则、优先级列表
│   └── index.ts
└── index.ts                 # 统一导出
```

### 6.2 Agent 代码去重

提取共享逻辑到 shared，两端精简：

```
shared/src/agent/
├── context.ts               # RunContext 构建逻辑
├── state-machine.ts         # Agent 状态转换规则
└── index.ts

lib/agent/                   # 主项目特有
├── execute.ts               # 精简 — Pusher 通知、Web API 响应
├── sandbox.ts               # E2B sandbox 管理
├── github.ts                # GitHub 集成（PR 创建、分支管理）
└── index.ts

agent-server/src/agent/      # agent-server 特有
├── execute.ts               # 精简 — CLI 入口、独立运行
├── sandbox.ts               # 自有实现或复用
└── index.ts
```

**去重原则：**

- 类型、常量、状态机规则 → `shared/`
- RunContext 构建逻辑 → `shared/src/agent/context.ts`
- 主项目特有（Pusher、Web Response）→ 留在 `lib/agent/`
- agent-server 特有（CLI、独立进程）→ 留在 `agent-server/src/agent/`

---

## 7. Validation 重组

当前 `lib/validation/schemas.ts`（444 行）按域拆分：

```
lib/validation/
├── task.schema.ts            # createTaskSchema、updateTaskSchema
├── project.schema.ts         # createProjectSchema、updateProjectSchema
├── workspace.schema.ts       # createWorkspaceSchema、inviteMemberSchema
├── document.schema.ts        # createDocumentSchema、updateDocumentSchema
├── comment.schema.ts         # createCommentSchema
└── index.ts                  # 统一导出
```

与 `shared/src/validation/` 的关系：

- `shared/` 放跨项目共用的 schema：枚举值校验（TaskStatus、TaskPriority）、API 请求/响应的基础字段校验（被主项目和 agent-server 同时引用的）
- `lib/validation/` 放主项目独有的 schema：包含 Prisma 关联约束的完整表单校验（如 createTaskSchema 需要校验 projectId 存在性）、UI 表单专用校验
- **判断标准：如果 agent-server 也需要这个 schema，放 shared/；否则放 lib/validation/**

---

## 8. 当前问题与解决映射

| 当前问题                                                  | 严重度   | 解决方案                                 |
| --------------------------------------------------------- | -------- | ---------------------------------------- |
| TaskDetailPage (1,732行) + TaskDetailPanel (1,599行) 重复 | CRITICAL | §5.1 合并为 TaskDetail 核心组件 + 薄包装 |
| WorkspaceApp.tsx (1,465行) 单体                           | CRITICAL | §5.2 拆为 Router + DataProvider + Modals |
| lib/agent/execute.ts + agent-server 重复                  | CRITICAL | §6.2 共享逻辑提取到 shared/              |
| 无数据访问层，组件直接 fetch                              | CRITICAL | §4 API Client 层                         |
| API routes 臃肿（533行）                                  | HIGH     | §2-3 Repository + Service 分层           |
| DescriptionEditor (1,314行) 职责混合                      | HIGH     | §5.3 拆为编辑器 + 扩展 + 工具栏          |
| TaskFieldSelects (866行) 7 组件打包                       | HIGH     | §5.1 拆为独立 Select 组件                |
| use-teams.ts (630行) 30+ 操作                             | MEDIUM   | 按职责拆分为多个 hooks                   |
| validation/schemas.ts (444行) 全堆一起                    | MEDIUM   | §7 按域拆分                              |
| 两个竞争的 task management hooks                          | MEDIUM   | 统一为一个，基于 API Client              |

---

## 9. 不在本次范围内

- Prisma schema 结构（当前良好，无需调整）
- 认证层（lib/auth 当前设计合理）
- shadcn/ui 组件（纯 UI 层，无需重构）
- Landing page 组件（已经隔离良好）
- MCP server（独立模块，不影响主架构）
