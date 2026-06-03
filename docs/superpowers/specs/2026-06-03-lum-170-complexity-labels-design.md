# LUM-170 · 事后复杂度标签:从执行数据沉淀复杂度信号

**Status**: Design approved (2026-06-03)
**Branch**: `lumo/LUM-170-complexity-labels`
**Milestone**: Sprint 能力增强
**Feeds**: LUM-171 (交付预测 / retrieval)

## 哲学

事前不让人猜大小,事后用真实结果定义大小。不做传统估算(故事点/工时已否)。
从已完成任务的真实 agent 执行数据派生数据驱动的复杂度标签,作为 LUM-171 检索预测的数据底座。

> 注:定价侧 Merged PR 的 S/M/L 分级是同源哲学的另一面,但其枚举在**计费系统**,本仓库 grep 不到——**不复用其枚举**。

## 边界(本任务 = 沉淀侧 only)

- ✅ 本任务交付:Prisma schema + 写路径(DONE 沉淀)+ 读/分桶模块(纯函数)+ 单测。
- ❌ 不在本任务:跨任务检索、预测区间、UI、CLI、API route —— 全部归 LUM-171。
- 验证手段:Jest 单测覆盖写路径聚合逻辑与纯分桶函数(无用户界面可走 preview)。

## 核心决策(brainstorm 已定)

| 维度 | 决策 |
|---|---|
| 标签形式 | **相对分位桶**(low/med/high),不设魔法绝对阈值 |
| 纳入信号 | **总执行时长**(durationMs 求和)+ **变更文件数**(去重并集)。**排除** agent 轮次、澄清轮次 |
| 存什么 | **存不可变原始信号**;复合分数与桶都在**读时**对当前分布算出 |
| 触发点 | 任务进入 **DONE**(`task-state.service` 现有钩子旁,`waitUntil()` 后台写) |
| 分布范围 | **teamId**(任务编号同源;非 project) |
| 桶切分 | 3 桶,**P33 / P66**,两信号**等权** |
| 小样本守卫 | cohort 有效样本 `< 5` → 返回 `null`(insufficient_data) |
| 存储形态 | 独立 model `TaskComplexity`(1:1 Task),不污染热点 Task 行 |

## 1. 数据模型

新增 `TaskComplexity`,沿用 `*Summary` 独立 model 模式:

```prisma
model TaskComplexity {
  id               String   @id @default(cuid())
  taskId           String   @unique
  teamId           String   // 分位分布的范围键
  totalDurationMs  Int      // 所有 finished AgentRun 的 durationMs 求和
  changedFileCount Int      // 各 run changedFiles 去重并集的大小
  agentRunCount    Int      // 上下文用,不进复合分(轮次已被排除)
  computedAt       DateTime @default(now())
  task             Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)

  @@index([teamId])
  @@map("task_complexities")
}
```

- Task 侧加反向关系 `complexity TaskComplexity?`。
- **迁移**:含新表/新列。PR 描述须注明 `requires \`prisma migrate deploy\` on next deploy`;
  本仓库有 CI 跳过 migrate 导致生产 schema 漂移的历史坑,合并后须确认生产已迁移。

## 2. 写路径(沉淀)

**触发**:`lib/services/task-state.service.ts` 现有 DONE 钩子(`updateTaskWithSideEffects`,
status 变为 DONE 处)旁,并排加一个 `waitUntil()`:

```ts
if (result.changedFields.includes('status') && input.status === 'DONE') {
  // ...既有 layer2 固结...
  waitUntil(taskComplexityService.sedimentForTask(taskId))
}
```

**`sedimentForTask(taskId)`**(`lib/services/task-complexity.service.ts`):

1. 经 repository 取该 task 所有 `finishedAt != null` 的 AgentRun(字段:`durationMs`、`changedFiles`)。
2. 聚合:
   - `totalDurationMs` = Σ `durationMs`(忽略 null)
   - `changedFileCount` = `|⋃ changedFiles|`(跨 run 去重并集后计数)
   - `agentRunCount` = 计入聚合的 run 数
3. **资格门槛**:无任何带信号的 run(`agentRunCount === 0` 或两信号皆为 0/空)→ **不写行**(纯人工任务不沉淀;零信号 = "无数据",不是"极低复杂度",不能污染分布)。
4. **upsert** `TaskComplexity`(by `taskId`):reopen 后再次 DONE 会重算覆盖,拿到新增的 run。

实现注意:本 service 仅触 Prisma,**不引入 AI SDK gateway**,可用静态 import(无 jest TransformStream 陷阱)。
副作用在 `waitUntil` 内自捕获,失败不回灌 API 响应。

## 3. 读路径 / 分桶(本任务的"大脑")

**Repository** `lib/repositories/task-complexity.repository.ts`:
- `upsert(data)` —— 写路径用。
- `findByTaskId(taskId)` —— 取单行。
- `listByTeam(teamId)` —— 取 cohort(全 team 的已沉淀行),供分桶。

**纯函数** `lib/complexity/bucket.ts`(无 IO,完全可单测):

```ts
type Bucket = 'low' | 'med' | 'high'
type Signals = { totalDurationMs: number; changedFileCount: number }

// cohort = team 内所有已沉淀 signals(含 target 自身)
function bucketComplexity(
  target: Signals,
  cohort: Signals[],
  opts?: { minSample?: number } // 默认 5
): { bucket: Bucket; score: number } | { bucket: null; reason: 'insufficient_data' }
```

算法:
1. 有效样本数 `< minSample(=5)` → `{ bucket: null, reason: 'insufficient_data' }`。
2. 对 `totalDurationMs`、`changedFileCount` **各自**在 cohort 内算 percentile rank ∈ [0,1]。
3. 复合分位 `score` = 两 rank **等权平均**(等权 = 无魔法权重)。
4. 落桶:`score < 1/3 → low`、`< 2/3 → med`、`else → high`。

percentile rank 定义:`rank = (#{x in cohort : x < v} + 0.5·#{x == v}) / N`(并列取中点,避免边界突变)。

## 4. 分层归属(照 sprint-summary 链路)

| 层 | 文件 |
|---|---|
| Repository | `lib/repositories/task-complexity.repository.ts` |
| Service | `lib/services/task-complexity.service.ts`(`sedimentForTask`) |
| 纯逻辑 | `lib/complexity/bucket.ts`(`bucketComplexity`) |
| 触发接线 | `lib/services/task-state.service.ts`(DONE 钩子加一行) |

无 zod schema / 无 API route / 无 CLI(沿 scope;LUM-171 再加消费侧)。

## 5. 测试(Jest,SWC,mock Prisma;`cd` 进 worktree 跑)

**`sedimentForTask`**:
- 多 run:`durationMs` 求和正确;`changedFiles` 跨 run 去重并集计数正确。
- 含 `finishedAt == null` 的 run 被排除。
- 无信号任务(无 run / 全空)→ 不 upsert。
- reopen→再 DONE → upsert 覆盖,反映新 run。

**`bucketComplexity`**:
- P33 / P66 边界落桶。
- 单信号极端(时长巨大但文件极少)被等权中和,不被单信号主导。
- cohort `< 5` → `null` + `insufficient_data`。
- 并列值(相同 signals)分位取中点,落桶稳定。

## 6. 收尾检查

- `npx prisma generate` 后 `npx tsc --noEmit`(注意 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`)。
- PR 标题:`feat: 事后复杂度标签从执行数据沉淀 [LUM-170]`;描述注明新迁移需 `migrate deploy`。
