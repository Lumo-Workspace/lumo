# LUM-196 — 清理生产代码 console.log

**Date:** 2026-06-03
**Task:** LUM-196 (milestone: Optimistic UI 乐观更新优化 · 代码质量&性能线)
**Branch:** `lumo/LUM-196-clean-production-console-log`

## Problem

CLAUDE.md 禁止生产代码出现 `console.log`（"No console.log in production code, use proper logging"），ESLint `no-console` 已开为 `warn`。当前生产目录（`lib/ app/ components/ hooks/ shared/`）有 **39 处非 error 级** console 调用：

- `console.log` × 25
- `console.warn` × 13
- `console.info` × 1

（`console.error` × 186 不在本任务范围——属正当错误日志。）

项目目前**没有任何统一 logger**，仅 `lib/integrations/sandbox/mcp.ts` 内有一个写本地文件的局部 `debug()`（沙箱内运行的独立 MCP 脚本，不在本任务范围）。

## Goal

引入一个轻量的、按级别门控的结构化 logger，把有可观测价值的调用迁过去；删除纯调试噪音与死代码。生产日志默认安静（debug 被抑制），但可通过环境变量免重新部署调回。错误路径（`console.error`）完全不动。

## Design

### 1. 新增 `lib/logger.ts`

全项目**唯一被许可**的 `console.*` 出口，**仅服务端使用**。

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

// 阈值：LOG_LEVEL 环境变量优先 (debug|info|warn|error)；
// 否则 production → info，其余 → debug。
function thresholdRank(): number { ... }

function emit(level: LogLevel, args: unknown[]): void {
  if (RANK[level] < thresholdRank()) return
  // eslint-disable-next-line no-console  ← 唯一被许可的 console 调用
  console[level](...args)
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info:  (...args: unknown[]) => emit('info', args),
  warn:  (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
}
```

约束与注意：

- 阈值在**调用时**读 `process.env`（不在模块加载时固化），便于测试与运行时切换。
- `LOG_LEVEL` 用字面量联合判断（`raw === 'debug' || ...`）收窄类型，规避 `noUncheckedIndexedAccess` 下的 `number | undefined`。
- `process.env` 在客户端 bundle 里只有 `NEXT_PUBLIC_*`——本 logger 只被服务端代码导入（见下文删除规则），不会进客户端。

### 2. 迁移映射（机械，按原方法对应级别）

| 原调用 | 迁到 |
|---|---|
| `console.log` | `logger.debug` |
| `console.info` | `logger.info` |
| `console.warn` | `logger.warn` |
| `console.error` | **不动** |

完成汇总类（memory `applied`、`github/sync` 的 `synced N PRs`）**也统一归 debug**——规则零判断；生产默认静默，排查时 `LOG_LEVEL=debug` 恢复；失败仍走 `console.error` 不受影响。

每个被改文件顶部加 `import { logger } from '@/lib/logger'`。

### 3. 逐桶处理（39 处）

**删除——纯客户端调试噪音（5 处）**
`hooks/use-profile-updates.ts`：SSE `connection opened` / `Connection established` / `Profile update received` / `Heartbeat received` / `Manual reconnect requested`。客户端无 `LOG_LEVEL`、零可观测价值，直接删。（该文件的 `console.error` 保留。）

**删整个文件——死代码（含 2 处 log）**
`lib/agent/utils.ts`：全文件无人 import；`slugify` / `createPullRequest` 已被 `lib/utils/slugify.ts`、`lib/agent/github-pr.ts`、`lib/agent/execute.ts`（局部）真实实现覆盖；`updateTask` / `createNotification` 是只打 `[DB]` console.log 的桩。整文件删除。PR 描述里注明删除原因。

**迁到 logger（其余 32 处）**
- `lib/agent/execute.ts`（2 log → debug）
- `lib/agent/sandbox.ts`（5 log → debug）
- `lib/agent/post-agent.ts`（1 warn → warn）
- `lib/services/memory/layer1.service.ts`（5 log → debug）
- `lib/services/memory/layer2.service.ts`（5 log → debug）
- `lib/services/memory/layer1-apply.ts`（2 warn → warn）
- `lib/services/memory/layer2-apply.ts`（2 warn → warn）
- `lib/integrations/github/auth.ts`（1 warn → warn）
- `lib/integrations/github/sync.ts`（1 log → debug）
- `lib/integrations/slack/context-fetcher.ts`（3 warn → warn）
- `lib/services/pr-comment-mirror.service.ts`（1 warn → warn）
- `lib/services/task-web-link.service.ts`（1 info → info）
- `lib/summaries/report.ts`（2 warn → warn）
- `app/api/agent/sandbox-done/route.ts`（1 warn → warn）

合计：删 5 + 删文件 2 + 迁 32 = 39 ✓

## Testing

`__tests__/logger.test.ts`（CLAUDE.md：每个新函数至少一个测试）：

- `LOG_LEVEL=debug` → debug/info/warn/error 全部 emit
- `LOG_LEVEL=warn` → warn/error emit，debug/info 被抑制
- `LOG_LEVEL` 未设 + `NODE_ENV=production` → info/warn/error emit，debug 抑制
- `LOG_LEVEL` 未设 + 非 production → debug 也 emit
- args 原样透传给对应 `console.*`
- 用例间 set/restore `process.env`，spy `console.{debug,info,warn,error}`

## Verification

- `cd .worktrees/LUM-196 && npx jest`（含新 logger 测试 + 受影响 service 既有测试）
- `npx tsc --noEmit`（strict / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 全开）
- `grep` 复核：迁移后生产目录非 error console 仅剩 `lib/logger.ts` 内那一处（被 eslint-disable 圈住）+ 186 处 console.error

## Out of scope

- 186 处 `console.error`（不动）
- `lib/integrations/sandbox/mcp.ts` 的局部 `debug()`（沙箱独立脚本）
- CLI / tests / scripts 目录下的 console
- 把 logger 接成外部 APM/结构化 JSON sink（YAGNI；未来需要再说）
