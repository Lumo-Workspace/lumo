# 交付中卡片无预测时的进行态摘要 (LUM-331)

跟进 LUM-323（PR #424，交付卡三态化）。

## 问题

任务详情侧栏「交付进行中」状态（`DeliveryPanel` 路由到 `ProgressView`，条件 `sessionCount >= 1`）在**没有预测数据**时塌缩成两行裸计数 `运行次数 已1 / 澄清轮次 已0`，看起来像空的/坏掉的（见 LUM-324 截图）。

根因：`ProgressView` 是围绕「活预测 band 做实时 burn 对比」设计的。token 用量块门控是 `showToken = !!tokenCost.forecast && tokenCost.actual !== null`；底部 `ProgressCompareRow` 在 `metric.forecast` 缺失时 `rangeText` 为 null，只剩 `已N`。本 workspace ~90% 任务无预测数据（LUM-304：无 a-priori 特征能预测工作量，cohort 常 < 3），所以「无预测」是常态而非边缘 case，但 `ProgressView` 对它没有任何兜底。

交付后 `RetrospectivePanel` 早已有优雅降级（`实际 N · 暂无预测历史`），交付前 `ForecastView` 有刻意的「历史不足」提示——`ProgressView` 是三态里唯一的异类。

## 决策（已与用户确认）

- **交付中（本任务范围）**：无预测时丢掉无意义的 forecast 对比框架，改**中性「进行态摘要」**——只展示有真实信号的累计值，0 值/无信号指标不渲染。
- **交付前**：`insufficientData` 时保留「历史不足」一行，**不动**。
- **交付后**：`RetrospectivePanel` 已优雅降级且已上线，**不动**。
- 遵守 LUM-304/LUM-317 既定口径：如实降级，不为填满卡片造假数据、不堆相似度。

## 范围

**只改** `app/workspace/[workspaceUrl]/components/ProgressView.tsx` + i18n + 测试。
`DeliveryPanel` / `ForecastView` / `RetrospectivePanel` / `progressService` / `forecastService` / API route / `progress-types` **全不动**——所需数据（`progress.forecast` 是完整 `TaskForecast`，`progress.*.actual` 是真实累计值）已经齐备。

## 设计：每个指标三选一渲染

利用一个事实：两个 cohort 指标 `iterations` / `clarifyRounds` 在 `forecast.service` 里**同生同灭**（`sources >= 3` 时两者都有 interval；否则都为 null），而 `tokenCost` 是独立的项目级轨道。

定义「有信号」：`actual != null && actual > 0`。

| 指标 | 有 forecast | 无 forecast 但有信号 | 无信号 |
| --- | --- | --- | --- |
| **token**（独立轨道） | 现有 burn block（`RangeBand` + `OverPill` + `onTrackNote`）**原样不动** | 摘要行「已用 {value} token」 | 不渲染 |
| **iterations + clarify**（同生同灭） | 现有 compare 区（预测区间 · 已N）**原样不动** | 摘要行 | clarify 单独判：`actual > 0` 才渲染 |

关键不变式：`iterations.actual`（= `sessionCount`）在交付中恒 ≥ 1（`sessionCount === 0` 已被 `DeliveryPanel` 路由到交付前），所以摘要态**永远至少有「已运行 N 次」一行**，不会再出现空壳。

### 渲染分支组合

ProgressView 顶部计算：
- `hasTokenBand = !!tokenCost.forecast && tokenCost.actual !== null`（即现有 `showToken`）
- `hasCohortForecast = !!iterations.forecast`（clarify 同生同灭，判一个即可）

布局：

1. **header**（标题 + WORKING 时的 running pill）——不变。
2. **token 区**：
   - `hasTokenBand` → 现有 burn block（不变）。
   - 否则 `tokenCost.actual` 有信号 → 摘要行「已用 {compact} token」。
   - 否则不渲染。
3. **cohort 区**：
   - `hasCohortForecast` → 现有 compare 区（`进度` 子标题 + 两个 `ProgressCompareRow`），不变。
   - 否则 → 摘要行：恒渲染「已运行 {iterations.actual} 次」；`clarifyRounds.actual > 0` 时追加「已澄清 {value} 轮」。

> 视觉：摘要行用自然语言事实句（左对齐列表），而非现状的 `label + 已N` 两列——后者正是用户嫌弃的形态。token 摘要复用 `compact()` 数字格式。

### 常见态（无任何预测）效果

```
交付进行中                    [● Agent 运行中]
已运行 1 次
已用 ~12k token        ← token actual 有值时
（澄清 0 轮 → 不渲染）
```

## i18n

新增 3 个 key（全 16 locale，`npm run i18n:sync` 后补真翻译）。**非 ICU plural**（配合现有 test mock 的朴素 `{var}` 替换，且现有 progress.* key 都不用 ICU）：

| key | en | zh-CN |
| --- | --- | --- |
| `progress.summaryRuns` | `{value} runs so far` | `已运行 {value} 次` |
| `progress.summaryTokens` | `{value} tokens used` | `已用 {value} token` |
| `progress.summaryClarify` | `{value} clarification rounds` | `已澄清 {value} 轮` |

## 测试（`__tests__/components/ProgressView.test.tsx`）

保留现有 3 个「forecast 在场」用例（验收标准 2：有预测时行为不变）。新增：

1. **无 cohort forecast + token 有值** → 出现「已用 …token」摘要行 + 「已运行 N 次」；**不**出现 `预测`/compare、不出现裸 `已 0`。
2. **无 cohort forecast + token null + clarify 0**（LUM-324 态）→ 只出现「已运行 N 次」；断言**无**「澄清」「已 0」字样、无 token 行。
3. **无 cohort forecast + clarify > 0** → 出现「已澄清 N 轮」摘要行。
4. **有 forecast 时不出现任何摘要行**（两套互斥，回归保护）。

## 验证

- 全量 `npx jest`（从 worktree 内跑）：ProgressView 测试 + i18n locale-parity 测试。
- `npx tsc --noEmit`。
- `npm run lint:tokens`（无新增 raw color；摘要复用既有 token）。
- preview 验证因 localhost 不可达跳过，以 jsdom 组件测 + mock 截图替代。
