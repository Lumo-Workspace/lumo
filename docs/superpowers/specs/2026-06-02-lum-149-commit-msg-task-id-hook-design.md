# LUM-149: commit/PR 自动带 task ID `[LUM-N]`

**Date**: 2026-06-02
**Task**: LUM-149 — commit/PR 自动带 task ID([LUM-N])
**Status**: Design approved

## 问题

CLAUDE.md 有硬约定：commit message 形如 `type: description [LUM-N]`。但目前完全靠
agent 自觉，对用户手敲的 commit、agent 偶尔遗漏的 commit 都不生效。

现状（2026-06-01 审计）：

- `lumo setup` 只装 `SKILL.md` + 把 Claude Code hook 合并进 `.claude/settings.json`，
  **不装任何 git hook**。
- 全仓库无 `prepare-commit-msg` / `commit-msg`。
- 幂等合并逻辑（`hooks-template.ts`）只处理 `settings.json` 的 `HookEntry`。

## 目标

`lumo setup` 幂等安装一个 `prepare-commit-msg` git hook：commit message 里若无
`[LUM-N]` 标记，则自动从当前分支名追加。对**任何** commit（agent 或手敲）生效。

非目标（v1 不做）：

- `gh pr create` 标题注入（靠 post-tool-use 拦截重写，脆弱）→ 二期或不做。
- 从 `lumo session status` 取绑定（需 env + 联网，钩子里脆弱）→ 见下方决策。

## 关键决策

### 决策 1：`[LUM-N]` 来源 = 仅分支名

从当前分支名 `lumo/LUM-N-...` 用正则提取，**不**调 `lumo session status`。

理由：

- 分支命名 `lumo/{task-id}-{description}` 已是 CLAUDE.md 硬约定。
- 纯本地、瞬时、离线可用，对手敲 commit 也生效。
- 多 worktree 下天然按分支区分（每个 worktree 一条 `lumo/LUM-N-...` 分支），
  比 session 维度更稳。
- 钩子脚本因此**零 `lumo` 依赖、零网络**——更快更健壮。

代价：分支名不含 `LUM-N` 时（detached HEAD、非 lumo 分支）静默跳过，不追加。可接受。

### 决策 2：husky / 自定义 `core.hooksPath` → 检测到则降级提示

- 裸仓库（未设 `core.hooksPath`）：写 `git rev-parse --git-path hooks` 目录下的
  `prepare-commit-msg`，用 marker 块幂等合并。
- 设了 `core.hooksPath`（husky 等）：**不**静默塑入（避免装到错位置或被 husky
  重生覆盖），改为打印一段可复制的手动接入说明（把 marker 块加到
  `.husky/prepare-commit-msg`）。
- 非 git 仓库 / `--user` 作用域：跳过，不报错。

## 钩子脚本行为

`prepare-commit-msg` 收到参数：`$1` = message 文件路径，`$2` = 来源
（message|template|merge|squash|commit），`$3` = SHA（amend/-c 时）。

逻辑（纯 POSIX sh + git）：

```sh
# >>> lumo prepare-commit-msg >>>
case "$2" in merge|squash) exit 0 ;; esac          # 跳过自动生成的合并/压缩 message
branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0   # detached HEAD → 退出
id=$(printf '%s' "$branch" | grep -oE 'LUM-[0-9]+' | head -n1)  # 从分支名提取
[ -z "$id" ] && exit 0                              # 分支无 LUM-N → 不动
grep -qE '\[LUM-[0-9]+\]' "$1" && exit 0            # message 已有 [LUM-x] → 不动
# 在首个「非注释、非空」行(subject)末尾追加 " [$id]";找不到 subject → 不动
# <<< lumo <<<
```

行为决策：

- 跳过 `$2` 为 `merge` / `squash` 的 commit。
- message 已含任意 `[LUM-x]` → 完全不动（尊重用户写的，即使与分支不一致）。
- 只在已有非空 subject 行时追加（agent/CLI 都用 `-m`，总有 subject；交互式空
  message 不塞难看的 `[LUM-149]`）。
- 追加格式 ` [LUM-N]` 接在 subject 行末尾，符合 `type: description [LUM-N]`。
- 提取大小写敏感（约定为大写 `LUM`），分支里取**第一个** `LUM-\d+`。

## 代码结构

新增 `cli/src/lib/git-hook-template.ts`，导出纯函数（便于单测）：

- `HOOK_SCRIPT_BLOCK: string` — marker（`# >>> lumo prepare-commit-msg >>>` /
  `# <<< lumo <<<`）包裹的脚本块常量。
- `mergeGitHook(existing: string | null): { content: string; status: 'created' | 'updated' | 'appended' | 'unchanged' }`
  — 纯字符串合并：
  - `null` → 新建带 `#!/bin/sh` shebang + 块 → `created`
  - 已含我们的 marker 块 → 原地替换块 → 内容变了 `updated` / 没变 `unchanged`
  - 有内容但无我们的块 → 保留原内容、追加块 → `appended`
- `resolveHookInstall(coreHooksPath: string | null): { mode: 'install'; } | { mode: 'degrade' }`
  — `coreHooksPath` 非空 → `degrade`；否则 `install`。

`cli/src/commands/setup.ts` 新增 `installGitHook(projectRoot)` 步骤：

- 仅 `--project` 作用域调用。
- 探测是否 git 仓库（`git rev-parse --is-inside-work-tree`）；否则跳过。
- 读 `git config core.hooksPath` → `resolveHookInstall`。
- `install` 模式：解析 hooks 目录 → 读现有文件 → `mergeGitHook` → 写回 +
  `chmod +x` → 按 status 打印一行。
- `degrade` 模式：打印手动接入说明（含可复制的 marker 块片段）。

## 测试（jest，根 `__tests__/cli/`，由根 jest 跑）

CLI 测试统一放在仓库根的 `__tests__/cli/`（例：`hooks-template.test.ts`、
`setup-agent-token.test.ts`），不在 `cli/` 内（`cli/package.json` 无 test 脚本）。

- `__tests__/cli/git-hook-template.test.ts`：`mergeGitHook` 四场景纯函数单测
  （created / updated / unchanged / appended）+ `resolveHookInstall` 降级判定
  （coreHooksPath 有 / 无）。
- `__tests__/cli/prepare-commit-msg-script.test.ts`：集成测试，用 `child_process`
  跑实际脚本块，喂临时 message 文件 + 在临时 git 仓库里造分支，断言四类行为：
  1. `lumo/LUM-149-x` 分支 + 无标记 message → 追加 ` [LUM-149]`
  2. message 已含 `[LUM-7]` → 不动
  3. 分支不含 `LUM-N` → 不动
  4. `$2=merge` → 不动

## 文档同步（CLAUDE.md 硬约定）

- `cli/src/commands/setup.ts` 行为变更 → 同步更新 `.claude/skills/lumo/SKILL.md`
  的 setup 章节：新增"安装 `prepare-commit-msg` git hook（分支名自动补 `[LUM-N]`）+
  husky/自定义 hooksPath 降级提示"说明。
- CLI 用户可见变更 → `cli/package.json` minor 版本 bump + 合并后手动
  `cd cli && npm publish`（CI 不发包）。PR 描述注明。

## 风险 / 注意

- 多 worktree：本仓库用 worktree-per-task；新 worktree 需 `node_modules` 软链到主
  checkout 才能跑 jest/tsc。
- 本仓库自身用 husky（`core.hooksPath=.husky/_`），所以在本仓库测 `lumo setup`
  会走**降级**分支——这正好验证降级路径，但意味着本仓库的 commit 不会被自动接管，
  除非手动把块加进 `.husky/prepare-commit-msg`。
- 脚本必须对 `set -e`、缺失 `grep -E` 等环境差异健壮；用 POSIX 基线写法。
