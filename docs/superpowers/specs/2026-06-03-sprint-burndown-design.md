# Sprint 燃尽图:基于活动流重建每日剩余 — 设计文档

**Task**: LUM-169
**Milestone**: Sprint 能力增强
**Date**: 2026-06-03
**Status**: Approved (design)

## 背景

当前 `SprintStats`(`lib/repositories/sprint-summary.repository.ts`)只在 sprint
**关闭时**算一个静态聚合快照(total / done / spillover / byPriority /
byAssignee),没有任何时间序列。本任务用 `TaskActivity` 流里带 `createdAt` 的
`STATUS_CHANGED` 与 `SPRINT_CHANGED` 事件,**重建每日剩余任务数**,在 sprint 详情页
画出燃尽趋势(actual)与一条理想参考线(ideal)。

**无需 schema 改动** —— 纯读现有活动流。本任务只做**按任务条数**燃尽;按工作量燃尽
依赖估算字段,属另一个任务。

## 已确认的产品决策

1. **覆盖范围**:ACTIVE **与** CLOSED 两种 sprint 都支持。DRAFT 不展示(未开始,无趋势)。
2. **图表方案**:**手写 SVG 折线组件**,不引入任何图表库(仓库当前无 recharts/chart.js/visx/d3)。
3. **理想线**:画。从「start 当天的 remaining」直线降到 end 当天的 0。
4. **单位**:任务条数(`unit: 'tasks'`)。

## 核心算法:后向事件回放

### 难点

活动流只记录**变化**而非快照。任务在 sprint 周期内会进出(`SPRINT_CHANGED`)、状态来回变
(`STATUS_CHANGED`)。要从「当前状态 + 变化事件」反推**任意时刻**的状态。

### 阶梯函数(后向回放)

对每个候选任务,基于事件 + 当前值定义两个时间阶梯函数:

- **`sprintAt(T)`** = `createdAt <= T` 的最后一条 `SPRINT_CHANGED` 的 `toSprintId`;
  - 若 T 早于该任务所有 `SPRINT_CHANGED` → 取**最早**一条的 `fromSprintId`(即首次变化前的归属);
  - 若该任务**完全没有** `SPRINT_CHANGED` → 回退到 `task.sprintId`(当前值)。
- **`statusAt(T)`** = 同理,基于 `STATUS_CHANGED` 的 `{ from, to }`;
  - 若 T 早于所有 `STATUS_CHANGED` → 取最早一条的 `from`(初始状态);
  - 若完全没有 `STATUS_CHANGED` → 回退到 `task.status`。

**为什么后向回放**:它能干净处理"任务直接创建进 sprint、从未产生 `SPRINT_CHANGED`"这类
边界(回退到当前 `task.sprintId`),而前向重建需要可靠的初始快照,活动流不保证有。

### 每日剩余

```
remaining(D) = count( candidate task t where
                        sprintAt(endOfDay D) == sprintId
                     && statusAt(endOfDay D) != DONE )
```

`endOfDay D` 取该日 UTC 23:59:59.999(见时区决策)。

### 候选任务集

```
candidates = { task | task.sprintId == sprintId }                    -- 当前在册
           ∪ { task | ∃ SPRINT_CHANGED with from==sprintId or to==sprintId }  -- 曾进出
```

两部分并集既覆盖当前还在 sprint 里的,也覆盖已 spillover/手动移出的任务,避免漏算
"曾经占用过 sprint 容量、后来离开"的任务。

### 边界默认值

1. **按天分桶用 UTC**。v1 不做 workspace 时区(确定、可测;时区作为后续任务)。
2. **终点**:
   - CLOSED:终点取 `sprint.endDate`;actual 线画到 `min(endDate, today)`。
   - ACTIVE:理想线画满 `start → end`;actual 线只画到**今天**,未来日 `remaining = null`。
3. **理想线**:从「`series[0].remaining`(start 当天剩余)」线性降到 end 当天 0;
   只有 1 天时退化为该值。
4. **空数据**:无候选任务 → `series` 仍按日期填充,`remaining`/`ideal` 全 0,
   前端渲染空图占位文案。

## 分层(遵循 CLAUDE.md 数据流)

| 层             | 新增/改动                                                                 | 职责                                                                                                                         | 禁止                                  |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **纯函数**     | `lib/services/sprint-burndown.ts` → `computeBurndownSeries(input)`        | 无 Prisma 的回放算法,**单元测试主战场**                                                                                      | 不访问 DB、不读时钟(`now` 从参数传入) |
| **Repository** | `lib/repositories/sprint-burndown.repository.ts` → `loadInputs(sprintId)` | 拉候选任务(id/sprintId/status)+ 相关 `STATUS_CHANGED`/`SPRINT_CHANGED` 活动(taskId/type/payload/createdAt),`select` 收窄字段 | 不含业务逻辑                          |
| **Service**    | `lib/services/sprint-burndown.service.ts` → `compute(sprintId, now)`      | 编排 repo + 纯函数,sprint 存在性/权限校验,DRAFT 拒绝                                                                         | 不直接 Prisma、不处理 HTTP            |
| **API Route**  | `app/api/sprints/[sprintId]/burndown/route.ts` (GET)                      | 薄:auth → service → response;DRAFT/404 返回恰当状态                                                                          | 无业务逻辑、无 Prisma                 |
| **API Client** | `lib/api-client/` sprints client 增 `burndown(sprintId)`                  | 封装 fetch + 类型                                                                                                            | 无 UI 逻辑                            |
| **Hook**       | `useSprintBurndown(sprintId)`                                             | 数据获取状态管理                                                                                                             | ——                                    |
| **Component**  | `app/workspace/[workspaceUrl]/sprints/components/SprintBurndownChart.tsx` | 渲染 SVG 折线(actual)+ 理想线 + 坐标轴 + 空态;插在 `SprintSidebar` 与 `RetroPanel` 之间                                      | 不直接 fetch、不含算法                |

**纯函数与 service 分离**是关键的可测性/SRP 收益:回放逻辑用手构 activity 数组做单元
测试,完全不碰 Prisma 或时钟。

## 数据契约

```ts
// GET /api/sprints/[sprintId]/burndown
interface SprintBurndownResponse {
  sprintId: string
  start: string // 'YYYY-MM-DD' (UTC)
  end: string // 'YYYY-MM-DD' (UTC)
  unit: 'tasks'
  total: number // 理想线起点 = series[0].remaining
  series: Array<{
    date: string // 'YYYY-MM-DD'
    remaining: number | null // null = 未来日(ACTIVE),前端不连线
    ideal: number // 理想线值(每日填充)
  }>
}
```

`computeBurndownSeries` 的输入类型:

```ts
interface BurndownInput {
  sprintId: string
  startDate: Date
  endDate: Date
  status: 'ACTIVE' | 'CLOSED' // DRAFT 在 service 层已拒绝
  closedAt: Date | null
  now: Date // 注入,纯函数不读时钟
  tasks: Array<{ id: string; sprintId: string | null; status: TaskStatus }>
  activities: Array<{
    taskId: string
    type: 'STATUS_CHANGED' | 'SPRINT_CHANGED'
    payload: unknown // 运行时按 type 收窄
    createdAt: Date
  }>
}
```

## 错误处理

- **404**:sprint 不存在或不在调用者 workspace → service 抛 `{ status: 404 }`。
- **400/409**:sprint 为 DRAFT → 拒绝(无趋势可画),route 返回明确文案。
- **payload 守卫**:`STATUS_CHANGED`/`SPRINT_CHANGED` 的 `payload` 是 `Json?`,
  回放时按 type 做运行时收窄;缺字段的脏数据**跳过该事件**而非抛错(对历史数据健壮)。
- **前端**:loading / error / 空态(无候选任务)三态都渲染占位,不崩。

## 测试计划(Jest,`__tests__/`)

纯函数 `computeBurndownSeries` 为主:

1. **基础递减**:3 个任务陆续 DONE,remaining 逐日下降到 0。
2. **任务中途加入**(`SPRINT_CHANGED` to==sprint):remaining 在加入日抬升。
3. **任务中途移出**(spillover,from==sprint):remaining 在移出日下降。
4. **无 SPRINT_CHANGED 的任务**(直接创建进 sprint):靠回退到 `task.sprintId` 仍计入。
5. **状态来回变**(DONE → 重开 → 再 DONE):`statusAt` 取最后一条 `to`,某日复活。
6. **ACTIVE 未来日**:`remaining = null`,理想线仍铺满。
7. **CLOSED 终点**:actual 画到 endDate。
8. **理想线**:start 当天 = total,end 当天 = 0,线性。
9. **空 sprint**:全 0,不抛错。
10. **脏 payload**:缺字段事件被跳过,不污染结果。

repository/service 用既有 mock 模式(`jest.mock` repo)各加 1 个用例。组件用 jsdom
渲染快照验证 SVG 结构 + i18n 文案(参考 LUM-164 里 mock `react-intl` 的做法)。

## i18n

图表标题、坐标轴标签、图例(「剩余」「理想」)、空态文案等 key 加到
`lib/i18n/` 下**每一个** locale 文件,非英文提供真实翻译(不用英文兜底)。

## 非目标(YAGNI)

- 按工作量(story points)燃尽 —— 依赖估算字段,另立任务。
- workspace 时区分桶 —— v1 用 UTC。
- 燃起(scope creep)单独着色、周末跳过、速度(velocity)预测线。
- 把每日序列持久化进 `SprintSummary` —— 实时计算即可,数据量小(候选任务 × 活动)。

## CLI / Skill 同步

本任务**不改** `cli/src/commands/`(纯 web 端 + API),故无需更新
`.claude/skills/lumo/SKILL.md`。若后续决定加 `lumo sprint burndown` 子命令,再补文档。
