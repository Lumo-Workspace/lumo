# Sprint 域分层违规重构 Design

**Date**: 2026-04-23
**Status**: Draft (awaiting user review)
**Scope tag**: P1（三阶段重构的第一阶段）
**Task ID**: LUM-N（待分配）

## 1. 背景与动机

### 1.1 起因

用户发起全库重构，经过诊断扫描后识别出三个候选方向：

1. Sprint 域分层违规（service 直接访问 Prisma）
2. God component 拆分（`MyTasksPage.tsx` 1131 行、`SprintTasksView.tsx` 1078 行）
3. API Route 里的 Prisma 引用清理

初筛后 **③ 判定为误报**（均为纯类型导入 `import type { Prisma }`，非分层违规）。② 被推迟到独立的 P2/P3 阶段（UI 重构风险与后端重构性质完全不同，必须分离）。本 spec 只覆盖 **①：Sprint 域分层修复 + 测试补齐 + `any` 收敛**。

### 1.2 诊断结果（精确版）

真实 Prisma 分层违规 20 处，分布：

| 文件                                           | LOC | 违规数 | 细分                                                                                                                                                                                                                             |
| ---------------------------------------------- | --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/services/sprint.service.ts`               | 459 | 14     | 3× `prisma.team.*`（L31, L373, L405）+ 2× `prisma.task.findUnique`（L230, L269）+ 4× `prisma.$transaction`（L58, L103, L242, L281）+ 5× 事务内 `(tx as any).{task,taskActivity,generationJob}.*`（L110, L159, L190, L251, L286） |
| `lib/services/sprint-summary.service.ts`       | 105 | 5      | `prisma.generationJob.findFirst` + `prisma.task.findMany` + `prisma.taskActivity.findMany` + 2× `prisma.generationJob.update`                                                                                                    |
| `lib/services/sprint-notifications.service.ts` | 36  | 1      | `prisma.teamMember.findMany`                                                                                                                                                                                                     |

Sprint 域 `any` 分布 9 处（含 1 处 `as unknown as`）：全部可以在分层修复的过程中顺手消除或主动收敛。

Service 单测覆盖现状：0。（代码库总共 123 个测试文件，但 40 个 service 文件中只有 `document` 和 `notification` 有单元测试。）

### 1.3 违反的约定

CLAUDE.md "Layered Architecture" 明确规定：

| 层         | 禁止                           |
| ---------- | ------------------------------ |
| Service    | 不直接访问 Prisma，不处理 HTTP |
| Repository | 不含业务逻辑、不做权限校验     |

当前 sprint 域 service 同时违反了第一条的字面约束。本 spec 将**恢复字面约束**，同时承认 "service 持有事务边界" 的既有实践（见 §3.2）。

## 2. 目标与非目标

### 2.1 In Scope

1. **新建** `lib/repositories/team.repository.ts`（3 个方法）。
2. **新建** `lib/repositories/sprint-notifications.repository.ts`（1 个方法）。
3. **新建** `lib/db/errors.ts`（Prisma 错误类型守卫）。
4. **扩展** 5 个既有 repository：`sprint.repository.ts`、`sprint-summary.repository.ts`、`task.repository.ts`、`activity.repository.ts`、`generation-job.repository.ts` —— 只新增方法，不改既有方法签名。
5. **改造** 3 个 service：移除所有 `import { prisma }`，所有 Prisma 调用替换为 repository 方法。
6. **新建** 3 个 Jest 测试文件：`__tests__/services/sprint.test.ts`、`sprint-summary.test.ts`、`sprint-notifications.test.ts`，约 45 个用例，行覆盖 ≥ 90%。
7. **收敛** Sprint 域 `any`：从 9 处降为 0（允许在 spec review 时豁免个别，需注释说明原因）。

### 2.2 Out of Scope

- ❌ 其他 service 的分层违规（非 sprint 域）
- ❌ God component 拆分（`MyTasksPage`、`SprintTasksView`）—— 留给 P2/P3
- ❌ `app/api/**/route.ts` 修改 —— 已验证全是类型导入
- ❌ 不新建 / 不修改 Prisma schema；不改 migration
- ❌ **三个 service 的公共导出 API 签名不变**（`sprintService.*`、`sprintSummaryService.*`、`dispatchSprintNotification` 的入参、返回、抛错类型字节级一致）
- ❌ 不合并三个 service 文件；不做领域重命名
- ❌ 不修改 `task.repository.ts`、`activity.repository.ts`、`generation-job.repository.ts` 的既有方法（只加新方法）
- ❌ 不改全局 tsconfig（不开 `noImplicitAny`、`useUnknownInCatchVariables`）
- ❌ 不为 repository 层写单测（独立项目）
- ❌ 不做 e2e / playwright 测试

## 3. 架构决策

### 3.1 Repository 组织：每 service 配一个 repository

选项评估（决策 **B**）：

- **A. 单 sprint.repository.ts 扩容所有方法** — 文件膨胀到 400+ 行，驳回。
- **B. 每 service 配一个 repository**（选中）— 与现有 `task.service.ts` + `task.repository.ts` 对齐，边界清晰。
- **C. 按查询维度分** — 与项目既有按 service 一对一模式不一致，驳回。

### 3.2 事务模式：Repository 层封装（D2+）

**关键决策翻转**：在 brainstorming 初期推荐了 `withTransaction` helper（D3 方案），但扫描现有 `lib/repositories/` 后发现：

- 6 个既有 repository（task、invite、document、tag、workspace、project）共 13 处 `prisma.$transaction` **全部在 repository 层**
- 没有 `withTransaction` helper
- 跨领域协作通过 `tx: Prisma.TransactionClient` 参数完成（如 `sprint.repository.ts:95` 的 `lockForUpdate(tx, sprintId)`、`task.repository.ts:295,308` 的 `tx?` 参数）

最终选择 **D2+**：沿用现有模式 —— 大业务操作（`startSprint` / `closeSprint` / `addTaskToSprint` / `removeTaskFromSprint`）作为 `sprint.repository.ts` 的原子方法，内部 `prisma.$transaction`；跨领域查询通过对应 repository 方法的 `tx?` 参数协作。

**统一约定**：所有**新增**的 repository 方法签名一律是 `method(args, tx?: Prisma.TransactionClient)`，内部 `const client = tx ?? prisma`。既有的 `lockForUpdate(tx, sprintId)`（tx 必填）保持原签名，不破坏兼容。

### 3.3 Team 查询归属：新建 team.repository.ts

`lib/repositories/` 下无 `team.repository.ts`。`sprint.service.ts` 需要查 `Team` 实体 3 次：读 `sprintsEnabled`、更新 cadence 字段、读 cadence 配置。

选项评估（决策 **T1**）：

- **T1. 新建 team.repository.ts**（选中）— 与现有 29 个细粒度 repository 同级；为未来 Team 相关重构留入口；约 60 行。
- **T2. 塞进 sprint.repository.ts** — `sprint.repository` 查 Team 表违反按实体分 repo 原则。
- **T3. 塞进 member.repository.ts** — 查 Team 本身而非 Member 关系，不合理。

### 3.4 事务内的错误处理

`sprint.service.ts` 目前用 `httpError(status, msg)`（`Object.assign(new Error(msg), { status })`）。事务内把校验逻辑下沉到 repository 后，repository 方法也会 throw `httpError`。

选项评估（决策 **a**）：

- **a. Repository 直接 throw httpError**（选中）— 沿用项目既有风格；`httpError` 本质只是带 status code 的 Error，repository 感知 HTTP 语义的成本小于改用 Result 类型的复杂度。
- **b. Repository 返回 Result 类型** — 需要新建 Result 类型，调用方繁琐，驳回。

### 3.5 Stats 聚合归属：下沉到 repository

`sprint-summary.service.ts` L38-L71 的 stats 计算（分组统计、spillover 计数）是纯数据逻辑。下沉到 `sprintSummaryRepository.computeStatsData(sprintId)` 后：

- Service 的 `generate` 方法从 ~80 行瘦到 ~30 行，只剩 LLM 编排 + save + job 状态更新
- Stats 计算有独立的测试入口（虽然 repository 测试 out of scope，但至少结构上允许）

### 3.6 错误类型守卫：新建 lib/db/errors.ts

两处 `catch (err: any)` 都在做 `err?.code === 'P2002'` 检查。新建 `lib/db/errors.ts` 提供 `isPrismaUniqueViolation(err: unknown): boolean`，让 service 侧 `catch (err)` 不带类型注解。

**只实现本次用到的 P2002**（YAGNI）；未来其他域重构可复用并扩展。

## 4. 文件改动清单

### 4.1 新建（3 个文件）

| 文件                                                  | 内容                                                                                                      | 预估 LOC |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `lib/repositories/team.repository.ts`                 | `findSprintGatingConfig(teamId)`、`updateSprintCadence(teamId, input)`、`findSprintCadenceConfig(teamId)` | ~60      |
| `lib/repositories/sprint-notifications.repository.ts` | `findTeamActorIds(teamId)` — 返回已去重的 `string[]`                                                      | ~25      |
| `lib/db/errors.ts`                                    | `isPrismaUniqueViolation(err: unknown): boolean`（P2002 only）                                            | ~30      |

### 4.2 扩展既有 repository（5 个文件）

| 文件                           | 新增方法                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprint.repository.ts`         | `startAtomically(sprintId)`、`closeAtomically(sprintId, decisions, actorId)`、`addTaskAtomically(taskId, sprintId, actorId)`、`removeTaskAtomically(taskId, actorId)` |
| `sprint-summary.repository.ts` | `computeStatsData(sprintId)`                                                                                                                                          |
| `task.repository.ts`           | `findMinimalById(taskId, tx?)`、`findUnfinishedBySprint(sprintId, tx)`、`listBySprintForStats(sprintId, tx?)`                                                         |
| `activity.repository.ts`       | `createSprintChanged(input, tx)`、`createManySprintChanged(inputs, tx)`、`listSpilloverFromSprint(sprintId, tx?)`                                                     |
| `generation-job.repository.ts` | `findPendingSprintJob(sprintId, tx?)`、`markCompleted(jobId, summaryId, tx?)`、`markFailed(jobId, tx?)`、`createSprintPending(sprintId, tx)`                          |

### 4.3 改造 service（3 个文件）

| 文件                              | 改动                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprint.service.ts`               | 移除 `import { prisma }`；9 处主调用 + 5 处事务内 `(tx as any).*` 全部替换；`$transaction` 边界下沉到 `sprint.repository.*Atomically` 方法；2 处 `catch (err: any)` 改用 `isPrismaUniqueViolation`。 |
| `sprint-summary.service.ts`       | 移除 `import { prisma }`；5 处 Prisma 调用下沉；stats 聚合下沉到 `sprintSummaryRepository.computeStatsData`；移除 `as unknown as Prisma.InputJsonValue`（repository 内部吃掉）。                     |
| `sprint-notifications.service.ts` | 移除 `import { prisma }`；1 处替换为 `sprintNotificationsRepository.findTeamActorIds`。                                                                                                              |

### 4.4 新建测试（3 个文件）

| 文件                                              | 用例数 | 覆盖范围                                          |
| ------------------------------------------------- | ------ | ------------------------------------------------- |
| `__tests__/services/sprint.test.ts`               | ~43    | 9 个公共方法的主路径 + 错误路径                   |
| `__tests__/services/sprint-summary.test.ts`       | 6      | generate 的成功/失败路径 + pendingJob 存在/不存在 |
| `__tests__/services/sprint-notifications.test.ts` | 4      | dispatch 的去重、空收件人、两种 type              |

## 5. 逐处 Prisma 调用映射

### 5.1 `sprint.service.ts`（14 处）

| 行号 | 当前调用                                     | 目标 repository 方法                                             |
| ---- | -------------------------------------------- | ---------------------------------------------------------------- |
| L31  | `prisma.team.findUnique({sprintsEnabled})`   | `teamRepository.findSprintGatingConfig(teamId)`                  |
| L58  | `prisma.$transaction` (start)                | `sprintRepository.startAtomically(sprintId)`                     |
| L103 | `prisma.$transaction` (close)                | `sprintRepository.closeAtomically(sprintId, decisions, actorId)` |
| L110 | `(tx as any).task.findMany`                  | `taskRepository.findUnfinishedBySprint(sprintId, tx)`            |
| L159 | `(tx as any).taskActivity.createMany`        | `activityRepository.createManySprintChanged(inputs, tx)`         |
| L190 | `(tx as any).generationJob.create`           | `generationJobRepository.createSprintPending(sprintId, tx)`      |
| L230 | `prisma.task.findUnique({sprintId, teamId})` | `taskRepository.findMinimalById(taskId)`                         |
| L242 | `prisma.$transaction` (addTaskToSprint)      | `sprintRepository.addTaskAtomically(taskId, sprintId, actorId)`  |
| L251 | `(tx as any).taskActivity.create`            | `activityRepository.createSprintChanged(input, tx)`              |
| L269 | `prisma.task.findUnique({sprintId})`         | `taskRepository.findMinimalById(taskId)`                         |
| L281 | `prisma.$transaction` (removeTaskFromSprint) | `sprintRepository.removeTaskAtomically(taskId, actorId)`         |
| L286 | `(tx as any).taskActivity.create`            | `activityRepository.createSprintChanged(input, tx)`              |
| L373 | `prisma.team.update(cadence fields)`         | `teamRepository.updateSprintCadence(teamId, input)`              |
| L405 | `prisma.team.findUnique(cadence)`            | `teamRepository.findSprintCadenceConfig(teamId)`                 |

**注意**：`startAtomically` 和 `closeAtomically` 会吸收事务内的 `httpError` 调用（§3.4 决策 **a**），在 repository 方法里直接 throw `Object.assign(new Error(msg), { status })`。

### 5.2 `sprint-summary.service.ts`（5 处）

| 行号 | 当前调用                                                 | 目标方法                                                  |
| ---- | -------------------------------------------------------- | --------------------------------------------------------- |
| L32  | `prisma.generationJob.findFirst({type:sprint, pending})` | `generationJobRepository.findPendingSprintJob(sprintId)`  |
| L38  | `prisma.task.findMany({sprintId})`                       | 被 `sprintSummaryRepository.computeStatsData` 吸收        |
| L49  | `prisma.taskActivity.findMany(SPRINT_CHANGED)`           | 被 `sprintSummaryRepository.computeStatsData` 吸收        |
| L88  | `prisma.generationJob.update({completed})`               | `generationJobRepository.markCompleted(jobId, summaryId)` |
| L97  | `prisma.generationJob.update({failed})`                  | `generationJobRepository.markFailed(jobId)`               |

### 5.3 `sprint-notifications.service.ts`（1 处）

| 行号 | 当前调用                                      | 目标方法                                                 |
| ---- | --------------------------------------------- | -------------------------------------------------------- |
| L16  | `prisma.teamMember.findMany(member.actor.id)` | `sprintNotificationsRepository.findTeamActorIds(teamId)` |

## 6. 类型改进

### 6.1 `any` 收敛清单

| 位置                           | 现状                                        | 收敛方式                                                                                                                 |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sprint.service.ts:75`         | `catch (err: any)`                          | `catch (err)` + `isPrismaUniqueViolation(err)`                                                                           |
| `sprint.service.ts:110`        | `(tx as any).task.findMany`                 | ✂️ 自动消失（下沉到 `taskRepository.findUnfinishedBySprint`）                                                            |
| `sprint.service.ts:114`        | `(t: any) => t.id`                          | ✂️ 自动消失（repository 返回类型明确）                                                                                   |
| `sprint.service.ts:159`        | `(tx as any).taskActivity.createMany`       | ✂️ 自动消失                                                                                                              |
| `sprint.service.ts:190`        | `(tx as any).generationJob.create`          | ✂️ 自动消失                                                                                                              |
| `sprint.service.ts:251`        | `(tx as any).taskActivity.create`           | ✂️ 自动消失                                                                                                              |
| `sprint.service.ts:286`        | `(tx as any).taskActivity.create`           | ✂️ 自动消失                                                                                                              |
| `sprint.service.ts:450`        | `catch (err: any)`                          | `catch (err)` + `isPrismaUniqueViolation(err)`                                                                           |
| `sprint.repository.ts:110`     | `filter.status as any`                      | 改参数类型 `filter: { status?: TaskStatus }`（从 `@prisma/client` 导入 `TaskStatus`）                                    |
| `sprint-summary.service.ts:82` | `stats as unknown as Prisma.InputJsonValue` | Service 不碰 `InputJsonValue`；`sprintSummaryRepository.save` 入参类型 `stats: SprintStats`，repository 内部做 JSON 转换 |

**结果：9 处全部消除**（6 处自动消失 + 3 处主动收敛）。

### 6.2 新代码类型规范

- Repository 新增方法**不得出现 `any` / `as any`**
- Repository 新增方法必须有显式入参类型
- 返回类型靠 Prisma 推断；如果 service 消费 `select` / `include` 的返回，提取为 exported type（如 `export type UnfinishedTaskForSprint = ...`）
- `tx?: Prisma.TransactionClient` 统一签名
- Service 的 `catch (err)` 不带类型注解（遵循 TS 默认 `unknown`）

## 7. 测试计划

### 7.1 策略

- `jest.mock('@/lib/repositories/{team,sprint,sprint-summary,sprint-notifications,task,activity,generation-job}.repository')`
- Mock `@/lib/services/sprint-notifications.service`（`sprint.test.ts` 中 mock `dispatchSprintNotification`）
- Mock `@/lib/services/sprint-summary.service`（`sprint.test.ts` 中 mock `generate`）
- 不连真实 DB；集成路径由现有 `__tests__/api/**` 覆盖
- 对齐既有 `__tests__/services/document.test.ts` 或 `notification.test.ts` 的风格（实现阶段核实并采纳，若发现它们采用真实 DB，则改为真实 DB 策略，**但保持 spec 定义的用例清单不变**）

### 7.2 `sprint.test.ts` 用例（~43 个）

| 方法                   | 用例                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createDraft`          | ✅ 成功创建；❌ 404 team not found；❌ 409 sprintsEnabled=false；❌ 400 缺 startDate/endDate                                                                                                                 |
| `start`                | ✅ DRAFT → ACTIVE；❌ 404；❌ 409 非 DRAFT；❌ 409 已有 ACTIVE；✅ 触发 dispatchSprintNotification                                                                                                           |
| `close`                | ✅ ACTIVE → CLOSED + spillover；❌ 404；❌ 409 非 ACTIVE；❌ 400 decision 缺失；❌ 409 sprint membership changed；❌ 409 无 DRAFT 接 spillover；✅ moveToNext/backToBacklog 正确调用；✅ 触发 summary + 通知 |
| `addTaskToSprint`      | ✅ 跨 sprint 移动；❌ 404 task；❌ 404 sprint；❌ 400 team 不一致；❌ 409 sprint CLOSED；✅ 同 sprint 幂等                                                                                                   |
| `removeTaskFromSprint` | ✅ 移除；✅ task 无 sprint 直接 return；❌ 404 task；❌ 409 sprint CLOSED                                                                                                                                    |
| `updateMeta`           | ✅ 改名；✅ 改日期；❌ 404；❌ 400 endDate <= startDate；❌ 409 日期重叠                                                                                                                                     |
| `remove`               | ✅ 任意状态可删；❌ 404                                                                                                                                                                                      |
| `configureCadence`     | ✅ 只传 enabled；✅ 传全部 cadence 字段；✅ 未传字段保持不变                                                                                                                                                 |
| `ensureFutureSprints`  | ✅ 缺口时创建；✅ 已满额 no-op；✅ sprintsEnabled=false no-op；✅ sprintAutoCreate=0 no-op；✅ P2002 竞态静默退出                                                                                            |

### 7.3 `sprint-summary.test.ts` 用例（6 个）

- ✅ 成功路径：closed sprint → computeStats → LLM → save → markCompleted
- ✅ 无 pendingJob 时仍成功 save（不调 markCompleted）
- ❌ 404 sprint
- ❌ 400 sprint 非 CLOSED
- ✅ LLM 抛错时调 markFailed 后再抛（pendingJob 存在）
- ✅ LLM 抛错且无 pendingJob 时直接抛

### 7.4 `sprint-notifications.test.ts` 用例（4 个）

- ✅ 调 findTeamActorIds → 调 notificationRepository.createMany
- ✅ 空 actor 列表时直接 return
- ✅ SPRINT_STARTED / SPRINT_CLOSED 两种 type 各一个
- ✅ triggerActorId 为 null

## 8. 验收标准

### 8.1 Structural

- [ ] 新建文件存在：`team.repository.ts`、`sprint-notifications.repository.ts`、`lib/db/errors.ts`、3 个测试文件
- [ ] Sprint 域 service 不再 import prisma：
  ```bash
  grep -E "from ['\"]@/lib/db/prisma['\"]" lib/services/sprint*.ts   # 必须为空
  ```
- [ ] Sprint 域 service 不再出现 `prisma.` 调用：
  ```bash
  grep -E "\bprisma\." lib/services/sprint*.ts                        # 必须为空
  ```
- [ ] 事务内部不再 `tx as any`：
  ```bash
  grep -E "\(tx as any\)" lib/services/sprint*.ts                     # 必须为空
  ```

### 8.2 Type safety

- [ ] Sprint 域 `any` 归零：
  ```bash
  grep -E ":\s*any\b|\bas\s+any\b" \
    lib/services/sprint*.ts \
    lib/repositories/sprint*.ts \
    lib/repositories/team.repository.ts \
    lib/repositories/sprint-notifications.repository.ts              # 必须为空
  ```
- [ ] `npx tsc --noEmit` 通过

### 8.3 Tests

- [ ] 三个新测试文件全部通过
- [ ] 三个 service 文件行覆盖 ≥ 90%、分支覆盖 ≥ 85%
- [ ] `npm test` 全量不退步（既有红 suite 保持原状，不新增红 suite）

### 8.4 Behavior preservation

- [ ] 三个 service 的公共导出签名字节级不变（`git diff` 中 export 行无 +/-）
- [ ] 手动回归 3 个场景：
  1. 创建 DRAFT → start → add task → close（moveToNext）→ summary 生成
  2. 配置 cadence（切 sprintsEnabled、调 duration）→ 刷新验证 auto-create
  3. 触发 SPRINT_STARTED → 核对收件人列表与原实现一致

### 8.5 Non-regression

- [ ] 其他 service（`task-notifications.service.ts`、`lib/mcp/**` 等）一行未改
- [ ] `task.repository.ts`、`activity.repository.ts`、`generation-job.repository.ts` 的既有方法签名和实现不变（只新增方法）

### 8.6 Git hygiene

- [ ] 分支名：`lumo/LUM-N-sprint-layer-refactor`
- [ ] Commit 拆分（细化到 plan 阶段）：
  1. `feat(repositories): add team, sprint-notifications, errors helpers`
  2. `refactor(repositories): extend sprint/task/activity/generation-job with tx-aware methods`
  3. `refactor(services): sprint.service.ts bypass prisma via repositories`
  4. `refactor(services): sprint-summary.service.ts bypass prisma`
  5. `refactor(services): sprint-notifications.service.ts bypass prisma`
  6. `test(services): add jest specs for sprint/sprint-summary/sprint-notifications`
- [ ] PR title：`refactor(sprint): sink Prisma to repository layer + add service tests [LUM-N]`
- [ ] PR 描述遵循 CLAUDE.md checklist（tests、tsc、commit 规范、无新增 npm 包等）

## 9. 风险与缓解

| 风险                                                                                              | 可能性 | 影响         | 缓解                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| 事务内跨 repository 方法忘记传 `tx`，导致事务外查询+事务内写，锁不住行                            | 中     | 数据一致性   | §5 映射表强制每个事务内调用都明确 `tx` 参数；code review 时逐行核对；`lockForUpdate(tx, ...)` 的既有约定已帮忙卡位 |
| `startAtomically` / `closeAtomically` 吃错误语义（把 service 的 httpError 改成其他错误）          | 中     | 前端展示破损 | 测试里断言 `error.status === 409` 等具体 status；手动回归 3 个场景                                                 |
| Mock repository 风格与现有 `document.test.ts` 不一致                                              | 低     | 维护成本     | 实现前先读 `document.test.ts` / `notification.test.ts`，按其风格对齐                                               |
| `sprintSummaryRepository.save` 吃 `SprintStats` 导致 `Prisma.InputJsonValue` 类型冲突             | 低     | tsc 报错     | Repository 内部用 `stats as Prisma.InputJsonValue`（隔离在 repository 层，service 端干净）                         |
| P2 / P3 的 god component 重构如果要复用某些 sprint repository 方法，本次签名太贴合 service 的需求 | 低     | 未来小改     | 可接受 —— YAGNI，等 P2/P3 真有需求再加方法                                                                         |

## 10. Rollback

- 本 spec 只改 `lib/`、`__tests__/`，不改 schema、migration、env、CI
- 回滚：`git revert` 对应的 6 个 commit
- 无数据层变更，回滚后数据正常

## 11. 后续阶段预告

| 阶段              | 范围                                | 估工      | 备注                       |
| ----------------- | ----------------------------------- | --------- | -------------------------- |
| **P1（本 spec）** | Sprint 域分层修复 + 补测试 + 收 any | ~1.5-2 天 | 当前进行                   |
| **P2**            | 拆 `MyTasksPage.tsx`（1131 行）     | ~1-2 天   | P1 落地后独立立项，新 spec |
| **P3**            | 拆 `SprintTasksView.tsx`（1078 行） | ~1-2 天   | P2 落地后独立立项，新 spec |

每个阶段独立 spec → plan → 实现 → review → merge 循环。
