# 交付回顾（Delivery Retrospective）— LUM-319

## 背景

「交付预测」（`ForecastPanel`，LUM-304/317）只在任务**未完成**时渲染：从同项目其他 DONE 任务推出
iterations / mergedPrs / cycleHours 区间 + 项目级 token 成本区间。任务一旦 `DONE`，`ForecastPanel`
直接返回 `null`（[ForecastPanel.tsx:53-58](../../../app/workspace/[workspaceUrl]/components/ForecastPanel.tsx)）。

本特性是这条线的「下半场」：任务交付后，把**交付那一刻固化的预测**与**真实结果**并排对比，并以
「已计入参考库（现 N 个）」收尾，强化飞轮叙事（LUM-278/300）。

## 目标 / 非目标

**目标**

- DONE 任务在侧栏渲染「交付回顾」卡：token / 运行次数 / 澄清轮次 三项的「预测 vs 实际」对比。
- 预测口径 = **交付时快照**（非实时重算），保证展示的是「开工前真实做出的预测」。
- 飞轮收尾行：本任务已计入参考库，显示参考库当前规模。

**非目标（明确不做）**

- 老任务（上线前已 DONE、无快照）**不渲染**回顾卡，也**不做 post-hoc 回填**。
- 不做交互滑块（区间带是静态位置指示）。
- 前向 `ForecastPanel` 不新增「澄清轮次」展示（仅回顾卡用）。
- 回顾卡不展示 cycle / mergedPrs。

## 关键决策（已与用户确认）

| 决策点         | 选择                                            | 理由                                           |
| -------------- | ----------------------------------------------- | ---------------------------------------------- |
| 预测口径       | **交付时快照**                                  | 诚实——展示开工前真实预测，不随后续任务漂移     |
| 指标集         | token + 运行次数 + **澄清轮次**                 | 严格忠于 mockup；澄清轮次为新增预测线          |
| 老任务         | **不显卡**                                      | 与快照口径一致，不 post-hoc 重算假装当初预测过 |
| 偏差 pill 配色 | 降级为 `--success`/暖色 subtle                  | 层级靠字重，颜色仅轻状态暗示（避免饱和绿）     |
| 区间可视化     | 静态区间带（p25–p75 + median 刻度 + actual 点） | 非交互，YAGNI                                  |

## 数据模型（additive，无数据销毁）

新表 `TaskForecastSnapshot` —— **只存预测**，actual 运行时实算：

```prisma
model TaskForecastSnapshot {
  id             String   @id @default(cuid())
  taskId         String   @unique          // keep-first 幂等；护 reopen 重交付
  iterations     Json?                      // { p25, median, p75 } | null
  clarifyRounds  Json?
  tokenCost      Json?
  cohortSize     Int                        // 相似 cohort 大小（喂 iterations/clarify）
  tokenCostBasis Int                        // 项目级样本数（喂 token）
  capturedAt     DateTime @default(now())
  task           Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  @@map("task_forecast_snapshots")
}
```

- `Task` 侧加反向 relation `forecastSnapshot TaskForecastSnapshot?`。
- 迁移纯新增表 + 一条 relation 列，PR 描述标注「prod 下次 deploy 需 `migrate deploy`，无数据销毁」。

## 预测栈扩展：新增「澄清轮次」track

现有 forecast 无此线。澄清在 live 世界落地为 `Notification`（`type = AGENT_CLARIFY`，挂 `taskId`），
可按任务历史计数。沿用 iterations 的 cohort 区间逻辑：

- `ForecastCandidate.clarifyRounds: number` ← 该任务 `AGENT_CLARIFY` notification 计数
  （repository 用 `_count` / groupBy；Notification 已有 `taskId`）。
- `extractMetrics` 透传 `clarifyRounds`。
- `forecastService` 对 cohort clarify 值产出 `Interval | null`，复用 `MIN_COHORT(=3)` 门控——样本不足→`null`。
- `TaskForecast` 加 `clarifyRounds: Interval | null`。**前向 `ForecastPanel` 不渲染**（保持范围）。

## Retrospective 服务（`lib/services/retrospective.service.ts`）

**`captureSnapshot(taskId)`**（DONE 时调用）

- 快照已存在 → no-op（keep-first，保住首次交付的真实预测）。
- 否则 `forecastService.getTaskForecast(taskId)`（天然排除自己）。
- **至少一条 track 非空才落库**；全空（项目早期无 cohort）则不写 → 该任务无卡。

**`getRetrospective(taskId)`**（渲染时调用）

- 无快照 → 返回 `null`（API 层映射为 `{ available: false }`）。
- 实算 actual：token（同 forecast repository 的 session usage 求和）、运行次数（session 数）、
  澄清轮次（本任务 `AGENT_CLARIFY` 计数）。
- `referenceLibrarySize` = 项目内 `status=DONE 且 sessions.some{}` 计数（= 未来预测的参考库 universe，
  与 forecastRepository 候选过滤同口径）。
- 每条指标产出 `{ forecast: Interval | null, actual: number, deltaPct: number | null, band: 'within' | 'above' | 'below' | null }`：
  - `deltaPct = round((actual - median) / median * 100)`（median 为 0 时 → `null`）。
  - `band`：`p25 ≤ actual ≤ p75` → `within`；`> p75` → `above`；`< p25` → `below`；`forecast == null` → `null`（该行降级为 actual-only）。

## 捕获钩子

在 [task-state.service.ts:295](../../../lib/services/task-state.service.ts) 的 `status === 'DONE'` 块内并排加
`captureForecastSnapshotInBackground(taskId)`：`waitUntil` + 自 catch，与 `stampLineageInBackground` 同形态。
forecast 链仅依赖 prisma（无 AI-SDK gateway），可静态 import；但仍 fire-and-forget，失败不回滚 completion。
幂等靠 `taskId @unique` + keep-first。

## API / Client / Hook

- `GET /api/tasks/[id]/retrospective` —— 瘦路由（auth → service → response）；无快照返回 `{ available: false }`。
- `lib/api-client/tasks.ts` 加 `getTaskRetrospective`。
- `useTaskRetrospective`（仿 `useTaskForecast`）：仅 `status === 'DONE'` 时 enable。
- `lib/query/keys.ts` 加 query key。

## UI（`RetrospectivePanel.tsx`，新组件，SRP）

挂在 `TaskDetailSidebar`，与 `ForecastPanel` 按 status 互斥（DONE 显回顾、非 DONE 显预测）。
无数据 / loading / error → **渲染 `null`**（与 ForecastPanel 一致，保持侧栏安静）。

- **header**：「交付回顾」标题 + 「已完成」徽章（复用 status 样式）。
- **token 区**：`预测 <median compact>` vs `实际 <compact>` + 偏差 pill + 静态区间带。
  - 区间带：灰条 = p25–p75；竖刻度 = median；蓝点 = actual 落点；图例 预测 / 实际。
  - 偏差 pill：`within` → `--success` subtle；`above`/`below` → 暖色 subtle；克制，不抢字重。
- **交付区**：运行次数 / 澄清轮次 两行，各 `预测 <range> · 实际 <N>`。
  - 某指标 `forecast == null` → 该行降级为 `实际 <N> · 无足量历史预测`，省略预测与偏差。
- **页脚飞轮行**：「已计入参考库，将用于未来同类任务的预测（现 N 个）」+ subtle 图标。

参考 mock：`.mock/retrospective.html`（throwaway，落库后清理；含 `.claude/launch.json` 的 `mock-static` 临时服务）。

## i18n

新 `retrospective.*` key（标题、token 用量、预测/实际、偏差文案 within/above/below、运行次数、澄清轮次、
无足量历史预测、参考库飞轮行）。全 16 locale 补真翻译，过 strict parity 测；`npm run i18n:sync` 起手后替换
`[TODO:…]`。偏差百分比 / N 等数值走 `intl.formatNumber`，散文走翻译。

## 测试

- `retrospective.service`：keep-first 幂等；band/deltaPct 数学（within/above/below/median=0→null）；
  无快照→null；稀疏 clarify→行降级；referenceLibrarySize 口径。
- forecast clarify track：metrics 透传、service 区间 + `MIN_COHORT` 门控、repository 计数。
- 捕获钩子：DONE 触发、快照已存在跳过、全空 track 不落库。
- `RetrospectivePanel`（jsdom）：**带 `QueryClientProvider`**；happy-path、above-band、clarify 降级、无数据→null。
- 两个测试根 `__tests__/` 与 `tests/` 都 grep；末尾全量 `npx jest` + `npx tsc --noEmit` 兜底。

## 边界

- **Reopen**：快照 keep-first 不覆盖（留住首次交付预测）；actual 实算反映最新状态。
- **项目早期**：无 cohort → 不落快照 → 无卡（可接受）。
- **澄清轮次稀疏**：clarify interval = null → 该行降级，不假造预测。
