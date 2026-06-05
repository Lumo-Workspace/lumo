# LUM-226 文档选区锚定评论 — Plan #7（i18n 全量补齐）

> 执行型小计划：纯翻译，无逻辑、无依赖、无迁移。

**Goal:** 把评论功能在 Plan #2–#4 里只加到 en/zh-CN 的 10 个 key 补齐到其余 14 个 locale，恢复 `i18n-locale-parity.test.ts` 绿（该测试要求所有 locale 与 en.json key 集合一致且值非空）。

**⚠️ 背景（重要教训）:** Plan #2/#3/#4（#302/#305/#306）按计划只加了 en/zh-CN 的评论 key，把其余 14 locale 的 parity 打破——`__tests__/i18n-locale-parity.test.ts` 自 #302 起在 main 上一直 RED（14 locale 各缺 10 key）。本计划修复它。教训：本仓库有严格 locale parity 测试，**新增 user-facing key 必须同 PR 内补齐全部 16 locale**，不能延后（违反 CLAUDE.md「update every locale file」+ 会立刻让 parity 测试变红）。

**补齐的 10 个 key（来源 en.json）:**
`editor.comment`, `document.comments`, `document.noComments`, `document.replies`, `document.reply`, `document.resolve`, `document.reopen`, `document.commentOrphaned`, `document.showResolved`, `document.outline`

**做法:** 用一次性脚本给 14 个 locale（en-GB, en-AU, zh-TW, es, es-419, fr, de, ja, ko, hi, ru, vi, id, ms）逐键插入**真实翻译**（en-GB/en-AU 同 en；zh-TW 用繁体；其余按各语言真实译文，**不用英文兜底**——遵守 CLAUDE.md）。JSON 用 `JSON.stringify(obj,null,2)+'\n'`（与仓库 prettier 2-space 一致，已验证 round-trip 稳定），仅追加缺失 key，最小 diff。

**诊断确认:** 跨全部 locale 的 distinct missing key 恰为且仅为这 10 个——无其他历史缺口。

**验证:**

- `npx jest __tests__/i18n-locale-parity.test.ts` → 30/30 绿（15 parity + 15 non-empty）。
- diff 仅 14 个 locale 文件、纯追加。
- 无新依赖、无迁移、无 tsc 影响。

**PR 描述要点:** 修复自 #302 起一直红的 i18n parity 测试；纯翻译；建议后续新增 key 时同 PR 补全 16 locale，别再延后。
