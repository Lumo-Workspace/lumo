# CLAUDE.md

## Project

This is Lumo - a project management tool for small dev teams.
Stack: Next.js 14 (App Router), TypeScript, Prisma, Neon Postgres, Clerk auth, Tailwind CSS, shadcn/ui.

## Code Style

- TypeScript strict mode
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

- Use Jest (configured in jest.config.js)
- Test files go in **tests** directory
- File naming: \*.test.ts
- Run tests: npm test
- Every new function needs at least one test

## Git

- Branch naming: lumo/{task-id}-{short-description}
  Example: lumo/LUM-12-add-oauth-login
- PR title format: feat/fix/chore: description [LUM-N]
  Example: feat: add Google OAuth login [LUM-12]
- Commit message: type: description [LUM-N]
  Example: chore: add CLAUDE.md for agent instructions [LUM-5]
- Never push directly to main or develop

## Design Principles (SOLID + LoD)

- **SRP**: Each component, hook, or function does one thing. Don't mix data fetching, business logic, and rendering in a single component.
- **OCP**: Extend via composition (children, props, hooks), not by modifying existing components. Add new variants instead of adding flags to existing ones.
- **LSP**: Component variants must honor the same props contract. A `<PrimaryButton>` must be swappable with `<SecondaryButton>` without breaking callers.
- **ISP**: Pass only the props a component needs, not entire objects. Use `select` in Prisma queries to fetch only required fields.
- **DIP**: Components depend on abstractions (hooks, context) not implementations. Import from `@/lib/` wrappers, not directly from third-party SDKs.
- **LoD**: Components should not reach deep into nested props (`task.project.workspace.slug`). Parent extracts and passes flat values.

## React Rules

### Hooks

- Only call Hooks at the top level of function components or custom hooks
- Never call Hooks inside loops, conditionals, nested functions, try/catch, or after early returns
- Never call Hooks from regular JS functions, class components, or event handlers
- Never call Hooks inside callbacks passed to useMemo, useReducer, or useEffect

### Purity

- Components and Hooks must be idempotent — same inputs → same output, no side effects during render
- No `new Date()`, `Math.random()`, or other non-deterministic calls during render; move to useEffect or event handlers
- Never mutate props, state, or Hook return values directly — always create new copies
- Local mutation (variables created within the same render) is fine
- Side effects belong in event handlers or useEffect, never in render logic

### Component & Hook Calling

- Never call component functions directly (`Article()`); always use JSX (`<Article />`)
- Never pass Hooks as values or props — always call them directly inline
- Never dynamically create or wrap Hooks at runtime; define static versions upfront

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
- Repositories return Prisma query results, use `select` to fetch only needed fields
- New domain logic goes in `lib/services/`, never in API routes or components

## Project Structure

- app/ → Next.js App Router pages and API routes
- components/ → Shared UI components (shadcn/ui based)
- lib/ → Server-side utilities, auth helpers, DB queries
  - lib/repositories/ → Data access layer (Prisma queries)
  - lib/services/ → Business logic layer
  - lib/api-client/ → Frontend API client
  - lib/validation/ → Zod schemas (per domain)
- prisma/ → Schema and migrations
- types/ → Shared TypeScript types
- shared/ → Cross-project types, errors, constants (used by main app + agent-server)

## Database Migrations

- **Dev**: schema changes are applied locally via `prisma migrate dev`. If the dev DB has stale checksum drift on a previously-applied migration (Prisma rejects with P3008 / P3012), the workaround is: hand-write the SQL into `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `npx prisma db execute --file <path>`, record with `npx prisma migrate resolve --applied <name>`, then `npx prisma generate`. **Never** `prisma migrate reset` or direct-UPDATE `_prisma_migrations` without explicit user approval.
- **Production**: migrations are normally applied **only** by CI/CD running `prisma migrate deploy` on deploy — that is the default path. Do not apply a migration to production manually unless the user **explicitly authorizes it in the current session** (a generic standing approval doesn't count). Even with authorization: (a) confirm the exact migration(s) about to apply and call out any data-destructive steps before running anything, (b) use **only** `prisma migrate deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits to `_prisma_migrations`, (c) verify with `prisma migrate status` against the prod URL afterward.
- A merged PR with a new migration ≠ production is migrated. Production is migrated only after the deploy completes. After merging a schema-change PR, verify the migration applied on prod (deploy log, or `prisma migrate status` against the prod URL).
- When opening a PR with a schema change, mention in the description what production needs (e.g. "requires `migrate deploy` on next deploy", or call out any data-deletion the migration performs).

## Live Docs(活文档权威 md 源)

- 含表格/复杂结构的 Lumo 活文档,权威 markdown 源放在 `docs/live-docs/`(映射表见该目录 README)
- 编辑流程:改源文件 → `lumo doc update <docId> --file docs/live-docs/<file>.md` → `npx tsx scripts/verify-live-doc.ts <docId> docs/live-docs/<file>.md` 校验表格结构未丢(LUM-410 起服务端内置结构守卫:上传使表格/行/标题数缩水会被 422 拒,**有意删节**时加 `--allow-shrink`;非有意先查源/基底)
- 上传前先 `lumo doc diff <docId> --file docs/live-docs/<file>.md` 检查线上源是否已漂移(防 stale 上传覆盖,#460 事故类)
- **永远不要把 `lumo doc show` 的渲染输出当可回传源**——HTML→md 渲染有损,表格会被拍平成纯文本(LUM-349 事故根因);需要编辑基底用 `lumo doc show <docId> --raw`(LUM-408 起返回逐字节 markdown 源;无源时报错走重建流程,不会有损回退)
- **例外:研究吸收登记册(doc `cmq7c5cqi001v04lgwopkrti4`)是 live-doc-only**——唯一权威是活文档本身,repo 不保有它的 md 源,登记册变更不开 PR。编辑流程:`lumo doc show <docId> --raw` 取当前源为基底 → 改 → `doc diff` 确认只含本次编辑 → `doc update`;**严禁从任何 repo 历史版本的文件全量重推**(会抹掉活文档上更新的条目)。其余 live-doc 仍走上面的源文件流程(详见 `docs/live-docs/README.md` 例外节)

## CLI & Skills 同步

- 修改 `cli/src/commands/` 下的命令（新增子命令、改 flag、改输出格式、改触发条件）时，**必须同步更新** `.claude/skills/lumo/SKILL.md`：
  - frontmatter `description` **保持类别级、硬上限 1000 字符**——它是每个 session 常驻 context 的触发 prompt，不逐命令追加枚举触发词（LUM-392 前曾堆到 4k 字符/250 个短语）。只有出现全新 domain（新资源类型/新工作流环节）才动 description；新增用法的触发场景写进 SKILL.md 对应章节的 "When to suggest"（正文按需加载，不占常驻预算）
  - 对应的 `##` / `###` 章节要反映命令的真实行为（flags、示例、空字符串语义、状态枚举等）
- 例外：纯内部重构、错误文案微调、不影响调用方式的 bug fix 不需要更新文档
- 不要让 CLI 文档和实际行为漂移——agent 依赖 SKILL.md 决定调用方式，文档错了会反复踩坑
- **本地 commit-msg 钩子会机械化这条规则**(LUM-405,`scripts/drift-check.ts`)：commit 暂存了 `cli/src/commands/**` 却没动 `.claude/skills/lumo/SKILL.md`(或 `references/`)时打一条**非阻塞**漂移提醒。属上面「例外」清单(纯内部重构等)时，在 commit message 里加 `[skip-drift]` 静默该次检查——检查永不替你判断意图，由你显式断言、并留痕在 git 历史里

## Forbidden

- Never delete files in prisma/migrations/
- Never install new npm packages without noting it in PR description
- Never hardcode API keys or secrets
- Never push to main or develop directly

## PR Checklist

- [ ] Tests written and passing
- [ ] No TypeScript errors (npx tsc --noEmit)
- [ ] No console.log statements
- [ ] Branch name follows convention lumo/{task-id}-{description}
- [ ] PR title includes task ID [LUM-N]
- [ ] If `cli/src/commands/` changed → `.claude/skills/lumo/SKILL.md` updated to match
