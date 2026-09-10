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

The Lumo GitHub App (`GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`) needs this
minimum permission set. Everything Lumo reads or writes on GitHub goes through
an installation token of this App; the OAuth connection only creates the repo
webhook.

| Permission      | Access       | Used by                                              |
| --------------- | ------------ | ---------------------------------------------------- |
| Contents        | Read         | file reads, PR diffs                                 |
| Pull requests   | Read & write | PR head sha, change volume, comment mirror (LUM-546) |
| Issues          | Read & write | comment mirror (issue comments)                      |
| Checks          | Read         | CI signal for the gate audit (LUM-616)               |
| Commit statuses | Read         | CI signal (Status API providers)                     |
| Metadata        | Read         | mandatory                                            |

## 🛡️ Security scan

Lumo runs semgrep and gitleaks itself for every pull request of a repository
the GitHub App is installed on — no workflow file, no secret, no GitHub
Actions minutes, and no GitHub Advanced Security are required. The PR's head
commit is shallow-cloned into a one-shot Vercel Sandbox microVM owned by Lumo
(the same vendor that hosts the app), scanned, and the VM is destroyed; only
findings on lines the PR added are kept, redacted, and nothing else from the
repository is stored. Results show up in three places: the task's security
panel, a review on the pull request itself (one summary comment plus inline
comments on the affected lines, deduplicated across re-scans), and
`lumo task status`, which prints one line per PR with each scan layer's state
and any scanner failure reason.

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

**Trust boundary.** The managed scan uses the App's existing `Contents: read`
permission — no new GitHub permission is requested — and the clone lives only
inside the one-shot Vercel Sandbox VM for the duration of the scan before the
VM is destroyed. Set `LUMO_MANAGED_SCAN=off` to disable the managed scan for a
deployment; the BYO path above still works when it is off.

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
