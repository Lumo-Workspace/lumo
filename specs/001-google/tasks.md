---
description: 'Task list template for feature implementation'
---

# Tasks: Google OAuth Login

**Input**: Design documents from `/specs/001-google/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: TDD is MANDATORY. All user stories MUST include test tasks following the Red-Green-Refactor cycle. Tests must be written and failing before any implementation begins.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: Next.js App Router structure with `/app/`, `/components/`, `/lib/`
- Paths shown below assume Next.js project structure
- All paths relative to repository root

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project structure per implementation plan
- [x] T002 [P] Initialize Next.js project with TypeScript and required dependencies
- [x] T003 [P] Configure Jest and React Testing Library for TDD
- [x] T004 [P] Setup Prisma ORM with PostgreSQL configuration
- [x] T005 [P] Configure NextAuth.js base setup
- [x] T006 [P] Setup environment configuration management

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T007 Setup PostgreSQL database schema with Prisma migrations
- [x] T008 [P] Implement encryption utilities for OAuth token security
- [x] T009 [P] Configure NextAuth.js Google OAuth provider
- [x] T010 Create base authentication middleware and session handling
- [x] T011 Setup error handling and logging infrastructure
- [x] T012 [P] Create base UI components (Button, Dialog, Toast)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - New User Google Login (Priority: P1) 🎯 MVP

**Goal**: Enable new users to sign in with Google account and access the system immediately

**Independent Test**: User clicks "Sign in with Google" button, completes OAuth flow, and accesses dashboard without password prompts

### Tests for User Story 1 (MANDATORY - TDD Required) ⚠️

**TDD REQUIREMENT: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [US1] Unit test for Google login button component in tests/auth/google-login-button.test.tsx
- [x] T014 [P] [US1] Integration test for OAuth flow in tests/integration/oauth-flow.test.ts
- [x] T015 [P] [US1] Contract test for Google OAuth API in tests/contract/google-api.test.ts
- [x] T016 [P] [US1] Unit test for user creation service in tests/auth/user-creation.test.ts

### Implementation for User Story 1

- [x] T017 [US1] Create User model in lib/db/schema.prisma
- [x] T018 [US1] Create Account model in lib/db/schema.prisma
- [x] T019 [US1] Create Session model in lib/db/schema.prisma
- [x] T020 [US1] Implement Google OAuth provider configuration in lib/auth/config.ts
- [x] T021 [US1] Create NextAuth.js API route in app/api/auth/[...nextauth]/route.ts
- [x] T022 [US1] Implement Google login button component in components/auth/google-login-button.tsx
- [x] T023 [US1] Create login page with Google OAuth in app/login/page.tsx
- [x] T024 [US1] Implement user creation service in lib/auth/user-creation.ts
- [x] T025 [US1] Add OAuth callback handling in lib/auth/callbacks.ts
- [x] T026 [US1] Create dashboard page for authenticated users in app/dashboard/page.tsx

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Existing User Google Login (Priority: P2)

**Goal**: Existing Google users can continue using their Google account for consistent access

**Independent Test**: Existing Google-linked user signs in through OAuth flow and accesses their existing profile and data

### Tests for User Story 2 (MANDATORY - TDD Required) ⚠️

- [x] T027 [P] [US2] Unit test for existing user login flow in tests/auth/existing-user-login.test.tsx
- [x] T028 [P] [US2] Integration test for session management in tests/integration/session-management.test.ts
- [x] T029 [P] [US2] Contract test for session API endpoints in tests/contract/session-api.test.ts

### Implementation for User Story 2

- [x] T030 [US2] Implement user lookup service in lib/auth/user-lookup.ts
- [x] T031 [US2] Enhance OAuth callback handling for existing users in lib/auth/callbacks.ts
- [x] T032 [US2] Implement session validation middleware in lib/auth/session-validation.ts
- [x] T033 [US2] Create user profile display component in components/auth/user-profile.tsx
- [x] T034 [US2] Enhance dashboard page with existing user data in app/dashboard/page.tsx

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Account Linking for Existing Users (Priority: P3)

**Goal**: Traditional email/password users can link Google account to existing profile without losing data

**Independent Test**: Email/password user accesses account settings, links Google account, and can use either authentication method

### Tests for User Story 3 (MANDATORY - TDD Required) ⚠️

- [x] T035 [P] [US3] Unit test for account linking component in tests/auth/account-linking.test.tsx
- [x] T036 [P] [US3] Integration test for account merging in tests/integration/account-merging.test.ts
- [x] T037 [P] [US3] Contract test for account linking API in tests/contract/account-linking.test.ts

### Implementation for User Story 3

- [x] T038 [US3] Create UserProfile model in lib/db/schema.prisma
- [x] T039 [US3] Implement account linking service in lib/auth/account-linking.ts
- [x] T040 [US3] Implement account merging logic in lib/auth/account-merging.ts
- [x] T041 [US3] Create account linking component in components/auth/account-linking.tsx
- [x] T042 [US3] Implement account linking API endpoint in app/api/auth/account/link/route.ts
- [x] T043 [US3] Implement account unlinking API endpoint in app/api/auth/account/unlink/route.ts
- [x] T044 [US3] Create account settings page in app/settings/page.tsx
- [x] T045 [US3] Add account management to user profile component

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T046 [P] Documentation updates in README.md and quickstart.md
- [x] T047 Code cleanup and refactoring across all components
- [x] T048 Performance optimization for OAuth token refresh
- [x] T049 [P] Additional unit tests for edge cases in tests/unit/
- [x] T050 Security hardening and audit logging
- [x] T051 Error handling improvements and user feedback
- [x] T052 Run quickstart.md validation and integration tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Depends on US1 database models
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 and US2 authentication flow

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints/components
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- Models within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit test for Google login button component in tests/auth/google-login-button.test.tsx"
Task: "Integration test for OAuth flow in tests/integration/oauth-flow.test.ts"
Task: "Contract test for Google OAuth API in tests/contract/google-api.test.ts"
Task: "Unit test for user creation service in tests/auth/user-creation.test.ts"

# Launch all models for User Story 1 together:
Task: "Create User model in lib/db/schema.prisma"
Task: "Create Account model in lib/db/schema.prisma"
Task: "Create Session model in lib/db/schema.prisma"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2 (after US1 models complete)
   - Developer C: User Story 3 (after US1 and US2 complete)
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD Red phase)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
