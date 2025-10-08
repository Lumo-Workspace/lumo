# Implementation Plan: Google OAuth Login

**Branch**: `001-google` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-google/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement Google OAuth 2.0 authentication to enable new and existing users to sign in using their Google accounts without password management. The system will integrate with Google's OAuth 2.0 API using NextAuth.js (Auth.js), provide seamless account creation for new users, support account linking for existing users, and maintain secure token storage with AES-256-GCM encryption. All components will use shadcn/ui framework for consistent, accessible UI.

## Technical Context

**Language/Version**: TypeScript 5 with strict mode enabled  
**Primary Dependencies**: Next.js 15.5.4, NextAuth.js 4.24.11, Prisma 6.17.0, React 19.2.0  
**Storage**: PostgreSQL via Prisma ORM (existing schema needs updates for OAuth tables)  
**Testing**: Jest 29.7.0 with React Testing Library - TDD MANDATORY  
**UI Framework**: shadcn/ui with Radix UI primitives and Tailwind CSS 4.1.9  
**UX Requirements**: WCAG 2.1 AA compliance, <30s OAuth flow completion, <2s page load, >95% task completion rate, mobile-first responsive design (320px+ and 1024px+ breakpoints)  
**Target Platform**: Web application (Next.js App Router with SSR/SSG capabilities)  
**Project Type**: Full-stack web application with Next.js API routes  
**Performance Goals**: <100ms interaction response, <2s page load, OAuth flow completion <30s, 95%+ success rate  
**Constraints**: HTTPS-only (TLS 1.3+), AES-256-GCM encryption for tokens, rate limiting (5 attempts/min/IP), 24hr session expiration  
**Scale/Scope**: Supporting new user onboarding, existing user migration, account linking functionality across 3 user stories (P1-P3)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Document-First Architecture ✅

- Feature specification exists and drives implementation planning
- Structured document format follows established template
- All requirements documented with clear acceptance criteria

### GitHub Integration ✅

- Feature branch created ([###-feature])
- Specification tracked in version control
- Implementation plan will generate GitHub issues and tracking

### Test-Driven Development ✅

- TDD mandatory for all implementation work
- Tests must be written before any production code
- Red-Green-Refactor cycle will be enforced
- Test coverage minimums: 80% new code, 70% modified code

### UX Prioritization ✅

- UX requirements must be validated through dedicated checklists
- User flows, accessibility, and usability criteria specified
- UI components must use shadcn/ui framework (if applicable)
- UX quality gates enforced before implementation

### AI Collaboration ✅

- Documents structured for AI consumption with clear metadata
- AI assistants can read and understand document context
- All specifications include executable instructions

### Structured Specifications ✅

- User scenarios prioritized and independently testable
- Acceptance criteria measurable and technology-agnostic
- Success criteria defined with concrete metrics

### Automated Execution ✅

- Specification capable of generating executable workflows
- Document changes will trigger appropriate GitHub actions
- Manual intervention minimized through automation

## Project Structure

### Documentation (this feature)

```
specs/001-google/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── auth-api.yaml   # Google OAuth API contracts
│   └── user-api.yaml   # User profile and session management contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
app/
├── api/
│   └── auth/
│       ├── [...nextauth]/
│       │   └── route.ts        # NextAuth.js API route handler
│       └── error/
│           └── route.ts        # OAuth error handling
├── login/
│   └── page.tsx                # Login page with Google OAuth button
└── dashboard/
    └── page.tsx                # Post-login dashboard (existing)

lib/
├── auth/
│   ├── config.ts               # NextAuth.js configuration
│   ├── callbacks.ts            # OAuth callbacks (signIn, jwt, session)
│   ├── user-creation.ts        # New user account creation logic
│   ├── account-linking.ts      # Link Google account to existing user
│   ├── account-merging.ts      # Merge accounts when email matches
│   ├── session-validation.ts   # Token validation and refresh
│   └── middleware.ts           # Auth middleware for protected routes
└── db/
    └── prisma.ts               # Prisma client instance (existing)

components/
├── auth/
│   ├── google-login-button.tsx # Google OAuth login button (shadcn/ui)
│   ├── user-profile.tsx        # User profile display
│   └── account-linking.tsx     # Account linking UI in settings
└── ui/
    └── [existing shadcn components]

prisma/
├── schema.prisma               # Database schema with OAuth models
└── migrations/
    └── [migration files]

tests/
├── auth/
│   ├── google-oauth.test.ts    # OAuth flow unit tests
│   ├── account-linking.test.ts # Account linking tests
│   └── token-encryption.test.ts # Token security tests
├── integration/
│   ├── oauth-flow.test.ts      # End-to-end OAuth integration
│   └── user-creation.test.ts   # New user creation flow
└── contract/
    └── google-api.test.ts      # Google OAuth API contract tests
```

**Structure Decision**: Full-stack Next.js web application using App Router. Authentication logic is centralized in `lib/auth/` directory, UI components follow shadcn/ui patterns in `components/auth/`, and API routes are under `app/api/auth/`. Prisma schema updates support OAuth models (User, Account, Session, VerificationToken). Testing structure separates unit, integration, and contract tests following TDD principles.

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

**Status**: ✅ No Constitution violations detected. All principles adhered to.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| None      | N/A        | N/A                                  |

---

## Planning Phase Completion Summary

### Phase 0: Research ✅ COMPLETE

**Deliverable**: `research.md`

**Key Decisions**:

- ✅ NextAuth.js v4 for Google OAuth integration
- ✅ AES-256-GCM encryption for OAuth tokens
- ✅ Prisma adapter with standard NextAuth.js schema
- ✅ Email-based account merging with user confirmation
- ✅ IP-based rate limiting with LRU cache
- ✅ Built-in NextAuth.js CSRF protection
- ✅ JWT session strategy with automatic token refresh
- ✅ shadcn/ui Button component for OAuth UI
- ✅ Centralized error handling with user-friendly messages
- ✅ WCAG 2.1 AA accessibility compliance

**All NEEDS CLARIFICATION items resolved**: Yes

---

### Phase 1: Design & Contracts ✅ COMPLETE

**Deliverables**:

1. ✅ `data-model.md` - Complete entity definitions, relationships, state transitions
2. ✅ `contracts/auth-api.yaml` - OpenAPI spec for authentication endpoints
3. ✅ `contracts/user-api.yaml` - OpenAPI spec for user management and GDPR compliance
4. ✅ `quickstart.md` - Developer implementation guide with TDD examples
5. ✅ Agent context updated (`cursor` agent)

**Data Model Coverage**:

- ✅ User entity with profile fields
- ✅ Account entity with encrypted OAuth tokens
- ✅ Session entity with 24-hour expiration
- ✅ VerificationToken entity for email verification
- ✅ Complete relationship diagram
- ✅ State transition flows (OAuth, account linking, token refresh)
- ✅ GDPR compliance operations (export/delete)
- ✅ Audit logging requirements
- ✅ Performance optimization strategies

**API Contract Coverage**:

- ✅ Authentication endpoints (signin, callback, session, signout, error, csrf)
- ✅ Account management endpoints (link, unlink)
- ✅ User profile endpoints (get, update)
- ✅ Privacy endpoints (export, delete)
- ✅ Session management endpoints (list, revoke)
- ✅ Security requirements documented
- ✅ Performance targets specified
- ✅ Monitoring metrics defined

**Quickstart Guide Coverage**:

- ✅ Google Cloud Console setup instructions
- ✅ Environment variable configuration
- ✅ Database schema and migration steps
- ✅ TDD examples for all core components
- ✅ Token encryption implementation
- ✅ NextAuth.js configuration
- ✅ OAuth callbacks and account merging
- ✅ UI components with accessibility
- ✅ Integration testing examples
- ✅ Deployment checklist
- ✅ Troubleshooting guide

---

### Constitution Check - Post-Design Re-evaluation

**Document-First Architecture** ✅

- Feature spec drives all design decisions
- All design artifacts reference spec requirements
- Implementation follows structured document hierarchy

**GitHub Integration** ✅

- Feature branch `001-google` active
- All specs tracked in version control
- Ready for `/speckit.tasks` to generate GitHub issues

**Test-Driven Development** ✅

- Quickstart guide includes TDD examples for all components
- Test-first approach documented for token encryption, callbacks, UI components
- Red-Green-Refactor cycle enforced in implementation guide

**UX Prioritization** ✅

- All UX requirements from spec mapped to implementation
- shadcn/ui components specified for all UI elements
- WCAG 2.1 AA compliance validated in quickstart guide
- User flows documented in data model state transitions

**AI Collaboration** ✅

- Agent context updated with new technologies
- All documents structured for AI consumption
- Clear metadata and relationships documented

**Structured Specifications** ✅

- User stories (P1-P3) mapped to implementation phases
- Acceptance criteria translated to API contracts
- Success criteria validated in quickstart success checklist

**Automated Execution** ✅

- Ready for `/speckit.tasks` command to generate executable tasks
- API contracts support automated testing and validation
- GitHub workflow integration prepared

---

## Next Phase: Task Generation

**Command**: `/speckit.tasks`

This planning phase (`/speckit.plan`) is now **COMPLETE**. The next step is to run the `/speckit.tasks` command to generate:

1. **tasks.md** - Detailed task breakdown with:
   - Granular implementation tasks for each user story (P1 → P2 → P3)
   - TDD workflow tasks (write test → run test → implement → refactor)
   - GitHub issue generation templates
   - Task dependencies and sequencing
   - Effort estimates and sprint planning

2. **GitHub Issues** - Automated issue creation from tasks.md

**Do NOT proceed with implementation until `/speckit.tasks` is run and tasks.md is generated.**

---

## Summary of Artifacts

| Artifact              | Status | Location                                   | Purpose                                 |
| --------------------- | ------ | ------------------------------------------ | --------------------------------------- |
| Feature Specification | ✅     | `specs/001-google/spec.md`                 | Requirements source of truth            |
| Implementation Plan   | ✅     | `specs/001-google/plan.md`                 | This document                           |
| Research Findings     | ✅     | `specs/001-google/research.md`             | Technology decisions and rationale      |
| Data Model            | ✅     | `specs/001-google/data-model.md`           | Database schema and entity design       |
| Auth API Contract     | ✅     | `specs/001-google/contracts/auth-api.yaml` | Authentication endpoint specifications  |
| User API Contract     | ✅     | `specs/001-google/contracts/user-api.yaml` | User management endpoint specifications |
| Quickstart Guide      | ✅     | `specs/001-google/quickstart.md`           | Developer implementation guide          |
| Task Breakdown        | ⏳     | `specs/001-google/tasks.md`                | **Next step**: Run `/speckit.tasks`     |

---

## Planning Metrics

- **Feature Branch**: `001-google`
- **User Stories**: 3 (P1: New user login, P2: Existing user login, P3: Account linking)
- **Functional Requirements**: 18 (FR-001 to FR-018)
- **Security Requirements**: 24 (SR-001 to SR-024)
- **UX Requirements**: 45 (UX-001 to UX-045)
- **Success Criteria**: 5 (SC-001 to SC-005)
- **API Endpoints**: 11 (authentication, account, user, session management)
- **Database Entities**: 4 (User, Account, Session, VerificationToken)
- **Research Topics**: 10 (all resolved with decisions)
- **Estimated Implementation Time**: 8-12 hours (from quickstart guide)
- **Test Coverage Target**: 80% new code, 70% modified code

---

**Planning Status**: ✅ **COMPLETE**  
**Next Command**: `/speckit.tasks`  
**Ready for Implementation**: After task generation
