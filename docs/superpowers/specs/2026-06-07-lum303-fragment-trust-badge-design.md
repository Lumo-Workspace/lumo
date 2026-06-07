# LUM-303 · 片段级「信任分」徽章 — 设计

**Task**: LUM-303 — Rethink Lineage UI: per-task fragment dump → fragment-level 'trust score'
**Milestone**: Context Lineage (System of Record)
**依赖**: LUM-300（飞轮归因修复，已 DONE）
**日期**: 2026-06-07

## 1. 背景与问题

当前 Lineage 的 UI 表现（LUM-297 的 `LineageTab`）是 **per-task 的片段清单** —— lineage 最弱的呈现法：在一个恰好挂了 107 条全局 project memory 的任务上，它视觉塌缩成「记忆列表 + 一排 MERGED 徽章」，毫无独特性。

lineage 真正有价值、独一无二的产出是**跨任务战绩**：「这条片段被用在 N 个任务、X% 成了 merge」。它当前只活在 CLI 的 `lumo task context` 末尾，从未在 Web UI 露出。

**正确方向**：把 lineage 派生的「信任分」标在**片段本身**上（先 memory 卡片），让 lineage 的数据（边）仍是独立底座。Lineage ≠ Memory：Memory 是点，Lineage 是边；信任分是边派生的、用来装饰点的信号。

## 2. 范围

**本 PR 做（A）**：

- 给 memory 卡片挂一个片段级「信任分」徽章。
- 信任分口径**原样复用 LUM-300**：usage 强信号优先 → presence 弱信号回退 → 零方差/冷启动**不显示**。

**本 PR 不做（刻意推迟）**：

- 不动 `LineageTab`（per-task 清单保持现状）。
- 仅 memory 卡片；Slack/文档/PR/评论等片段类型留作后续。
- 徽章按分数变色留作 v2（本版中性浅底）。

## 3. 关键决策（已与用户确认）

| 决策点                                      | 选择                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PR 范围                                     | 只做信任分徽章（A），LineageTab 不动                                                      |
| 片段类型                                    | 仅 memory 卡片                                                                            |
| 不够格片段（冷启动 <3 / 零方差 / 无边历史） | **不显示徽章**，回退原 source 文案                                                        |
| 摆放位置                                    | **位置 1**：紧挨类别标签（卡片左上），不与右上角 hover `⋯` 菜单 / source 冲突，常驻可见   |
| 徽章形态                                    | pill（有底+边框），**中性浅底**（muted，非语义色）—— 不误导、不破坏「全卡仅一个色点」预算 |
| 强/弱区分                                   | usage = 实线框；presence = 虚线框 + 「弱」字样 + 文本灰度降权                             |

## 4. 架构（数据流）

```
MemoryTab → useFragmentTrust(ids) ─┐
                                   ├─→ GET /api/lineage/fragment-trust?ids=…
MemoryListItem ← verdict map ──────┘        ↓ (thin route: auth → zod → service)
                                     lineageService.fragmentTrustForMemories(memoryIds)
                                            ↓ resolveCanonicalFragment('MEMORY', id) 逐个 + 取 stats（I/O）
                                     computeFragmentTrust(refs, stats)  ← 纯函数（抽出，无 I/O）
                                            ↑ 同一纯函数也被 CLI 的 assembleLineageSection 复用
```

**核心动作**：把现在埋在 `lib/services/lineage-signal.ts` 里「计算 + 渲染 markdown」耦合的逻辑，抽出一个**纯计算函数**，让 CLI（markdown）和 Web（badge）走**同一口径**，杜绝两边算法漂移。

**为什么这样**（而非把 trust 塞进 memories API）：CLI 与 Web 口径走同一纯函数（lineage 的老坑就是 write-key 必须 == read-key）；memory 数据获取与 lineage 信号保持独立关注点（SRP/DIP），不把 lineage 耦合进通用的 memories 查询。

## 5. 分层改动

### 5.1 纯计算层 — `lib/services/lineage-signal.ts`

新增类型与函数（**纯函数，无 I/O**）：

```ts
export interface TrustVerdict {
  kind: 'usage' | 'presence' // 强 / 弱
  resolvedTasks: number // 分母（usage 下为 usedResolvedTasks）
  mergedTasks: number // 分子
  pct: number // Math.round(merged/resolved*100)
}

/** 对一批 fragment ref，套用 LUM-300 口径，返回够格者的 verdict（key = `${type}::${id}`）。
 *  不够格（冷启动 <3 / 零方差 / 无边）→ 不在 map 中。纯函数。 */
export function computeFragmentTrust(
  refs: FragmentRef[],
  stats: {
    universe: number
    presence: FragmentMergeRate[]
    usage: FragmentUsageRate[]
  }
): Map<string, TrustVerdict>
```

口径（与现有 `assembleLineageSection` 逐条等价）：

1. usage：`usage.usedResolvedTasks >= LINEAGE_MIN_USED_TASKS` → `kind:'usage'`。
2. 否则 presence：有 stat 且 `!(universe>0 && resolvedTasks===universe)`（排除零方差）且 `resolvedTasks >= LINEAGE_MIN_RESOLVED_TASKS` → `kind:'presence'`。
3. 否则不产 verdict。

`assembleLineageSection` **重构**为：调用 `computeFragmentTrust` → 把 verdict 渲染成现有 markdown 行。**markdown 输出逐字不变**（由快照测试守）。

> 注意：现有 `renderLineageSection` 的 presence 冷启动门控在渲染时做（`presenceQualifying`）。抽出后冷启动门控统一进 `computeFragmentTrust`，渲染层不再二次过滤——需保证 markdown 输出仍逐字一致。

### 5.2 Service — `lib/services/lineage.service.ts`

```ts
/** 给定一批 memory id（UI 里的原始 cuid），返回 trust verdict（按原始 id 键）。
 *  逐个 resolveCanonicalFragment('MEMORY', id) → computeFragmentTrust → 映射回原始 id。
 *  不够格的 id 直接缺省（不在返回 map）。Never throws 风格交由 route 兜底。 */
async fragmentTrustForMemories(memoryIds: string[]):
  Promise<Record<string, TrustVerdict>>
```

deps 接线与 `task-context.service.ts:817` 完全一致：`memoryProvenanceRepository.resolveCanonicalFragment` + `lineageEdgeRepository.{mergeRateByFragments, usageMergeRateByFragments, countResolvedTasks}`。

### 5.3 API Route — `app/api/lineage/fragment-trust/route.ts`

Thin（auth → zod 校验 → service → response）：

- 入参：`ids`（memory id 数组，zod 限制最大长度，如 ≤ 200）。
- 鉴权：复用现有 workspace 鉴权中间件/helper（与其它 `app/api/lineage/*` 路由一致）。
- 返回：`{ trust: Record<memoryId, TrustVerdict> }`。
- 失败：降级返回 `{ trust: {} }`（飞轮信号是装饰，绝不让它拖垮 memory tab）。

### 5.4 前端

- **Hook** — `app/workspace/[workspaceUrl]/hooks/useFragmentTrust.ts`：React Query，按 memory id 集合批量一次请求；`enabled` 门控；ids 排序后作为 queryKey 一部分以稳定缓存。
- **组件** — `components/memory/FragmentTrustBadge.tsx`：吃 `verdict: TrustVerdict | undefined`，`undefined` → 返回 `null`（不够格不渲染）。
  - pill：中性 muted 浅底 + border + `radius-sm`。
  - `pct` 加粗、`tabular-nums`；`· N 任务` 走 muted。
  - usage = 实线框；presence = 虚线框 + 「弱」字样 + 文本降一级灰度。
  - `title`（tooltip）给完整口径文案（同 CLI：「用过的 N 个已闭合任务·M merged · 真实使用信号」/「仅共同加载,弱信号」）。
- **接线** — `MemoryListItem.tsx`：在类别标签右侧渲染 `<FragmentTrustBadge>`；verdict 由 `MemoryTab` 通过 `useFragmentTrust` 取回后按 `memory.id` 下发（props 下传，避免每张卡各自请求）。

## 6. i18n

- 数字 / 百分比 / 任务数 = 裸数据，不走 i18n。
- 散文走 react-intl：「任务」单位、「弱」标记、tooltip 的两句口径文案。
- 新增 key 同 PR 补齐**全部 16 locale 真翻译**（`npm run i18n:sync` 后替换 `[TODO:…]`，`npm run i18n:check` 校验）。

## 7. 测试

- **compute 纯函数单测**（`__tests__`）：usage 优先；presence 回退；零方差排除（`resolvedTasks===universe`）；冷启动门控（<3 不产）；空输入。
- **markdown 快照**：守 `assembleLineageSection` 重构后输出逐字不变。
- **service 测**：resolve + 按原始 id 映射回；不够格 id 缺省；canonical 漂移场景。
- **route 测**：zod 校验；失败降级 `{ trust:{} }`。
- **组件 jsdom 测**：usage/presence/undefined 三态渲染（undefined → null）；tooltip 文案存在。
- **hook 测**（React Query）：批量请求、enabled 门控、缓存键稳定。

## 8. 验收

- memory tab 上，够格的 memory 卡片左上类别标签旁出现中性 pill：`X% · N 任务`，强信号实线、弱信号虚线+「弱」，tooltip 给完整口径。
- 不够格的卡片**无徽章**，回退原 source 文案，无视觉残留。
- CLI `lumo task context` 的飞轮 markdown **逐字不变**。
- `npx tsc --noEmit` 0 错；`npm test` 全绿；`npm run i18n:check` 通过；无 `console.log`。

## 9. 风险 / 已知点

- **口径漂移**：CLI 与 Web 必须共用 `computeFragmentTrust`。重构后用 markdown 快照测试钉死 CLI 行为。
- **零方差边界**：`universe` 取 `countResolvedTasks()`（全局、非 workspace-scoped），与 `mergeRateByFragments` 的 resolved 定义一致，等值判断才对得上。沿用现有契约。
- **性能**：memory tab 可能有上百条；一次批量请求（repo 方法已吃 list），可接受。
- **范围外债**：删除/GDPR 传播、其它片段类型、按分变色 —— 记为已知后续。
