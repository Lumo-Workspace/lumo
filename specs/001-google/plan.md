# Implementation Plan: Google OAuth Login

**Branch**: `001-google` | **Date**: 2025-01-27 | **Spec**: [spec.md](/Users/chaoli/Projects/lumoai/lumo/specs/001-google/spec.md)
**Input**: Feature specification from `/specs/001-google/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Primary requirement: Enable new users to sign in using Google OAuth 2.0 for seamless authentication without password management. Technical approach: Integrate Google OAuth 2.0 API with Next.js frontend, implement secure token storage with encryption, and provide account linking functionality for existing users.

## Technical Context

**Language/Version**: TypeScript 5+ with Next.js 15+ App Router  
**Primary Dependencies**: NextAuth.js, Google OAuth 2.0 API, React Hook Form, Zod validation  
**Storage**: PostgreSQL with Prisma ORM for user profiles, OAuth tokens, and account merging  
**Testing**: Jest + React Testing Library - TDD MANDATORY  
**Target Platform**: Web browser (desktop/mobile responsive)  
**Project Type**: Web application (Next.js single project)  
**Performance Goals**: 30-second login completion, 95% OAuth success rate, <2s page load  
**Constraints**: HTTPS-only, encrypted token storage, GDPR compliance for user data  
**Scale/Scope**: 1000+ concurrent users, 10k+ user profiles, 3 user stories (P1-P3)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Document-First Architecture ✅

- Feature specification exists and drives implementation planning
- Structured document format follows established template
- All requirements documented with clear acceptance criteria

### GitHub Integration ✅

- Feature branch created (001-google)
- Specification tracked in version control
- Implementation plan will generate GitHub issues and tracking

### Test-Driven Development ✅

- TDD mandatory for all implementation work
- Tests must be written before any production code
- Red-Green-Refactor cycle will be enforced
- Test coverage minimums: 80% new code, 70% modified code

### AI Collaboration ✅

- Specification structured for AI consumption
- Clear metadata and relationships defined
- AI assistants can understand and assist with components

### Structured Specifications ✅

- User scenarios with priorities (P1-P3) defined
- Acceptance criteria testable and measurable
- No implementation details in specification
- Success criteria technology-agnostic

### Automated Execution ✅

- Specification can generate executable workflows
- OAuth flow implementation planned with NextAuth.js
- Account linking and merging functionality specified with Prisma ORM
- API contracts defined for GitHub integration
- Test coverage planned for all user stories (P1-P3)

### Post-Design Validation ✅

- All technical unknowns resolved (database choice: PostgreSQL + Prisma)
- Data model designed with proper relationships and constraints
- API contracts created for external integration
- Quickstart guide provides implementation roadmap
- Agent context updated for AI assistance
- TDD test structure planned for all components

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
app/
├── api/
│   └── auth/
│       └── [...nextauth]/
├── login/
│   └── page.tsx
├── signup/
│   └── page.tsx
└── dashboard/
    └── page.tsx

components/
├── auth/
│   ├── google-login-button.tsx
│   ├── auth-provider.tsx
│   └── account-linking.tsx
└── ui/
    ├── button.tsx
    ├── dialog.tsx
    └── toast.tsx

lib/
├── auth/
│   ├── config.ts
│   ├── providers.ts
│   └── types.ts
├── db/
│   ├── schema.ts
│   └── migrations/
└── utils/
    ├── encryption.ts
    └── validation.ts

tests/
├── __mocks__/
├── auth/
│   ├── google-login.test.tsx
│   ├── account-linking.test.tsx
│   └── auth-provider.test.tsx
├── integration/
│   ├── oauth-flow.test.ts
│   └── account-merging.test.ts
└── contract/
    └── google-api.test.ts
```

**Structure Decision**: Next.js single project structure with App Router. All authentication logic centralized in `/lib/auth/`, OAuth components in `/components/auth/`, and comprehensive test coverage including unit, integration, and contract tests for TDD compliance.

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |
