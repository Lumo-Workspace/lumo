# 交付卡三态化：新增「交付中」实时 burn 态

- **任务**: LUM-323（follow-up to LUM-319）
- **日期**: 2026-06-08
- **状态**: 设计已确认（mock approved），待出实现计划

## 背景与问题

交付卡当前是**二态**，由 `status === 'DONE'` 这一个字段切换：

- `ForecastPanel`（[ForecastPanel.tsx:53-58](../../../app/workspace/[workspaceUrl]/components/ForecastPanel.tsx)）：非 DONE 显示预测，DONE → `return null`
- `RetrospectivePanel`（[RetrospectivePanel.tsx:160-165](../../../app/workspace/[workspaceUrl]/components/RetrospectivePanel.tsx)）：DONE 才渲染对比，否则 `return null`

后果：`TODO / IN_PROGRESS / IN_REVIEW` 三个状态卡片**长得完全一样**，都只是静态预测。从"开始干"到"交付完"这段没有任何实时反馈 —— 预测卡一动不动地挂着，看不到"已烧多少、相对预测偏没偏"。

两个核心判断：

1. **缺中间态**：需要一个"交付中"态，展示飞行途中的实时 burn。
2. **`status` 是错的信号**：`status` 是人手动设的，IN_PROGRESS 可能只是有人拖了下卡、没 agent 在跑；TODO 也可能 agent 正在烧 token。真实信号是 Session 的存在 / `agentStatus`。

## 设计决策（已与用户逐项确认）

| 决策点           | 选择                                                  | 理由                                                                                                                           |
| ---------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 交付中内容       | **实时 burn 对比**                                    | 把累计 actual 打到预测区间带上；不做按速率外推落点（拒绝投影，避免瞎猜）                                                       |
| 态边界信号       | **有过 Session（`sessionCount ≥ 1`）即交付中**        | 不用 status；不用"此刻 agent 在跑"——后者跨 session 断续会反复闪。`agentStatus === WORKING` 仅作态内"正在跑"脉冲                |
| 预测带冻结时机   | **交付中用实时预测（不冻结）**                        | 数据路径简单：DONE 快照逻辑原封不动。代价：带随 cohort 漂、DONE 那刻可能微跳（交付中本就是飞行途中的参考，权威对比留到交付后） |
| 组件架构         | **A：瘦编排器 `DeliveryPanel`**                       | pre/during 合一次取数、互斥天然不闪、预测只取一次；符合 SRP                                                                    |
| 交付中 band 语义 | **`on-track` / `over` 两态**                          | 部分 actual `< p25` 是正常进度，**不报 below**；只有 `> p75` 才预警                                                            |
| on-track 视觉    | **不出偏差 pill**，只显示圆点位置 + "区间内·仍在累计" | 飞行途中报偏差会误导                                                                                                           |
| over 视觉        | 圆点转 **warning 色** + `+N% · 已超预算` pill         | 比回顾卡（圆点恒中性）更跳，over 是真预警                                                                                      |
| WORKING 脉冲     | 卡头右上，替代状态 pill                               | 仅 `agentStatus === WORKING` 时出现                                                                                            |

## 状态模型

| 态         | 触发                            | 卡片                                                                   |
| ---------- | ------------------------------- | ---------------------------------------------------------------------- |
| **交付前** | 未 DONE 且 `sessionCount === 0` | 纯预测（现 ForecastPanel 内容）                                        |
| **交付中** | 未 DONE 且 `sessionCount ≥ 1`   | 活预测带 + 累计 actual 的实时 burn + on-track/over 判定 + WORKING 脉冲 |
| **交付后** | `status === 'DONE'`             | 冻结快照 vs 终值（现 RetrospectivePanel，**原封不动**）                |

`sessionCount` 直接来自 `loadActuals().iterations`（= `task.sessions.length`，[retrospective.repository.ts:113](../../../lib/repositories/retrospective.repository.ts)），零新字段。

## 架构（选项 A 瘦编排器）

`TaskDetailSidebar:215-216` 现在直接渲染两个 Panel，改成挂一个编排器：

```
DeliveryPanel(taskId, status, agentStatus)
 ├─ status === DONE → <RetrospectivePanel>            // 不动
 └─ else → useTaskProgress(taskId)                     // 一次取数
       ├─ sessionCount === 0 → <ForecastView>          // 交付前
       └─ sessionCount ≥ 1   → <ProgressView>          // 交付中
```

### 新增 / 改动清单

**服务层**

- **新** `lib/services/progress.service.ts` → `getProgress(taskId)`：
  - `actuals = retrospectiveRepository.loadActuals(taskId)`（复用）→ `sessionCount = actuals.iterations`
  - `forecast = forecastService.getTaskForecast(taskId)`（活预测）
  - 逐指标 `progressMetric(forecast, actual)`（见下）
  - 返回 `{ sessionCount, forecast, progress: { tokenCost, iterations, clarifyRounds } }`
  - 不在 session-start 落任何快照；DONE 快照路径（`retrospectiveService.captureSnapshot`）完全不碰

**类型**

- **新** `lib/forecast/progress-types.ts`：`TaskProgress`、`ProgressMetric`、`ProgressBand = 'on-track' | 'over'`
  - `progressMetric(forecast: Interval | null, actual: number | null): ProgressMetric`
    - `band = actual > forecast.p75 ? 'over' : 'on-track'`
    - `deltaPct` 仅在 `over` 时计算/暴露（on-track 的负偏差无意义，不显示）
    - forecast 或 actual 缺失 → 行降级（forecast/actual 照传，band/deltaPct = null）

**API / hook**

- **新** `GET /api/tasks/[id]/progress` → `progressService.getProgress`（薄路由：auth → 调 service → 返回）
- **新** `useTaskProgress(taskId: string | null)` hook（`enabled` 由非 null 门控，`staleTime` 对齐现有 5min）

**组件**

- **新** `DeliveryPanel`（编排器）：替换 sidebar 里两个 Panel 的直接渲染。DONE → `<RetrospectivePanel>`；否则取 progress，`sessionCount === 0` → `<ForecastView>`，`≥ 1` → `<ProgressView>`。loading/error/null → 不渲染。
- **重构** `ForecastPanel` → 纯展示 `ForecastView`：去掉自带的 `useTaskForecast`，forecast 改为 prop（由编排器从 progress payload 传入）。保留 `insufficientData` 降级分支。
- **新** `ProgressView`（交付中 burn 视图）：
  - 复用 `rangeBandGeometry` + `RangeBand`（圆点随累计 actual 往右爬）
  - token 行：预测中位 vs 已用，带；on-track 无 pill / over 出 warning pill + warning 圆点
  - 进度行：运行次数、澄清轮次（预测区间 · 已 N；over 时 actual 标 warning 色）
  - WORKING 脉冲（`agentStatus` prop 透传，随 refetch 刷新，**不做实时推送**）
  - 无飞轮 / 参考库 footer（那是交付后概念）

**渲染复用**：`RangeBand` / `rangeBandGeometry` / `VariancePill` 的视觉与 RetrospectivePanel 同源，抽公共部分以免漂移（具体抽法在实现计划里定）。

## 数据 / 范围

- **零 schema 变更**：复用 `loadActuals`、`rangeBandGeometry`；DONE 快照表 `TaskForecastSnapshot` 与捕获路径不动。
- **i18n**：新增 `progress.*` keys（title、agentRunning、onTrackNote、over、predicted/used、iterations、clarifyRounds 等）→ 全 16 locale。先 `npm run i18n:sync` 占位，再补真译（CLAUDE.md：禁止留 `[TODO:…]` 与英文 fallback）。
- **测试**（`__tests__` 与 `tests/` 两根都要覆盖）：
  - `progressMetric`：p75 边界、部分 actual `< p25` → on-track（不报 below）、over 计 deltaPct、缺失降级
  - `progressService.getProgress`：`sessionCount === 0` 仍返回 forecast、`≥ 1`、forecast null 降级
  - `ProgressView` 渲染（jsdom + QueryClientProvider；on-track 无 pill / over 有 pill / WORKING 脉冲）
  - `DeliveryPanel` 路由（DONE→retro、0→forecast、≥1→progress）

## 明确不做（YAGNI）

- `agentStatus` 实时推送 —— 脉冲只随任务详情 refetch 刷新。
- 按 burn 速率外推落点（projected final）—— 已否决。
- 在 session-start 冻结预测带 —— 交付中用实时预测。

## 验证关口（PR 前）

- `npx tsc --noEmit` 0 error（含 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`）
- `npm test` 全绿（两个测试根）
- `npm run lint:tokens` 通过
- `npm run i18n:check` 无 drift
- `npm run build`（唯一 CI gate 是 Vercel build）
