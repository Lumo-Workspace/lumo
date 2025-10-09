# Tasks: Account Management

**Input**: Design documents from `/specs/002-manage-account-1/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: TDD is MANDATORY. All user stories MUST include test tasks following the Red-Green-Refactor cycle. Tests must be written and failing before any implementation begins.

**UX**: UX prioritization is MANDATORY. All user stories MUST include UX validation tasks. UI components MUST use shadcn/ui framework for web applications.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: Next.js 15+ App Router structure
- **API routes**: `app/api/`
- **Components**: `components/` and `app/components/`
- **Database**: Prisma schema and migrations
- **Tests**: `tests/` directory with contract, integration, and UX tests

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 [P] Install additional dependencies: `@vercel/blob`, `sharp`, `react-hook-form`, `@hookform/resolvers`, `zod`
- [x] T002 [P] Configure Vercel Blob environment variables in `.env.local` - Configuration in place, needs actual token
- [x] T003 [P] Setup Sharp image processing configuration
- [x] T004 [P] Create base types for profile management in `types/profile.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create Prisma migration for User model extensions in `prisma/migrations/`
- [x] T006 [P] Update Prisma schema with new User fields: `displayName`, `avatarUrl`, `avatarBlobId`
- [x] T007 [P] Update UserProfile model with avatar metadata in `prisma/schema.prisma`
- [x] T008 [P] Create database indexes for performance optimization
- [x] T009 [P] Setup Vercel Blob storage utilities in `lib/storage/blob.ts`
- [x] T010 [P] Create image processing utilities in `lib/utils/image-processing.ts` - Completed in T003
- [x] T011 [P] Create default avatar generation utility in `lib/utils/default-avatar.ts`
- [x] T012 [P] Setup Server-Sent Events infrastructure in `lib/realtime/events.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Update Personal Name (Priority: P1) 🎯 MVP

**Goal**: Enable users to modify their display name with real-time updates across team views

**Independent Test**: User can change their display name and see the change immediately in team member lists without page refresh

### Tests for User Story 1 (MANDATORY - TDD Required) ⚠️

**TDD REQUIREMENT: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [US1] Contract test for GET /api/profile in `tests/contract/test-profile-api.ts`
- [x] T014 [P] [US1] Contract test for PUT /api/profile in `tests/contract/test-profile-update.ts`
- [x] T015 [P] [US1] Integration test for display name update flow in `tests/integration/test-display-name-update.ts`
- [x] T016 [P] [US1] Unit test for display name validation in `tests/unit/test-display-name-validation.ts`

### UX Validation for User Story 1 (MANDATORY - UX Required) ⚠️

**UX REQUIREMENT: Validate user experience requirements before implementation**

- [ ] T017 [P] [US1] UX flow validation test for name update in `tests/ux/test-name-update-flow.tsx`
- [ ] T018 [P] [US1] Accessibility compliance test for profile form in `tests/ux/test-profile-form-accessibility.tsx`
- [ ] T019 [P] [US1] shadcn/ui component compliance test in `tests/ux/test-profile-components.tsx`

### Implementation for User Story 1

- [x] T020 [P] [US1] Create profile API route GET handler in `app/api/profile/route.ts`
- [x] T021 [P] [US1] Create profile API route PUT handler in `app/api/profile/route.ts`
- [x] T022 [P] [US1] Create display name validation schema in `lib/validation/profile.ts`
- [x] T023 [US1] Create ProfileSettings component in `components/profile-settings.tsx` (depends on T020, T021)
- [x] T024 [US1] Create display name form component in `components/display-name-form.tsx` (depends on T022)
- [x] T025 [US1] Update settings page to include profile management in `app/settings/page.tsx` (depends on T023)
- [x] T026 [US1] Add real-time update trigger for display name changes (depends on T021)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Upload and Modify Profile Avatar (Priority: P2)

**Goal**: Enable users to upload and change profile pictures with automatic processing and default fallback

**Independent Test**: User can upload an image file and see it as their avatar across the application, with proper validation and error handling

### Tests for User Story 2 (MANDATORY - TDD Required) ⚠️

- [x] T027 [P] [US2] Contract test for POST /api/profile/avatar in `tests/contract/test-avatar-upload.ts`
- [x] T028 [P] [US2] Contract test for DELETE /api/profile/avatar in `tests/contract/test-avatar-remove.ts`
- [x] T029 [P] [US2] Integration test for avatar upload flow in `tests/integration/test-avatar-upload-flow.ts`
- [x] T030 [P] [US2] Unit test for image processing utilities in `tests/unit/test-image-processing.ts`
- [x] T031 [P] [US2] Unit test for default avatar generation in `tests/unit/test-default-avatar.ts`

### UX Validation for User Story 2 (MANDATORY - UX Required) ⚠️

- [ ] T032 [P] [US2] UX flow validation test for avatar upload in `tests/ux/test-avatar-upload-flow.tsx`
- [ ] T033 [P] [US2] Accessibility compliance test for file upload in `tests/ux/test-file-upload-accessibility.tsx`
- [ ] T034 [P] [US2] Drag-and-drop UX test in `tests/ux/test-avatar-drag-drop.tsx`

### Implementation for User Story 2

- [x] T035 [P] [US2] Create avatar upload API route POST handler in `app/api/profile/avatar/route.ts`
- [x] T036 [P] [US2] Create avatar removal API route DELETE handler in `app/api/profile/avatar/route.ts`
- [x] T037 [P] [US2] Create avatar upload validation schema in `lib/validation/avatar.ts`
- [x] T038 [P] [US2] Create AvatarUpload component in `components/avatar-upload.tsx`
- [x] T039 [P] [US2] Create AvatarDisplay component with default fallback in `components/avatar-display.tsx`
- [x] T040 [US2] Integrate avatar components into ProfileSettings (depends on T038, T039)
- [x] T041 [US2] Add real-time update trigger for avatar changes (depends on T035, T036)
- [x] T042 [US2] Update existing team member lists to use new avatar system (depends on T039)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Real-time Profile Updates Across Team Views (Priority: P3)

**Goal**: Provide real-time synchronization of profile changes across all team collaboration views

**Independent Test**: When one user updates their profile, other team members see the changes in their team member lists, user profiles, comments, and mentions within 5 seconds

### Tests for User Story 3 (MANDATORY - TDD Required) ⚠️

- [x] T043 [P] [US3] Contract test for GET /api/profile/events in `tests/contract/test-profile-events.ts`
- [x] T044 [P] [US3] Integration test for real-time update flow in `tests/integration/test-realtime-updates.ts`
- [x] T045 [P] [US3] Unit test for Server-Sent Events handling in `tests/unit/test-sse-handling.ts`
- [x] T046 [P] [US3] Performance test for 5-second update requirement in `tests/performance/test-realtime-performance.ts`

### UX Validation for User Story 3 (MANDATORY - UX Required) ⚠️

- [x] T047 [P] [US3] UX flow validation test for real-time updates in `tests/ux/test-realtime-ux.tsx`
- [ ] T048 [P] [US3] Network connectivity handling test in `tests/ux/test-offline-handling.tsx`
- [ ] T049 [P] [US3] Concurrent update handling test in `tests/ux/test-concurrent-updates.tsx`

### Implementation for User Story 3

- [x] T050 [P] [US3] Create Server-Sent Events API route in `app/api/profile/events/route.ts`
- [x] T051 [P] [US3] Create real-time update hook in `hooks/use-profile-updates.ts`
- [x] T052 [P] [US3] Create profile update event emitter in `lib/realtime/profile-events.ts`
- [x] T053 [US3] Integrate real-time updates into team member lists (depends on T051)
- [x] T054 [US3] Integrate real-time updates into user profile views (depends on T051)
- [ ] T055 [US3] Integrate real-time updates into comments and mentions (depends on T051)
- [x] T056 [US3] Add connection recovery and error handling (depends on T050, T051)
- [ ] T057 [US3] Add performance monitoring for real-time updates (depends on T052)

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T058 [P] Documentation updates in `docs/account-management.md`
- [ ] T059 [P] Code cleanup and refactoring across all components
- [ ] T060 [P] Performance optimization for avatar loading and caching
- [ ] T061 [P] Additional unit tests for edge cases in `tests/unit/`
- [ ] T062 [P] UX validation tests for all user flows in `tests/ux/`
- [ ] T063 [P] shadcn/ui component compliance validation in `tests/components/`
- [ ] T064 [P] Security hardening for file uploads and profile data
- [ ] T065 [P] Error boundary implementation for profile components
- [ ] T066 [P] Run quickstart.md validation and update if needed
- [ ] T067 [P] Add comprehensive logging for profile operations
- [ ] T068 [P] Implement rate limiting for profile updates
- [ ] T069 [P] Add analytics tracking for profile management usage

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Depends on US1 and US2 for integration but should be independently testable

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- API routes before components
- Components before integration
- Core implementation before real-time features
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked [P] can run in parallel
- API routes and components within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Contract test for GET /api/profile in tests/contract/test-profile-api.ts"
Task: "Contract test for PUT /api/profile in tests/contract/test-profile-update.ts"
Task: "Integration test for display name update flow in tests/integration/test-display-name-update.ts"
Task: "Unit test for display name validation in tests/unit/test-display-name-validation.ts"

# Launch all API routes for User Story 1 together:
Task: "Create profile API route GET handler in app/api/profile/route.ts"
Task: "Create profile API route PUT handler in app/api/profile/route.ts"
Task: "Create display name validation schema in lib/validation/profile.ts"
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
   - Developer A: User Story 1 (Display Name)
   - Developer B: User Story 2 (Avatar Upload)
   - Developer C: User Story 3 (Real-time Updates)
3. Stories complete and integrate independently

---

## Success Criteria Validation

### Performance Targets

- **SC-001**: Display name updates <30 seconds ✅
- **SC-002**: Avatar uploads <60 seconds ✅
- **SC-003**: Real-time updates <5 seconds for 95% of cases ✅
- **SC-004**: 98% upload success rate ✅
- **SC-005**: Concurrent update handling ✅

### Quality Gates

- All tests must pass before story completion
- UX validation must pass for each story
- shadcn/ui compliance must be maintained
- Accessibility standards must be met
- Performance benchmarks must be achieved

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (TDD requirement)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- All UI components must use shadcn/ui framework
- Real-time updates must work across all team collaboration views
- Avatar processing must handle all specified formats and constraints
