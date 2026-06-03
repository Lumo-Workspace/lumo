# 交付预测:基于历史执行数据检索预测区间 — 设计 [LUM-171]

- **任务**:LUM-171 — 交付预测:基于历史执行数据检索预测区间(取代事前估算)
- **Milestone**:Sprint 能力增强
- **日期**:2026-06-03
- **状态**:已批准设计,待转 writing-plans

## 1. 背景与哲学

把"估算"从事前 `generate` 翻转成事后/实时 `retrieve`,**不引入故事点抽象**。
对一个任务,检索语义相似的**已完成且有真实执行数据**的历史任务,给出
"预计 N 轮迭代 / M 个 merged PR / 大致周期"的预测区间,服务对外交付节奏。

**硬约束(可解释)**:系统里不存在隐藏点数,只暴露从历史检索出的区间,并暴露
"区间是从哪些历史任务算出来的"。否则只是把 Jira 藏起来。

信号源:`AgentRun.runNumber/durationMs/startedAt/finishedAt`、`PullRequest.state/mergedAt`。

## 2. 范围(MVP)

- **主战场:单任务预测**。在 task 详情页右栏展示该任务的交付预测面板。
- Sprint 维度聚合预测**不在 MVP**,但 service / 区间计算设计成可被后续复用。
- **无 LLM**:预测是确定性统计检索,不是生成。
- **不动 schema、无迁移、不新增 npm 包**。

## 3. 指标精确定义

对目标任务 T(项目 P 内),cohort 里每个历史任务计算:

| 指标 | 定义 | 数据源 |
|---|---|---|
| 迭代轮次 | 该任务的 AgentRun 行数(每次 run = 一轮) | `count(AgentRun where taskId)` |
| merged PR 数 | 关联的已合并 PR 数 | `count(PullRequest where taskId and state='merged')` |
| 周期(执行锚定) | 首个 `AgentRun.startedAt` → 完成时刻 | 完成时刻 = 有 merged PR 取最后一个 `mergedAt`,否则取最后一个 `AgentRun.finishedAt` |

**周期采用执行锚定**(首次跑 agent → 真正合并),而非 `task.createdAt → updatedAt`,
以排除任务在 backlog 中静置的时间——那不是执行复杂度,会污染预测。
对外展示用"天"(不足 1 天用小时)。

## 4. cohort 检索 + 区间算法

**候选集**:同项目 P 内、`status=DONE`、且至少有 1 个 AgentRun(有真实执行数据)、排除 T 自身。

**打分**:`score = 0.7 × bigram(title) + 0.3 × tagJaccard(tags)`
- `bigram` 复用 `lib/similarity.ts`;`tagJaccard` = 两任务 tag 集合的 交集/并集(任一为空集时记 0)。

**筛选**:保留 `score ≥ 0.3`,按分降序取 **top 20** 作为 cohort。

**阈值门**:cohort 有效任务 **< 3** → `insufficientData: true`,不给区间,
可选返回仅有的 ≤2 个参考任务(诚实,不编数字)。

**区间**:对 cohort 三个指标各取一组数值,算 **p25 / median(p50) / p75**(线性插值分位数)。
每个指标独立计算:
- 某任务无 merged PR 时 M 记 0,照常纳入轮次/PR/周期分布。
- 某任务无可计算的完成时刻(无 merged PR 且全部 AgentRun 的 `finishedAt` 为空)→ 其 `cycleHours`
  **不纳入周期分布**,但仍计入轮次与 merged PR 分布。因此三个指标的样本数可能不同;
  `cohortSize` 指通过筛选的任务总数,若周期样本不足 3,则 `cycleHours` 单独返回 `null`。

**返回结构**:
```ts
interface TaskForecast {
  insufficientData: boolean
  cohortSize: number
  iterations: Interval | null   // Interval = { p25: number; median: number; p75: number }
  mergedPrs: Interval | null
  cycleHours: Interval | null
  sources: ForecastSource[]      // 证据:区间从哪些任务算出
}
interface ForecastSource {
  taskId: string
  identifier: string             // `${team.identifier}-${number}`
  title: string
  iterations: number
  mergedPrs: number
  cycleHours: number
  score: number
}
```

## 5. 分层架构

严格遵循 Component → API Client → Route → Service → Repository → Prisma。

**Repository** — `lib/repositories/forecast.repository.ts`
- `loadForecastInputs(taskId)`:一次性取
  - 目标任务:`title`, `projectId`, tag 名集合
  - 同项目候选(`status=DONE`, `id≠目标`):`title`、tag 名、`agentRuns{startedAt,finishedAt}`、
    `pullRequests where state='merged'{mergedAt}`、`team.identifier` + `number`
- 纯 Prisma `select`,不含业务逻辑、不做权限校验。

**纯函数(易测,jest 不碰 Prisma)**
- `lib/forecast/score.ts` — `scoreCandidate(target, candidate): number`
- `lib/forecast/metrics.ts` — `extractMetrics(candidate): { iterations, mergedPrs, cycleHours }`
- `lib/forecast/percentile.ts` — `percentile(values, q)` 线性插值;`interval(values): Interval`

**Service** — `lib/services/forecast.service.ts`
- `getTaskForecast(taskId): Promise<TaskForecast>`:调 repo → 打分 → 过 `≥0.3`、降序 top20 →
  有效任务 `<3` 返回 `insufficientData`(带 ≤2 参考)→ 否则各指标取区间 + 拼 `sources`。
- 不直接访问 Prisma,不处理 HTTP。

**API Route** — `app/api/tasks/[id]/forecast/route.ts`(GET)
- auth + workspace 成员校验(沿用 `/api/tasks/[id]` 模式)→ `forecastService.getTaskForecast(id)` → JSON。薄路由。

**API Client** — `lib/api-client/tasks.ts` 加 `forecast(id)`;`lib/api-client/constants.ts` 加 `API.tasks.forecast`。

**Hook** — `useTaskForecast(taskId)`:react-query,懒加载(面板挂载时才请求),不阻塞详情页主体。

## 6. UI 面板

新组件 `ForecastPanel.tsx`,置于 `TaskDetailPage` 右栏、`TaskDetailSidebar` 下方
(独立只读卡片,不混入可编辑属性区)。

**正常态**(排版分层、不用彩色,遵循"靠字重/灰度建立层级"):
```
交付预测  · 基于 5 个相似已完成任务
迭代轮次   3 轮   (常见 2–4)
merged PR  1 个   (常见 1–2)
周期       2 天   (常见 1–4 天)
            ▸ 查看依据的历史任务   ← 展开列出 sources(identifier·标题·实际值)
```
**样本不足态**:`历史数据不足,暂无可靠预测`,下方可选列出仅有的 ≤2 个相似任务。
**加载态**:骨架行;**出错态**:静默隐藏。

所有文案走 `react-intl`,**每个 locale 文件都加 key**(不止 en/zh-CN)。无新颜色,token-lint 不触发。

## 7. 测试(jest)

- `percentile.ts`:奇偶长度、单元素、插值边界
- `metrics.ts`:执行锚定周期(有/无 merged PR 两条路径)、merged PR 计数、轮次计数
- `score.ts`:bigram+tagJaccard 混合、无 tag 退化
- `forecast.service.ts`:mock repo —— 阈值过滤、top20 截断、`<3` 走 insufficientData、区间数值正确、sources 排序
- 收尾一次性 `prisma generate` + `tsc --noEmit`(避开并行 worktree 的 client clobber)。

## 8. 非目标 / 后续

- 持久化的"预测 vs 实际"回看(需 `TaskForecast` 表)——后续任务。
- Sprint 维度聚合预测——后续任务(复用本 service)。
- embedding / 向量检索——当前用 bigram + tag,足够 MVP。
