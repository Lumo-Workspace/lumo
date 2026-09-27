# Lumo - AI-Powered Document & Project Management Platform

A comprehensive, modern document and project management platform built with Next.js, featuring AI-powered assistance, Kanban boards, team collaboration, and a Markdown editor experience.

## 🚀 Features

### 📝 Document Management

- **Markdown Editor**: Rich text editing with block-based content
- **Slash Commands**: Quick content insertion with `/` commands
- **Auto-save**: Automatic document saving with visual indicators
- **Page Hierarchy**: Nested page structure with expandable tree view
- **Context Menus**: Right-click actions for page management

### 🎯 Project Management

- **Team Structure**: Hierarchical organization (Teams → Projects → PRDs → Epics → Stories → Tasks)
- **Kanban Boards**: Drag-and-drop task management with status tracking
- **Story Creation Wizard**: Guided user story creation with quality checks
- **BMAD Framework**: Business Model and Design methodology integration
- **Progress Tracking**: Visual progress indicators and AI-powered summaries

### 🤖 AI Integration

- **AI Chat Assistant**: Contextual help and document assistance
- **Smart Suggestions**: AI-powered content recommendations
- **Progress Analysis**: Automated project progress insights
- **Quality Checks**: AI-assisted story validation

### 👥 Collaboration

- **Team Views**: Multiple view modes for different team needs
- **Notifications**: Real-time updates and mentions
- **Shared Documents**: Collaborative document sharing
- **Inbox**: Centralized notification management

### 🔐 Authentication & Security

- **Google OAuth Login**: Secure sign-in with Google accounts
- **Account Linking**: Link Google accounts to existing profiles
- **Session Management**: Secure session handling with automatic refresh
- **Data Protection**: AES-256-GCM encryption for sensitive data
- **GDPR Compliance**: Data export and deletion capabilities

### 🎨 Modern UI/UX

- **Responsive Design**: Works seamlessly across devices
- **Dark/Light Themes**: Theme switching support
- **Smooth Animations**: Polished user interactions
- **Accessibility**: WCAG compliant interface
- **Design System**: see [docs/design-system.md](docs/design-system.md) for tokens, typography scale, focus rings, motion, and z-index conventions — read before adding new components.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui + Radix UI primitives
- **Authentication**: NextAuth.js v5 with Google OAuth 2.0
- **Database**: PostgreSQL with Prisma ORM
- **State Management**: React Hooks
- **Icons**: Lucide React
- **Drag & Drop**: @hello-pangea/dnd
- **Forms**: React Hook Form + Zod validation
- **Date Handling**: date-fns
- **Testing**: Jest + React Testing Library (TDD)

## 📦 Installation

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun

### Setup

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd lumo
   ```

2. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   # or
   bun install
   ```

3. **Start the development server**

   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   # or
   bun dev
   ```

4. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🏗️ Project Structure

```
lumo/
├── app/                    # Next.js App Router
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Home page
│   └── test-kanban/       # Test pages
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── kanban/           # Kanban-specific components
│   ├── story-wizard/     # Story creation wizard
│   ├── ai-chat.tsx       # AI chat interface
│   ├── kanban-board.tsx  # Main Kanban board
│   ├── markdown-editor.tsx # Main editor component
│   └── sidebar.tsx       # Application sidebar
├── hooks/                # Custom React hooks
│   ├── use-pages.ts      # Page management
│   ├── use-teams.ts      # Team/project management
│   ├── use-blocks.ts     # Document blocks
│   └── use-ui-state.ts   # UI state management
├── lib/                  # Utility libraries
├── utils/                # Helper functions
└── styles/               # Additional styles
```

## 🎯 Usage

### Document Editing

1. **Create Pages**: Click the "+" button in the sidebar
2. **Edit Content**: Click on any page to start editing
3. **Use Slash Commands**: Type `/` to access quick insertion menu
4. **Navigate**: Use the page tree to move between documents

### Project Management

1. **Team Setup**: Create teams and projects in the Teams view
2. **Create Stories**: Use the Story Creation Wizard for structured user stories
3. **Kanban Management**: Drag and drop tasks between status columns
4. **Track Progress**: Monitor project progress with AI-powered insights

### Authentication

1. **Sign In**: Click "Sign in with Google" to authenticate
2. **Account Linking**: Link Google accounts to existing profiles in settings
3. **Account Management**: Manage connected accounts and security settings

### AI Assistant

1. **Open AI Chat**: Click the AI button in the sidebar
2. **Ask Questions**: Get help with document editing and project management
3. **Fullscreen Mode**: Toggle fullscreen for focused AI interaction

## 🔧 Configuration

### Environment Variables

Create a `.env.local` file in the root directory:

```env
# Database
SUPA_POSTGRES_PRISMA_URL="postgresql://username:password@localhost:5432/lumo"
SUPA_POSTGRES_URL_NON_POOLING="postgresql://username:password@localhost:5432/lumo"

# NextAuth.js
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"

# Google OAuth
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption Keys (generate with: openssl rand -base64 32)
ACCESS_TOKEN_KEY="your-32-byte-encryption-key"
REFRESH_TOKEN_KEY="your-32-byte-encryption-key"
```

### Database Setup

1. **Install PostgreSQL** and create a database
2. **Run Prisma migrations**:
   ```bash
   npx prisma migrate dev
   ```
3. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (development)
   - `https://yourdomain.com/api/auth/callback/google` (production)

### Customization

- **Themes**: Modify `tailwind.config.ts` for custom styling
- **Components**: Extend UI components in `components/ui/`
- **Hooks**: Add custom logic in `hooks/`

## 📱 Responsive Design

The platform is fully responsive and works on:

- Desktop (1024px+)
- Tablet (768px - 1023px)
- Mobile (320px - 767px)

## 🔐 GitHub App permissions

A workspace connects GitHub over **two grants with different jobs**, both
shown as their own row in workspace → settings → integrations:

| Grant                               | Identity                    | Does                                                                                                                                     |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **App installation** (team)         | the Lumo App, per workspace | everything that touches a repository: repo list, PR links, webhooks, comment mirroring, the managed security scan's clone                |
| **OAuth link** (personal, optional) | the member who linked it    | identity only — records which GitHub login is this member, so comments arriving from GitHub are attributed to them in Lumo (`read:user`) |

Nothing runs on a member's token. Every mirrored comment is posted by the App
with an attribution line linking back to the Lumo comment; the App cannot
speak as a person, and that link is what preserves "who said this". The
repository set is chosen in GitHub's install settings, not in Lumo. **A
workspace without the App installed is not scanned** — the card says so.

The Lumo GitHub App (`GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`) needs this
minimum permission set:

| Permission      | Access       | Used by                                              |
| --------------- | ------------ | ---------------------------------------------------- |
| Contents        | Read         | file reads, PR diffs, security-scan clone            |
| Pull requests   | Read & write | PR head sha, change volume, comment mirror (LUM-546) |
| Issues          | Read & write | comment mirror (issue comments)                      |
| Checks          | Read         | CI signal for the gate audit (LUM-616)               |
| Commit statuses | Read         | CI signal (Status API providers)                     |
| Metadata        | Read         | mandatory                                            |

### Installation flow

`GITHUB_APP_SLUG` names the App in its install URL, and
`GITHUB_APP_WEBHOOK_SECRET` is the secret configured on the **App's own**
webhook (a different delivery from the per-repo hooks OAuth creates — both
arrive at `/api/webhooks/github` and are verified against different secrets).
`GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` are the **App's** client
credentials (not the OAuth App's `GITHUB_CLIENT_ID`), and the App's
**Callback URL** must include `https://<your-domain>/api/github/app/callback`;
leave "Request user authorization during installation" off. Without them no
installation can be recorded (LUM-875).

1. The settings card sends the owner to `/api/github/app/install`, which
   redirects to the App's install page with an encrypted `state` naming the
   workspace.
2. GitHub returns to `/api/github/app/setup`, which re-checks that the
   signed-in caller is a member of that workspace (the state carries context,
   never authority). The `installation_id` GitHub appends is attacker-
   controllable, so setup stores nothing: it sends the caller to authorize the
   App, and `/api/github/app/callback` exchanges the code for a user token,
   checks `GET /user/installations` lists that installation, revokes the
   token, and only then reads and stores the installation (LUM-875).
3. The App webhook keeps the record current: `installation` (created /
   deleted / suspend / unsuspend / new_permissions_accepted) and
   `installation_repositories` (added / removed). A suspended or deleted
   installation drops the record — a workspace that cannot be cloned must not
   be shown as installed. Newly reachable repositories get their existing pull
   requests backfilled.
4. Repository events (`pull_request`, `push`, `check_suite`, `status`,
   `issue_comment`, `pull_request_review`, `pull_request_review_comment`)
   arrive on the same App webhook and are attributed through `installation.id`.
   **Subscribe the App to all of these.** Repo hooks created by the old OAuth
   flow still deliver too; while one exists for a repository the App copy of
   that event is dropped so nothing is handled twice, and the App takes over
   on its own once the hook is removed (disconnecting the OAuth link deletes
   the hooks it created).
5. Access recheck (LUM-882). Binding and owner re-verification record the
   verifier's GitHub login (an identifier; the user token is still revoked).
   A daily cron (`/api/cron/recheck-github-access`) asks GitHub, with the
   installation token, whether that login can still read each confirmed
   repository (`collaborators/{login}/permission`, Metadata read — no extra
   App permission); repositories it cannot read are removed and their scan
   code scrubbed. **Subscribe the App to the `repository` event** too:
   `privatized` / `transferred` trigger the same check for that repository
   straight away. Installations bound before LUM-882 have no login on record
   and are not rechecked until an owner re-verifies once.

**No fallback.** A workspace with no installation record gets no GitHub
token at all — every GitHub call for it fails with "install the Lumo GitHub
App". (Before LUM-852 it borrowed the global `GITHUB_APP_INSTALLATION_ID`,
Lumo's own installation; that env var is no longer read.)

## 🛡️ Security scan

Lumo runs semgrep, gitleaks, osv-scanner, zizmor and trivy itself for every
pull request of a repository the GitHub App is installed on — no workflow
file, no secret, no GitHub Actions minutes, and no GitHub Advanced Security
are required. zizmor audits GitHub Actions workflows (template injection,
`pull_request_target` misuse, persisted credentials, unpinned actions) and
runs offline: it never calls the GitHub API, so no token is handed to it and
no action reference leaves the sandbox. `trivy config` checks Dockerfiles,
Kubernetes manifests, Helm charts, Terraform and CloudFormation for
misconfigurations of MEDIUM severity and above; it downloads trivy's public
check bundle, and nothing from the repository leaves the sandbox. semgrep
loads the registry packs plus Lumo's own rules for LLM-specific defects
(`security/semgrep-rules/`: request input reaching a prompt unparsed, a system
prompt built from runtime values), and the diff subgraph is checked for a model
result that reaches raw SQL, a shell, `eval`, a file write or `fetch` with no
schema parse in between — reported deterministically, without a model. The
PR's head commit is shallow-cloned into a one-shot Vercel Sandbox microVM
owned by Lumo (the same vendor that hosts the app), scanned, and the VM is
destroyed; only findings on lines the PR added are kept, redacted, and
nothing else from the repository is stored. Results show up in three places:
the task's security panel, a review on the pull request itself (one summary
comment plus inline comments on the affected lines, deduplicated across
re-scans), and `lumo task status`, which prints one line per PR with each
scan layer's state and any scanner failure reason.

**Sandbox isolation.** The clone token is minted for that one repository
with `contents: read` only, and revoked (`DELETE /installation/token`) as
soon as the clone is done. Before any scanner reads the checkout, Lumo
proves the token is not readable anywhere in the VM (`.git/config`, the
command environment, `~/.git-credentials`, `~/.netrc`, `~/.gitconfig`) and
refuses to scan if it cannot. Scanners are downloaded first; after that the
VM can reach only `semgrep.dev`, `api.osv.dev` and `api.deps.dev` while the
scanners run, and nothing at all while the AI hunt reads the code.

**Dependencies.** osv-scanner reads the repository's lockfiles and manifests
inside that same sandbox and queries the public [osv.dev](https://osv.dev)
API for known advisories — package names and versions leave the sandbox for
that lookup, nothing else. A vulnerable dependency has no "line the PR added",
so Lumo keeps a per-repository baseline instead: the fingerprint set of the
default branch's last scan, refreshed on every push to that branch (and built
lazily the first time a PR is scanned). A dependency finding already in the
baseline is shown muted as _already on the default branch_; only the ones a
PR introduces count as open. Dependency findings are advisory and never block
a task from reaching Done.

**Bring your own scanner (optional).** Teams that want their own tools or
rule sets can push SARIF to `POST /api/integrations/security/sarif/upload` +
`/complete` from any CI, authenticated with a GitHub Actions OIDC token or a
CI ingest key. No secret is required from a GitHub Actions workflow: it
requests its own OIDC ID token (`permissions.id-token: write`) and Lumo
verifies that token's `repository` and `ref` claims to authenticate the push;
a CI ingest key (Lumo → Settings → API keys, sent as `LUMO_SECURITY_TOKEN`) is
the fallback for CI systems other than GitHub Actions. This path runs in the
customer's own CI and consumes their Actions minutes — Lumo's managed scan
above does not. Each scanner job gzips its SARIF report and uploads it
directly to a private Vercel Blob, then tells Lumo the report is ready to
fetch. Diff-aware filtering — keeping only the lines the PR actually added —
happens on Lumo's side after ingest. The blob is deleted once Lumo has parsed
it, and any report that fails to parse is deleted 24h later; a report whose
ingest never even started is swept after 48h. GitHub only issues the OIDC
token on the `pull_request` event, and does not issue it to a fork's PR
workflow run, so nothing is reported for fork PRs from this path.

**What the OIDC token proves — and what it doesn't.** The token identifies the
repository, not a person, so anyone who can push a branch to the repository can
have a workflow run push security reports for that repository's pull requests —
exactly the trust the repository already places in its own CI. Pull requests
opened from forks receive no OIDC token at all and are therefore never reported
on. Reports are attributed to the workspace that owns the `PullRequest` row
they land on, so re-linking a repository to another workspace leaves the old
workspace's existing PR rows (and their findings) where they are.

**Unknown-vulnerability hunt (L3).** When a pull request touches an API
route or server action, a dangerous call (raw SQL, child processes, `fetch`,
`eval`, file writes, LLM calls) or an authentication / validation check, Lumo
builds an in-memory call subgraph of the touched TypeScript files plus their
direct imports, sends that map — and, on demand, the touched files — to the
model gateway for a bounded hunt across six checklists (IDOR, injection,
SSRF, prompt injection, races, business logic), mechanically checks every
candidate against the subgraph (symbols, line numbers and the full call
chain must exist), and lets a second model try to refute what survives.
Only unrefuted candidates become findings, always advisory: they never block
Done. Budget ≤ 150k tokens / 200 s per scan; nothing from the repository is
stored beyond the finding's symbols, line numbers and redacted text. Set
`LUMO_SECURITY_HUNT=off` to disable the hunt for a deployment.

**Policy, suggestions and what reaches the PR (LUM-740).** Which findings
block a task from reaching Done is a per-workspace policy
(`Workspace.securityPolicy`, `{ "block": [{ "provenance", "severity" }] }`,
set through `PATCH /api/workspaces/me`); unset, only an undispositioned
pattern-matched (deterministic) HIGH finding blocks, exactly as before. LLM
findings — the hunt above and the LLM review — can never be configured to
block: the API refuses the value and the reader ignores it. Every
external-tool finding also goes through a falsifier once (a second model
that may only refute, never confirm — `LUMO_SECURITY_SUGGEST=off` disables
it); a refutation becomes a _suggested_ false positive with the model's
reasoning, shown in the panel with a one-click "confirm all" for humans, and
each confirm or overrule is recorded so the suggestion's precision can be
measured (`scripts/analysis/lum740-suggestion-precision`). To keep the pull
request readable, LOW-severity findings (test and fixture paths, placeholder
values) and suggested false positives get no inline comment — the summary
comment carries one line for each group and links to Lumo — and the summary
itself is updated in place by the comment id stored on the scan, so
concurrent scan layers never post a second one. A GitHub check-run
(`lumo/security`) is deliberately not posted: it would need the App's
`Checks: write` permission, which every installation would have to
re-accept, and the summary comment already carries the same verdict; it will
be added when a team asks for it as a required status in branch protection.

**Trust boundary.** The managed scan uses the App's existing `Contents: read`
permission — no new GitHub permission is requested — and the clone lives only
inside the one-shot Vercel Sandbox VM for the duration of the scan before the
VM is destroyed. Set `LUMO_MANAGED_SCAN=off` to disable the managed scan for a
deployment; the BYO path above still works when it is off.

**Cost controls.** Every managed scan is a 2 vCPU Vercel Sandbox capped at
12 minutes. Three guards keep a webhook storm from turning into a bill: when
a pull request gets a newer commit, the still-pending scan of the older commit
is marked _superseded_, its workflow run is cancelled and its sandbox stopped;
a scan whose scanner has not reported within 45 minutes is marked failed by a
sweep that runs every 15 minutes, so nothing reads "scanning" forever; and
each workspace may start at most `LUMO_MANAGED_SCAN_HOURLY_CAP` managed scans
per rolling hour (default 20) — beyond that the scan is recorded as failed
with a `rate-limited` reason and no sandbox starts. The hard ceiling is
Vercel's own Spend Management (project → Settings → Billing → Spend
Management): set an amount, a notification email, and enable pausing so a
runaway never outlives the budget. That setting is made once in the
dashboard, not in code.

**Tests and builds come from your own CI.** Lumo runs static analysis only
(the scan above) and never executes a repository's tests or build. The
typecheck / test / build verdicts on a task's delivery gates are read back from
the checks your CI reports on the pull request (GitHub check runs and commit
statuses); a check is recognised by its name (`typecheck` / `tsc`, `test` /
`jest` / `vitest`, `build` / `deploy`, …).

## 🚀 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Deploy with zero configuration

**Migration gate (LUM-682):** `vercel.json` sets the build command to
`scripts/deploy/vercel-build.sh`. On a **production** deploy this runs
`prisma migrate deploy` (plus a `prisma migrate status` drift check) **before**
`next build`, so migrations are applied ahead of the code that depends on them —
a failed/blocked migration fails the build instead of shipping code against a
not-yet-migrated schema. Preview/dev builds skip the migrate step. Migrations
use the unpooled connection automatically via `prisma.config.ts`.

### Other Platforms

```bash
# Build the application
npm run build

# Start production server
npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- UI components from [Radix UI](https://www.radix-ui.com/)
- Icons from [Lucide](https://lucide.dev/)
- Styling with [Tailwind CSS](https://tailwindcss.com/)

## 📞 Support

For support, email support@lumo.ai or create an issue in the repository.

---

**Lumo** - Empowering teams with AI-driven project management and document collaboration.
