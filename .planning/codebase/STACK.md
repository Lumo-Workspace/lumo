# Technology Stack

**Analysis Date:** 2026-04-09

## Languages

**Primary:**

- TypeScript 5 - Full codebase, strict mode enabled
- JavaScript (JSX/TSX) - React component language

**Secondary:**

- SQL - Prisma schema and migrations
- HTML/CSS - Via React/Tailwind

## Runtime

**Environment:**

- Node.js (via Next.js 16.2.2)
- Next.js 14+ App Router (full-stack framework)

**Package Manager:**

- npm
- Lockfile: `package-lock.json` (present)
- Workspaces: `shared/` and `agent-server/` subdirectories

## Frameworks

**Core:**

- Next.js 16.2.2 - Full-stack framework, App Router, API routes, middleware
- React 19.2.4 - UI component library

**UI & Components:**

- Tailwind CSS 4.2.2 - Utility-first CSS framework
- Radix UI (15+ components) - Headless component library for accessibility
- shadcn/ui 4.1.2 - Built on Radix UI, provides styled components
- Motion 12.38.0 - Animation library

**Forms & Validation:**

- React Hook Form 7.72.0 - Form state management
- Zod 4.3.6 - Schema validation (TypeScript-first)
- @hookform/resolvers 5.2.2 - Integration between RHF and validation libraries

**Rich Text & Markdown:**

- @tiptap/core 3.22.0 + extensions - WYSIWYG editor foundation
- @tiptap/react 3.22.0 - React bindings for Tiptap
- @tiptap/starter-kit 3.22.0 - Pre-configured Tiptap extensions (bold, italic, headings, lists, etc.)
- @tiptap/extension-\* (15+ extensions) - Code blocks, tables, mentions, images, links, highlights, etc.
- marked 17.0.5 - Markdown parser
- turndown 7.2.2 - HTML to Markdown converter
- mermaid 11.14.0 - Diagram rendering

**Data & Tables:**

- @tanstack/react-table 8.21.3 - Headless table library
- react-day-picker 9.14.0 - Date picker component
- date-fns 4.1.0 - Date manipulation

**Drag & Drop:**

- @dnd-kit/core 6.3.1 - Headless drag-and-drop
- @dnd-kit/sortable 10.0.0 - Sortable preset for dnd-kit
- @dnd-kit/utilities 3.2.2 - Helper utilities

**Real-time & Chat:**

- Pusher 5.3.3 (server) - WebSocket provider for real-time updates
- pusher-js 8.5.0 (client) - Pusher client library

**Internationalization:**

- react-intl 10.1.1 - i18n library with locale awareness

**UI Utilities:**

- Lucide React 1.7.0 - Icon library
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 3.5.0 - Merge Tailwind CSS classes
- tailwindcss-animate 1.0.7 - Tailwind animation utilities
- @tailwindcss/typography 0.5.19 - Typography plugin
- cmdk 1.1.1 - Command menu component
- sonner 2.0.7 - Toast notifications
- vaul 1.1.2 - Drawer/dialog component
- react-image-crop 11.0.10 - Image crop tool

**Themes:**

- next-themes 0.4.6 - Dark/light mode management

**Image Processing:**

- sharp 0.34.5 - Image optimization/resizing
- @google-cloud/storage 7.19.0 - Google Cloud Storage client

**Other:**

- lodash-es 4.18.1 - Utility library
- class-variance-authority 0.7.1 - CSS variant system

## Testing

**Framework:**

- Jest 30.3.0 - Test runner
- @testing-library/react 16.3.2 - React component testing utilities
- @testing-library/jest-dom 6.9.1 - Custom Jest matchers for DOM
- @testing-library/user-event 14.6.1 - User interaction simulation
- jest-mock-extended 4.0.0 - Advanced mocking utilities
- jest-environment-jsdom 30.3.0 - Browser-like test environment

**Configuration:**

- Config file: `jest.config.js`
- Setup file: `jest.setup.js`
- Coverage threshold: 80% (branches, functions, lines, statements)

## Build & Development

**Build Tools:**

- TypeScript 5 - Type checking via `tsc --noEmit`
- Prettier 3.8.1 - Code formatting
- ESLint 9.39.4 - Linting via `eslint-config-next`
- Husky 9.1.7 - Git hooks
- lint-staged 16.4.0 - Pre-commit linting
- @tailwindcss/postcss 4.2.2 - PostCSS for Tailwind
- PostCSS 8.5 - CSS transformation
- Autoprefixer 10.4.27 - CSS vendor prefixes
- SASS 1.98.0 - SCSS preprocessing

**Development:**

- cross-env - Cross-platform environment variables
- tsx 4.21.0 - TypeScript execution
- next-devtools-mcp 0.3.10 - Vercel dev tools MCP integration
- @modelcontextprotocol/sdk 1.29.0 - Model Context Protocol SDK

## Database

**Primary Database:**

- PostgreSQL via Neon (managed service)
- Connection via PgBouncer pooled/unpooled

**ORM & Query:**

- Prisma 7.6.0 - ORM and schema management
- @prisma/client 7.6.0 - Prisma JavaScript client
- @prisma/adapter-pg 7.6.0 - PostgreSQL adapter with extended pool support
- pg 8.20.0 - Native PostgreSQL driver
- @types/pg 8.20.0 - TypeScript types for pg

**Migrations:**

- Prisma Migrate - Built into Prisma CLI
- Location: `prisma/migrations/`

## AI & Agents

**Claude AI Integration:**

- @anthropic-ai/claude-agent-sdk 0.2.89 - Anthropic agent SDK for agentic workflows
- @anthropic-ai/claude-code 2.1.89 - Anthropic Claude Code integration
- ai 6.0.146 - Vercel AI SDK (generic LLM abstraction)
- @ai-sdk/gateway 3.0.88 - Vercel AI gateway for model routing

**Code Execution Sandbox:**

- @e2b/code-interpreter 2.4.0 - E2B sandbox for safe code execution

## External API Integrations

**GitHub:**

- @octokit/auth-app 8.2.0 - GitHub App authentication
- Native GitHub REST API via fetch

**Slack:**

- No SDK — Slack Web API via `fetch` (`lib/integrations/slack/`)

**Email:**

- Resend 6.10.0 - Transactional email service

**Cloud Storage:**

- @vercel/blob 2.3.2 - Vercel Blob for file storage
- @vercel/functions 3.4.3 - Vercel Functions helpers

## TypeScript Configuration

**File:** `tsconfig.json`

**Compiler Options:**

- `strict: true` - Strict type checking enabled
- `noEmit: true` - Type-check only, no emit
- `noImplicitAny: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `exactOptionalPropertyTypes: true`
- `noUncheckedIndexedAccess: true`
- `isolatedModules: true`
- Target: ES2017

**Path Aliases:**

- `@/*` → `./*` (project root)
- `@/components/*` → `./components/*`
- `@/hooks/*` → `./hooks/*`
- `@/utils/*` → `./utils/*`
- `@/types/*` → `./types/*`
- `@/constants/*` → `./constants/*`
- `@/lib/*` → `./lib/*`

**Excluded from type-checking:**

- `shared/`
- `agent-server/`

## Formatting & Linting

**Prettier Configuration (`prettierrc`):**

- Semi-colons: disabled
- Single quotes: enabled
- Tab width: 2 spaces
- Trailing comma: ES5
- Print width: 80 characters
- Arrow parens: avoid
- JSX single quotes: enabled
- Prose wrap: preserve

**ESLint Configuration (`eslint.config.mjs`):**

- Base config: `eslint-config-next/core-web-vitals`
- Additions:
  - `no-console: warn`
  - `no-debugger: warn`
  - `prefer-const: warn`
  - `react-hooks/exhaustive-deps: warn`
  - New react-hooks v7 rules downgraded to warn (purity, refs, set-state-in-effect, immutability, use-memo)

**Pre-commit Hooks (`lint-staged`):**

- `*.{js,jsx,ts,tsx}` → ESLint fix + Prettier write
- `*.{json,md,yml,yaml}` → Prettier write
- Managed via Husky 9.1.7

## Configuration Files

**Environment:**

- `.env.example` - Template with all required environment variables (18 vars documented)
- Database: `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (Neon Postgres)
- Auth: Clerk keys (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ENCRYPTION_KEY`
- Slack: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`
- Email: `RESEND_API_KEY`
- Storage: `BLOB_READ_WRITE_TOKEN` (Vercel Blob)
- AI: `OPENAI_API_KEY`
- App: `NEXT_PUBLIC_APP_URL`

**Build:**

- `next.config.mjs` - Minimal Next.js config (uses defaults)

**Tailwind:**

- `tailwind.config.ts` - Extends colors, borderRadius; includes `tailwindcss-animate` plugin

**Type Definitions:**

- `tsconfig.json`
- Type definitions in `types/` directory
- Auto-generated Prisma types in `.next/types/`

## Secrets & Encryption

**Token Encryption:**

- Algorithm: AES-256-GCM
- Key source: `ENCRYPTION_KEY` environment variable (64-char hex = 32 bytes)
- Implementation: `lib/crypto.ts`
- Format: `iv_hex:authTag_hex:ciphertext_hex`
- Used for: GitHub OAuth tokens, Slack tokens, state parameters

## Platform & Deployment

**Development:**

- Local: Node.js + npm, PostGres via Neon
- Next.js dev server: `npm run dev`

**Production:**

- Vercel (primary platform)
- PostGres: Neon (managed)
- Storage: Vercel Blob
- CI/CD: Next.js build pipeline

**Build Scripts:**

- `npm run build` - Prisma generate + Next.js build
- `npm run dev` - Next.js dev server
- `npm run start` - Next.js production server
- `npm run type-check` - TypeScript validation
- `npm run analyze` - Bundle analysis

---

_Stack analysis: 2026-04-09_
