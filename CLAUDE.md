# CLAUDE.md

## Project

This is Lumo - a project management tool for small dev teams.
Stack: Next.js 14 (App Router), TypeScript, Prisma, Neon Postgres, Clerk auth, Tailwind CSS, shadcn/ui.

## Code Style

- Use async/await, not .then()
- No console.log in production code, use proper logging
- Prefer named exports over default exports
- Use Prisma for all database access — never raw SQL

## i18n

- All user-facing strings use react-intl (`intl.formatMessage`)
- Locale files live in `lib/i18n/` — when adding or updating a key, update **every** locale file, not just en.json and zh-CN.json
- Never use English as a fallback for non-English locales — provide a proper translation for each language
- To scaffold the other locales after editing `en.json`, run `npm run i18n:sync` — it back-fills missing keys with `[TODO:<locale>] …` placeholders so the parity test passes; replace the `[TODO:…]` markers with real translations before shipping (never leave the English placeholder). Use `npm run i18n:check` to detect drift without writing.

## Testing

- Use Jest; new tests go under `__tests__/` (a small legacy `tests/` tree also runs)
- File naming: \*.test.ts (\*.test.tsx when the test renders JSX)
- Run tests: npm test
- Every new function needs at least one test

## Git

- Branch naming: lumo/{task-id}-{short-description}
  Example: lumo/LUM-12-add-oauth-login
- PR title format: feat/fix/chore: description [LUM-N]
  Example: feat: add Google OAuth login [LUM-12]
- Commit message: type: description [LUM-N]
  Example: chore: add CLAUDE.md for agent instructions [LUM-5]

## Design Principles (SOLID + LoD)

Apply SOLID + Law of Demeter. Lumo-specific house rules:

- One responsibility per unit — don't mix data fetching, business logic, and rendering in one component (SRP).
- Extend via composition and new variants, not flags on existing components; variants honor the same props contract (OCP/LSP).
- Pass only the props a component needs; use Prisma `select` to fetch only required fields (ISP).
- Depend on abstractions: import from `@/lib/` wrappers, never third-party SDKs directly (DIP).
- Don't reach into nested props (`task.project.workspace.slug`) — parent extracts and passes flat values (LoD).

## React Rules

Follow React's canonical [Rules of Hooks and render purity](https://react.dev/reference/rules). The recurring trap here is impure render — no `new Date()` / `Math.random()` / prop-or-state mutation during render; side effects belong in event handlers or `useEffect`.

## Layered Architecture

数据流: `Component → API Client → API Route → Service → Repository → Prisma/DB`

| 层             | 位置                | 职责                                            | 禁止                           |
| -------------- | ------------------- | ----------------------------------------------- | ------------------------------ |
| **Repository** | `lib/repositories/` | 封装 Prisma 查询，返回领域模型                  | 不含业务逻辑、不做权限校验     |
| **Service**    | `lib/services/`     | 业务逻辑编排：状态机、校验、通知触发            | 不直接访问 Prisma，不处理 HTTP |
| **API Route**  | `app/api/`          | 参数解析、Zod 校验、调用 Service、返回 Response | 不含业务逻辑，不含 Prisma 查询 |
| **API Client** | `lib/api-client/`   | 封装 fetch()，统一错误处理，类型安全            | 不含 UI 逻辑                   |
| **Component**  | `components/`       | 渲染 UI、调用 API Client、管理 UI 状态          | 不直接 fetch，不含业务逻辑     |

- API routes should be thin (~50-100 lines): auth check → validate input → call service → return response
- Services throw errors with `Object.assign(new Error(msg), { status })` pattern

## Project Structure

Standard Next.js App Router layout. Only the non-obvious bits (not derivable by exploration):

- `lib/validation/` → Zod schemas per domain.
- `shared/` → cross-project types/errors/constants used by **both** the main app and agent-server.

## Database Migrations

- **Dev**: schema changes are applied locally via `prisma migrate dev`. If the dev DB has stale checksum drift on a previously-applied migration (Prisma rejects with P3008 / P3012), the workaround is: hand-write the SQL into `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `npx prisma db execute --file <path>`, record with `npx prisma migrate resolve --applied <name>`, then `npx prisma generate`. **Never** `prisma migrate reset` or direct-UPDATE `_prisma_migrations` without explicit user approval.
- **Production**: migrations are normally applied **only** by CI/CD running `prisma migrate deploy` on deploy — that is the default path. Do not apply a migration to production manually unless the user **explicitly authorizes it in the current session** (a generic standing approval doesn't count). Even with authorization: (a) confirm the exact migration(s) about to apply and call out any data-destructive steps before running anything, (b) use **only** `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations`, (c) verify with `prisma migrate status` against the prod URL afterward.
- A merged PR with a new migration ≠ production is migrated. Production is migrated only after the deploy completes. After merging a schema-change PR, verify the migration applied on prod (deploy log, or `prisma migrate status` against the prod URL).
- When opening a PR with a schema change, mention in the description what production needs (e.g. "requires `migrate deploy` on next deploy", or call out any data-deletion the migration performs).

## Destructive Migrations

Dropping/renaming a column, table or enum value takes two releases: stop using it, then drop. Guard + rollback: [`docs/database-migrations.md`](docs/database-migrations.md).

## Live Docs(活文档权威 md 源)

含表格/复杂结构的活文档以 `docs/live-docs/` 下的源文件为唯一可编辑入口。**关键红线**:永远不要把 `lumo doc show` 的渲染输出当可回传源(HTML→md 有损,表格会被拍平——LUM-349 事故根因);编辑基底用 `lumo doc show <docId> --raw`。完整编辑流程(结构守卫 / `doc diff` 防 stale 上传 / verify 脚本)与登记册 live-doc-only 例外,见 [`docs/live-docs/README.md`](docs/live-docs/README.md)。

## CLI & Skills 同步

- Lumo skill 指南不再安装到任何位置；`lumo init` 只写项目级**冻结 stub**（`.claude/skills/lumo/SKILL.md`、`.agents/skills/lumo/SKILL.md`，源在 `cli/src/lib/skill-stub.ts`）。**永远不要改 `LUMO_SKILL_STUB`**（改了=所有仓库须重跑 init；`skill-stub.test.ts` 有冻结守卫）。指南源在 `cli/skill/`（SKILL.md + `references/`），由 `lumo skill read [path]` 从 npm 包按需输出；SessionStart 只注入一段指针（文本在 `cli/src/lib/skill-pointer.ts`，≤600 字符、类别级，不逐命令枚举）
- 修改 `cli/src/commands/` 下的命令（新增子命令、改 flag、改输出格式、改触发条件）时，**必须同步更新** `cli/skill/`：对应章节反映真实行为（flags、示例、空字符串语义、状态枚举）；示例 / flags / "When to suggest" 归 `references/`，SKILL.md 只留一行摘要 + 链接。无 frontmatter/description 上限；**单文件预算**≤24KB、SKILL.md ≤10KB，由 `__tests__/cli/skill-budget.test.ts` 强制
- 例外：纯内部重构、错误文案微调、不影响调用方式的 bug fix 不需要更新文档
- 命令树变了同 PR 跑 `npx tsx scripts/cli-grammar/emit-grammar.ts` 重生成 grammar.json
- **本地 commit-msg 钩子会机械化这条规则**(LUM-405,`scripts/drift-check.ts`)：commit 暂存了 `cli/src/commands/**` 却没动 `cli/skill/**` 时打一条**非阻塞**漂移提醒。属「例外」时在 commit message 加 `[skip-drift]` 静默——由你显式断言、留痕在 git 历史里

## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly

## PR Checklist

Before opening a PR: tests + `npx tsc --noEmit` pass, no `console.log`; branch/PR-title follow the **Git** conventions; if `cli/src/commands/` changed, `cli/skill/` is updated (see **CLI & Skills 同步**); honor the **Forbidden** list.

## 维护本文件(软预算)

CLAUDE.md 是常驻 context,每条指令都被遵守且必付推理成本,收益只在信息**非冗余**时出现(ETH, arXiv 2602.11988);context file 易「只加不删」单调膨胀(arXiv 2511.12884)。故:

- **软预算 ~9500 字符**(`wc -m CLAUDE.md`):软上限,超出时**先瘦身再加**。
- **新增段落先自证非冗余**:agent 靠探索 / strict TS+Prisma+Zod / README / `docs/` 推得出的(目录枚举、通用 SOLID/React 规则)不写(ETH 证伪目录枚举式 overview 对探索步数零增益)。
- **保留 Lumo 独有指令**:删减只动他处已有同等信息的确定冗余;Forbidden / Database Migrations 等安全红线一字不动。
- **不做 LLM 自动生成**本文件(ETH:删仓库文档后让模型自动生成反增 ~2.7% 成本)。
