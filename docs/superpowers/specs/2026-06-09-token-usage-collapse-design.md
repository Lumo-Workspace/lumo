# LUM-351 — Agent 运行 tab token 用量整卡折叠 + 视觉清理

来源:用户对 LUM-345/PR#451 运行 tab 的 UI 反馈 —— token 用量明细太高且不可折叠;"TOKEN 用量" 微标题与分割线观感差。

## 决策(已与用户确认)

- 折叠粒度:**方案 A 整卡折叠**(否决了每 model 折叠、两级折叠)。
- 默认状态:**收起**。收起行右侧保留各 model 总量,信息不丢;实时 burn 右侧交付卡也有。

## 现状

汇总卡(`AgentRunTab.tsx`)结构:卡片头 `1 次运行 · 1 轮 · 3 个 model`(border-b)→ `TokenCostBreakdown`(10px 大写 "TOKEN 用量" 微标题 + 每 model 一段,段间 `border-t border-border/60`)。三个 model 各占 headline + bar + 4 行明细,不可折叠。

`TokenCostBreakdown` 共三处消费方:

1. `AgentRunTab` 汇总卡(variant `full`,多 model,perMember)
2. `AgentRunCard` 展开态(variant `compact`,每 Run 一份)
3. `LineageTab`(variant `full`,单一无名 model 组,`model: ''` 约定不动)

## 设计

### 1. 汇总卡改 disclosure(只动 `AgentRunTab.tsx`)

- 卡片头改为整行可点击按钮:chevron(展开时旋转 90°)+ **"Token 用量"**(`tokenCost.label`,标题字重)+ 原运行/轮次/model 元信息(灰)。
- 收起态(默认,`useState(false)` 不持久化):右侧显示各 model `名称 总量` 摘要,如 `fable-5 5183万 · sonnet-4-6 4180万`;复用 `AgentRunCard` 的 `modelLabel`/`fmtCompact`(抽到 `AgentRunTimeline` 内共享小模块,两处 import)。
- 任一 model 有 in-flight 用量时,收起行保留脉冲圆点(实时信号不因收起丢失);无 in-flight 不渲染。
- 展开态:下方渲染现有 `TokenCostBreakdown`(per-member 展开、in-flight 条纹段、footer chips 行为全部不变);卡片头 `border-b` 去掉,靠留白分隔。
- a11y:`aria-expanded`;`data-testid` 供测试。

### 2. TokenCostBreakdown 视觉清理(三处共享)

- 删除 10px 大写微标题渲染;新增可选标题(`showTitle?: boolean` 或等价 prop):运行 tab 不显示(标题在卡片头),LineageTab 与 AgentRunCard 展开态继续显示但升级为 `text-caption font-medium`(正常字号、非大写)。LineageTab 空态里自绘的同款微标题同步升级。
- `ModelGroup` 去掉组间 `border-t border-border/60`,改留白(`space-y` / margin),`first:` 系列类一并清掉。

### 3. 不变式

- 零 schema、零 API 改动;不新增 i18n key(`tokenCost.label` 已有全 16 locale)。
- `__in_flight__` 哨兵语义、`model: ''`(LineageTab 约定)不动。
- 每个 Run 卡自身折叠行为不动。

### 4. 测试

- 新增 `__tests__/components/AgentRunTimeline/AgentRunTab.test.tsx`:默认收起(明细不在 DOM)、点击展开/收起(aria-expanded)、收起行含 model 总量摘要、in-flight 脉冲点有/无。
- 更新 `__tests__/components/TokenCostBreakdown.test.tsx`:标题可选、无 border-t。
- 两个测试根(`__tests__/` 与 `tests/`)都要 grep/跑,防第二根漏更。

## 验收合约

已提交锁定(AGENT_DRAFT r0,5 条):默认收起 / toggle 行为 / in-flight 收起态指示 / 微标题与横线清理且消费方不回归(MACHINE,jest checkpointer);typography-not-color 视觉层级(HUMAN)。
