# Tasks: Google OAuth Login

**Feature Branch**: `001-google`  
**Input**: Design documents from `/specs/001-google/`
**Prerequisites**: ✅ plan.md, ✅ spec.md, ✅ research.md, ✅ data-model.md, ✅ contracts/, ✅ quickstart.md

**Tests**: TDD is MANDATORY. All user stories MUST include test tasks following the Red-Green-Refactor cycle. Tests must be written and failing before any implementation begins.

**UX**: UX prioritization is MANDATORY. All user stories MUST include UX validation tasks. UI components MUST use shadcn/ui framework for web applications.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is a Next.js 15 web application with the following structure:

- **App Routes**: `app/` (login, dashboard, settings, API routes)
- **Library Code**: `lib/` (auth logic, database, utilities)
- **Components**: `components/` (UI components using shadcn/ui)
- **Database**: `prisma/` (schema and migrations)
- **Tests**: `tests/` (auth/, integration/, contract/)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, environment configuration, and basic tooling

- [x] **T001** [P] [Setup] Update environment variables in `.env.example` with required OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_URL, NEXTAUTH_SECRET, TOKEN_ENCRYPTION_KEY)
- [x] **T002** [P] [Setup] Create `.env.local` file for development (copy from `.env.example` and add actual values) - **Do not commit this file**
- [x] **T003** [P] [Setup] Generate NEXTAUTH_SECRET using `openssl rand -base64 32`
- [x] **T004** [P] [Setup] Generate TOKEN_ENCRYPTION_KEY using `openssl rand -base64 32`
- [ ] **T005** [P] [Setup] Setup Google Cloud Console project and OAuth 2.0 credentials (follow `quickstart.md` Phase 1.1) - **MANUAL STEP**
- [ ] **T006** [P] [Setup] Configure OAuth consent screen in Google Cloud Console with correct scopes (openid, email, profile) - **MANUAL STEP**
- [ ] **T007** [P] [Setup] Add authorized redirect URIs to Google OAuth credentials (http://localhost:3000/api/auth/callback/google for dev, production URL for prod) - **MANUAL STEP**

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database Schema & Infrastructure

- [x] **T008** [Foundation] Update Prisma schema in `prisma/schema.prisma` with User, Account, Session, VerificationToken models per `data-model.md`
- [ ] **T009** [Foundation] Create database migration: `npx prisma migrate dev --name add_oauth_tables` - **REQUIRES DATABASE**
- [ ] **T010** [Foundation] Generate Prisma Client: `npx prisma generate` - **REQUIRES DATABASE**
- [x] **T011** [P] [Foundation] Verify Prisma client instance exists in `lib/db/prisma.ts` (create if missing)

### Core Authentication Infrastructure

- [x] **T012** [P] [Foundation] Implement token encryption utilities in `lib/auth/token-encryption.ts` with AES-256-GCM (encryptToken, decryptToken functions)
- [x] **T013** [Foundation] Create NextAuth.js configuration in `lib/auth/config.ts` with Google provider, Prisma adapter, JWT strategy, 24-hour session
- [x] **T014** [Foundation] Create NextAuth.js API route handler in `app/api/auth/[...nextauth]/route.ts`
- [x] **T015** [P] [Foundation] Create OAuth error page in `app/api/auth/error/page.tsx` with user-friendly error messages per `research.md` section 9
- [x] **T016** [P] [Foundation] Create error types and messages in `lib/auth/errors.ts` (OAuthErrorType enum, ERROR_MESSAGES map)

### Testing Infrastructure

- [x] **T017** [P] [Foundation] Setup Jest mocks for NextAuth in `tests/__mocks__/next-auth.ts`
- [x] **T018** [P] [Foundation] Setup test utilities for authentication in `tests/auth/test-utils.ts` (mock sessions, users, tokens)
- [x] **T019** [P] [Foundation] Create Prisma test helpers in `tests/__mocks__/prisma.ts` for database mocking

**Checkpoint**: ✅ Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - New User Google Login (Priority: P1) 🎯 MVP

**Goal**: Enable new users to sign in with Google account and access the dashboard immediately without password creation

**Independent Test**: A user with a Google account can click "Sign in with Google" button, complete OAuth flow, and access `/dashboard` with their Google profile information displayed

**Acceptance Criteria** (from spec.md):

1. Login page provides "Continue with Google" button
2. Clicking button redirects to Google OAuth consent screen
3. Granting permission creates new user account and signs them in
4. User is redirected to `/dashboard` with profile information visible
5. OAuth errors show clear user-friendly messages

### Tests for User Story 1 (MANDATORY - TDD Required) ⚠️

**TDD REQUIREMENT: Write these tests FIRST, ensure they FAIL before implementation**

- [x] **T020** [P] [US1] Unit test for token encryption in `tests/auth/token-encryption.test.ts` (encrypt/decrypt, format validation, error handling)
- [x] **T021** [P] [US1] Unit test for NextAuth config in `tests/auth/nextauth-config.test.ts` (provider setup, session strategy, callbacks)
- [x] **T022** [P] [US1] Unit test for JWT callback in `tests/auth/callbacks.test.ts` (initial sign in, token structure, user data)
- [x] **T023** [P] [US1] Unit test for session callback in `tests/auth/callbacks.test.ts` (session structure, user inclusion)
- [x] **T024** [P] [US1] Contract test for `/api/auth/signin/google` endpoint in `tests/contract/google-oauth.test.ts` (redirect behavior, CSRF token)
- [x] **T025** [P] [US1] Contract test for `/api/auth/callback/google` endpoint in `tests/contract/google-oauth.test.ts` (token exchange, user creation)
- [x] **T026** [P] [US1] Integration test for complete OAuth flow in `tests/integration/oauth-flow.test.ts` (login → consent → callback → dashboard)
- [x] **T027** [P] [US1] Integration test for new user account creation in `tests/integration/user-creation.test.ts` (Google profile → User record)

### UX Validation for User Story 1 (MANDATORY - UX Required) ⚠️

**UX REQUIREMENT: Validate user experience requirements before implementation**

- [x] **T028** [P] [US1] Component test for GoogleLoginButton in `tests/auth/google-login-button.test.tsx` (rendering, click handler, loading state, accessibility)
- [x] **T029** [P] [US1] Accessibility test for login page in `tests/ux/login-accessibility.test.tsx` (WCAG 2.1 AA compliance, keyboard navigation, screen reader labels)
- [x] **T030** [P] [US1] Visual regression test for login page in `tests/ux/login-visual.test.tsx` (button styling, responsive design, touch targets ≥44px)
- [x] **T031** [P] [US1] Performance test for OAuth flow in `tests/integration/oauth-performance.test.ts` (completion <30 seconds, page load <2s)

### Implementation for User Story 1

**Core Authentication Logic**

- [ ] **T032** [US1] Implement NextAuth.js callbacks in `lib/auth/callbacks.ts`:
  - jwt callback: Handle initial sign in, store tokens, user data
  - session callback: Include user in session object
  - signIn callback: Basic validation (account merging in US3)
- [ ] **T033** [US1] Implement user creation logic in `lib/auth/user-creation.ts`:
  - createGoogleUser function: Create User record from Google profile
  - Handle email verification timestamp
  - Store Google profile picture URL

**UI Components (shadcn/ui)**

- [ ] **T034** [P] [US1] Create Google icon component in `components/ui/icons.tsx` (add Google SVG, spinner for loading)
- [ ] **T035** [US1] Create GoogleLoginButton component in `components/auth/google-login-button.tsx`:
  - Use shadcn/ui Button component (variant="outline", size="lg")
  - Implement loading state with spinner
  - Add ARIA labels for accessibility
  - Minimum 44px touch target height
  - Handle signIn('google', { callbackUrl: '/dashboard' })
- [ ] **T036** [US1] Update login page in `app/login/page.tsx`:
  - Add GoogleLoginButton component
  - Center layout with max-width
  - Add heading and description text
  - Implement responsive design (mobile-first)

**Error Handling**

- [ ] **T037** [P] [US1] Implement error display component in `components/auth/auth-error-alert.tsx`:
  - Use shadcn/ui Alert component
  - Map error codes to user-friendly messages
  - Include retry button
  - ARIA live region for screen readers
- [ ] **T038** [US1] Update error page in `app/api/auth/error/page.tsx`:
  - Display AuthErrorAlert component
  - Extract error from query params
  - Handle all OAuth error types (access_denied, configuration, etc.)

**Session Management**

- [ ] **T039** [US1] Test session retrieval in dashboard in `app/dashboard/page.tsx`:
  - Use getServerSession to check authentication
  - Redirect to /login if not authenticated
  - Display user name and profile picture
  - Show "Signed in as {email}" message

**Integration & Validation**

- [ ] **T040** [US1] Run all US1 tests and verify they pass: `npm test tests/auth/ tests/integration/oauth-flow.test.ts tests/integration/user-creation.test.ts`
- [ ] **T041** [US1] Manual testing checklist (follow `quickstart.md` Phase 6.2):
  - [ ] Visit /login and see Google button
  - [ ] Click button redirects to Google consent screen
  - [ ] Grant permission creates account and redirects to /dashboard
  - [ ] Dashboard shows Google profile name and picture
  - [ ] Sign out works correctly
  - [ ] Error page shows user-friendly messages on denial
- [ ] **T042** [US1] Validate accessibility with axe DevTools (no critical issues)
- [ ] **T043** [US1] Validate performance metrics (OAuth flow <30s, page load <2s)

**Checkpoint**: ✅ User Story 1 is complete and independently testable. New users can sign in with Google.

---

## Phase 4: User Story 2 - Existing User Google Login (Priority: P2)

**Goal**: Enable existing users who previously signed up with Google to continue signing in seamlessly

**Independent Test**: An existing user with a Google-linked account can sign in through OAuth flow and access their existing profile data

**Acceptance Criteria** (from spec.md):

1. Existing Google users can sign in with same Google account
2. User is automatically logged into their existing account (no duplicate creation)
3. User can access previously saved data and preferences
4. Account metadata (lastUsedAt) is updated on each login

### Tests for User Story 2 (MANDATORY - TDD Required) ⚠️

- [ ] **T044** [P] [US2] Unit test for existing user sign in in `tests/auth/existing-user-signin.test.ts` (identify existing account, no duplicate creation)
- [ ] **T045** [P] [US2] Unit test for account lastUsedAt update in `tests/auth/account-metadata.test.ts` (timestamp updates on each login)
- [ ] **T046** [P] [US2] Integration test for existing user login flow in `tests/integration/existing-user-flow.test.ts` (returning user → dashboard with existing data)
- [ ] **T047** [P] [US2] Contract test for session persistence in `tests/contract/session-management.test.ts` (session token, expiration, user data)

### UX Validation for User Story 2 (MANDATORY - UX Required) ⚠️

- [ ] **T048** [P] [US2] UX test for returning user experience in `tests/ux/returning-user-ux.test.tsx` (no re-consent if refresh token valid, seamless login)
- [ ] **T049** [P] [US2] Performance test for returning user login in `tests/integration/login-performance.test.ts` (faster than new user, token refresh handling)

### Implementation for User Story 2

**Account Lookup & Validation**

- [ ] **T050** [US2] Implement user lookup logic in `lib/auth/user-lookup.ts`:
  - findUserByGoogleId function: Query Account table by providerAccountId
  - findUserByEmail function: Query User table by email
  - Handle both cases (email match vs Google ID match)
- [ ] **T051** [US2] Update signIn callback in `lib/auth/callbacks.ts`:
  - Check if Google account already exists
  - If exists, allow sign in (return true)
  - Update Account.lastUsedAt timestamp
  - Handle Google profile updates (name, picture changes)

**Token Management**

- [ ] **T052** [P] [US2] Implement token refresh logic in `lib/auth/session-validation.ts`:
  - refreshAccessToken function: Call Google token endpoint
  - Handle refresh token expiration
  - Update encrypted tokens in database
  - Implement exponential backoff retry (SR-018)
- [ ] **T053** [US2] Update JWT callback in `lib/auth/callbacks.ts`:
  - Check token expiration
  - Call refreshAccessToken if expired
  - Handle RefreshAccessTokenError
  - Return updated token with new expiration

**Session Cleanup**

- [ ] **T054** [P] [US2] Implement session cleanup service in `lib/auth/session-cleanup.ts`:
  - deleteExpiredSessions function: Remove sessions where expires < NOW
  - deleteInactiveTokens function: Remove tokens with lastUsedAt > 30 days (SR-009)
  - Schedule cleanup job (consider using cron or background task)

**User Profile Updates**

- [ ] **T055** [US2] Implement profile sync logic in `lib/auth/user-creation.ts`:
  - updateUserFromGoogleProfile function: Sync name, picture from Google
  - Only update if changed (avoid unnecessary writes)
  - Update emailVerified if Google provides new verification

**Integration & Validation**

- [ ] **T056** [US2] Run all US2 tests and verify they pass: `npm test tests/auth/existing-user-signin.test.ts tests/integration/existing-user-flow.test.ts`
- [ ] **T057** [US2] Manual testing checklist:
  - [ ] Sign out after US1 test
  - [ ] Sign in again with same Google account
  - [ ] Verify no duplicate user created
  - [ ] Verify dashboard shows same user data
  - [ ] Verify session persists for 24 hours
  - [ ] Test token refresh after expiration
- [ ] **T058** [US2] Validate database state (Account.lastUsedAt updated, no duplicate accounts)

**Checkpoint**: ✅ User Story 2 is complete. Existing users can sign in seamlessly.

---

## Phase 5: User Story 3 - Account Linking for Existing Users (Priority: P3)

**Goal**: Enable existing email/password users to link their Google account for multi-auth flexibility

**Independent Test**: An existing email/password user can link Google account from settings, then sign in with either method

**Acceptance Criteria** (from spec.md):

1. Settings page provides "Link Google Account" option
2. Clicking triggers Google OAuth flow with state parameter
3. Successfully linking associates Google account with existing user
4. User can sign in with either email/password OR Google after linking
5. Cannot link Google account already associated with another user
6. Unlinking requires alternative authentication method (SR-014)

### Tests for User Story 3 (MANDATORY - TDD Required) ⚠️

- [ ] **T059** [P] [US3] Unit test for account merging logic in `tests/auth/account-merging.test.ts` (email match detection, merge confirmation, conflict handling)
- [ ] **T060** [P] [US3] Unit test for account linking in `tests/auth/account-linking.test.ts` (link Google to existing user, prevent duplicate linking)
- [ ] **T061** [P] [US3] Unit test for account unlinking in `tests/auth/account-unlinking.test.ts` (require alternative auth, update database)
- [ ] **T062** [P] [US3] Contract test for `/api/account/link/google` endpoint in `tests/contract/account-linking.test.ts` (authenticated only, OAuth redirect)
- [ ] **T063** [P] [US3] Contract test for `/api/account/unlink/google` endpoint in `tests/contract/account-linking.test.ts` (require alternative auth, success response)
- [ ] **T064** [P] [US3] Integration test for account linking flow in `tests/integration/account-linking-flow.test.ts` (settings → OAuth → linked → dual sign-in)
- [ ] **T065** [P] [US3] Integration test for merge confirmation flow in `tests/integration/account-merge.test.ts` (email match → confirmation → merge)

### UX Validation for User Story 3 (MANDATORY - UX Required) ⚠️

- [ ] **T066** [P] [US3] Component test for AccountLinking component in `tests/auth/account-linking.test.tsx` (link button, unlink button, confirmation dialog)
- [ ] **T067** [P] [US3] UX test for account linking flow in `tests/ux/account-linking-ux.test.tsx` (clear confirmation messages, error handling, success feedback)
- [ ] **T068** [P] [US3] Accessibility test for settings page in `tests/ux/settings-accessibility.test.tsx` (keyboard navigation, screen reader support)

### Implementation for User Story 3

**Account Merging Logic**

- [ ] **T069** [US3] Implement account merging service in `lib/auth/account-merging.ts`:
  - handleAccountMerge function: Check for email match, detect conflicts
  - Throw AccountMergeRequiredError if confirmation needed
  - Create Account record linked to existing user on confirmation
  - Log account merge event for audit (SR-019)
- [ ] **T070** [US3] Update signIn callback in `lib/auth/callbacks.ts`:
  - Call handleAccountMerge for new Google sign-ins
  - Handle AccountMergeRequiredError
  - Redirect to merge confirmation page if needed
  - Auto-merge if no conflict (user already has Google linked)

**Account Linking API**

- [ ] **T071** [P] [US3] Create account linking API route in `app/api/account/link/google/route.ts`:
  - Require authentication (getServerSession)
  - Check if Google account already linked to another user
  - Return 409 Conflict if already linked
  - Initiate OAuth flow with state=linkAccount
  - Handle OAuth callback and create Account record
- [ ] **T072** [P] [US3] Create account unlinking API route in `app/api/account/unlink/google/route.ts`:
  - Require authentication (getServerSession)
  - Check for alternative authentication method (SR-014)
  - Return 400 if no alternative auth
  - Delete Account record for Google provider
  - Return success response

**Settings UI Components**

- [ ] **T073** [P] [US3] Create UserProfile component in `components/auth/user-profile.tsx`:
  - Display user name, email, profile picture
  - Use shadcn/ui Avatar component
  - Show linked accounts list
  - Responsive design
- [ ] **T074** [US3] Create AccountLinking component in `components/auth/account-linking.tsx`:
  - Use shadcn/ui Card component for layout
  - Show "Link Google Account" button if not linked
  - Show "Unlink Google Account" button if linked
  - Implement confirmation dialog using shadcn/ui AlertDialog
  - Handle link/unlink API calls
  - Show success/error toasts using shadcn/ui Sonner
- [ ] **T075** [US3] Update settings page in `app/settings/page.tsx`:
  - Require authentication (redirect to /login if not authenticated)
  - Display UserProfile component
  - Display AccountLinking component
  - Add breadcrumb navigation

**Merge Confirmation UI**

- [ ] **T076** [P] [US3] Create account merge confirmation page in `app/auth/merge-confirm/page.tsx`:
  - Display email address with conflict
  - Show "An account with {email} already exists" message
  - Use shadcn/ui AlertDialog for confirmation
  - "Link Google Account" button → confirm merge
  - "Cancel" button → return to login
  - Handle CSRF token validation

**Audit Logging**

- [ ] **T077** [P] [US3] Implement audit logging in `lib/auth/audit-log.ts`:
  - logAuthEvent function: Log authentication events (SR-019)
  - Include timestamp, IP (anonymized), user agent, event type, result
  - Store in database or send to logging service
  - Anonymize PII (SR-012)
- [ ] **T078** [US3] Add audit logging to account linking operations:
  - Log ACCOUNT_LINKED event on successful link
  - Log ACCOUNT_UNLINKED event on unlink
  - Log ACCOUNT_MERGE_CONFIRMED event on merge confirmation
  - Log ACCOUNT_LINK_CONFLICT event on duplicate Google account attempt

**Integration & Validation**

- [ ] **T079** [US3] Run all US3 tests and verify they pass: `npm test tests/auth/account-linking.test.ts tests/integration/account-linking-flow.test.ts`
- [ ] **T080** [US3] Manual testing checklist:
  - [ ] Create test user with email/password (if password auth exists)
  - [ ] Navigate to /settings while authenticated
  - [ ] Click "Link Google Account"
  - [ ] Complete OAuth flow and verify account linked
  - [ ] Sign out and sign in with Google
  - [ ] Verify same user profile and data
  - [ ] Test unlinking (should fail if no alternative auth)
  - [ ] Test conflict scenario (Google account already linked to another user)
- [ ] **T081** [US3] Validate database state (Account records linked correctly, audit logs created)
- [ ] **T082** [US3] Test account merging flow:
  - [ ] Create user with Google
  - [ ] Try to sign in with same email but no Google link
  - [ ] Verify merge confirmation page appears
  - [ ] Confirm merge and verify accounts linked

**Checkpoint**: ✅ User Story 3 is complete. Account linking and merging work correctly.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, security hardening, GDPR compliance, and production readiness

### Security Hardening

- [ ] **T083** [P] [Polish] Implement rate limiting middleware in `lib/auth/rate-limiter.ts`:
  - IP-based rate limiting (5 attempts/min/IP per SR-006)
  - LRU cache for IP tracking
  - Return 429 Too Many Requests on violation
  - Log rate limit violations
- [ ] **T084** [Polish] Add rate limiting to auth middleware in `app/api/auth/middleware.ts`:
  - Apply to all `/api/auth/*` routes
  - Extract IP from x-forwarded-for or x-real-ip headers
  - Call checkRateLimit before processing request
- [ ] **T085** [P] [Polish] Implement CSRF validation (verify NextAuth built-in protection):
  - Test CSRF token in cookies
  - Verify state parameter validation
  - Test cross-origin request rejection
- [ ] **T086** [P] [Polish] Add security headers in `next.config.mjs`:
  - HSTS (Strict-Transport-Security)
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Referrer-Policy: strict-origin-when-cross-origin

### GDPR Compliance

- [ ] **T087** [P] [Polish] Create user data export API in `app/api/user/export/route.ts`:
  - Require authentication
  - Fetch user profile, accounts, sessions
  - Exclude sensitive tokens (SR-010)
  - Return JSON format per `contracts/user-api.yaml`
- [ ] **T088** [P] [Polish] Create user data deletion API in `app/api/user/delete/route.ts`:
  - Require re-authentication
  - Validate confirmation ("DELETE" text)
  - Delete User record (cascade to Accounts, Sessions)
  - Anonymize audit logs (SR-011)
  - Return success response
- [ ] **T089** [P] [Polish] Create data export UI in `app/settings/privacy/page.tsx`:
  - "Export My Data" button
  - Download JSON file
  - Show export date and contents
- [ ] **T090** [P] [Polish] Create account deletion UI in `app/settings/privacy/page.tsx`:
  - "Delete Account" button
  - Confirmation dialog (require typing "DELETE")
  - Show warning about permanent deletion
  - Handle deletion API call

### Session Management UI

- [ ] **T091** [P] [Polish] Create session list API in `app/api/user/sessions/route.ts`:
  - GET: List active sessions for user
  - DELETE: Revoke all other sessions
  - Include device info, IP (anonymized), timestamps
- [ ] **T092** [P] [Polish] Create session revocation API in `app/api/user/sessions/[sessionId]/route.ts`:
  - DELETE: Revoke specific session by ID
  - Prevent revoking current session
  - Return success response
- [ ] **T093** [P] [Polish] Create sessions management UI in `app/settings/sessions/page.tsx`:
  - List active sessions with device, location, timestamp
  - Highlight current session
  - "Revoke" button for each session
  - "Revoke All Others" button
  - Use shadcn/ui Table component

### Error Handling & Monitoring

- [ ] **T094** [P] [Polish] Implement retry logic with exponential backoff in `lib/auth/retry.ts`:
  - retryWithBackoff function (SR-018)
  - Base delay: 1s, max delay: 16s
  - Max retries: 5
  - Apply to token refresh and Google API calls
- [ ] **T095** [P] [Polish] Add structured logging in `lib/utils/logger.ts`:
  - JSON format for production
  - Include request ID, timestamp, level, message, metadata
  - Separate auth events logger
  - Integrate with monitoring service (Vercel Analytics, Sentry)
- [ ] **T096** [Polish] Update all auth operations to use structured logging:
  - Log sign in attempts (success/failure)
  - Log token refresh operations
  - Log account linking/unlinking
  - Log rate limit violations
  - Anonymize PII per SR-012

### Performance Optimization

- [ ] **T097** [P] [Polish] Optimize database queries with Prisma:
  - Add indexes for User.email, Account.userId, Session.sessionToken
  - Use select to fetch only needed fields
  - Use include for eager loading relationships
  - Validate query performance with Prisma query engine logs
- [ ] **T098** [P] [Polish] Implement caching strategy:
  - Cache user profile in JWT payload (reduce DB queries)
  - Cache session lookups (NextAuth handles this)
  - Consider Redis for rate limiting in production (if needed)
- [ ] **T099** [P] [Polish] Optimize Next.js build:
  - Enable output: 'standalone' for smaller Docker images
  - Optimize images with next/image
  - Enable compression in production
  - Analyze bundle size with @next/bundle-analyzer

### Documentation & Developer Experience

- [ ] **T100** [P] [Polish] Update README.md with OAuth setup instructions:
  - Link to `specs/001-google/quickstart.md`
  - Quick start section for new developers
  - Environment variables documentation
  - Google Cloud Console setup steps
- [ ] **T101** [P] [Polish] Create API documentation from OpenAPI contracts:
  - Generate API docs from `contracts/auth-api.yaml` and `contracts/user-api.yaml`
  - Host on `/docs` or use Swagger UI
  - Include authentication examples
- [ ] **T102** [P] [Polish] Add inline code comments and JSDoc:
  - Document all exported functions in `lib/auth/*`
  - Add type definitions for complex objects
  - Document security considerations
- [ ] **T103** [P] [Polish] Create troubleshooting guide in `docs/troubleshooting.md`:
  - Common OAuth errors and solutions
  - Environment variable issues
  - Database migration problems
  - Rate limiting debugging

### Testing & Quality Assurance

- [ ] **T104** [P] [Polish] Increase test coverage to 80%+ for new code:
  - Add unit tests for edge cases
  - Add integration tests for error scenarios
  - Test rate limiting behavior
  - Test concurrent session limiting
- [ ] **T105** [P] [Polish] Run full test suite and fix any failures: `npm test`
- [ ] **T106** [P] [Polish] Run type checking: `npm run type-check`
- [ ] **T107** [P] [Polish] Run linting and fix issues: `npm run lint:fix`
- [ ] **T108** [P] [Polish] Run accessibility audit with axe DevTools on all pages
- [ ] **T109** [P] [Polish] Run Lighthouse performance audit (target scores: >90)
- [ ] **T110** [P] [Polish] Security audit:
  - [ ] Verify HTTPS-only cookies in production
  - [ ] Test CSRF protection
  - [ ] Test rate limiting
  - [ ] Verify token encryption
  - [ ] Check for sensitive data in logs
  - [ ] Validate OAuth scopes (only openid, email, profile)

### Deployment Preparation

- [ ] **T111** [Polish] Update production environment variables in Vercel/hosting platform:
  - GOOGLE_CLIENT_ID (production credentials)
  - GOOGLE_CLIENT_SECRET (production credentials)
  - NEXTAUTH_URL (production URL)
  - NEXTAUTH_SECRET (new production secret)
  - TOKEN_ENCRYPTION_KEY (new production key)
  - PRISMA_DATABASE_URL (production database)
- [ ] **T112** [Polish] Run database migrations on production: `npx prisma migrate deploy`
- [ ] **T113** [Polish] Update Google OAuth authorized redirect URIs with production URL
- [ ] **T114** [Polish] Test OAuth flow in production/staging environment
- [ ] **T115** [P] [Polish] Setup monitoring and alerts:
  - Authentication failure rate alerts
  - Rate limit violation alerts
  - Token refresh failure alerts
  - Database connection alerts
- [ ] **T116** [P] [Polish] Create deployment checklist in `docs/deployment.md`
- [ ] **T117** [Polish] Validate success criteria from spec.md:
  - [ ] SC-001: OAuth flow completes in <30 seconds ✅
  - [ ] SC-002: 95%+ authentication success rate ✅
  - [ ] SC-003: Account linking completes in <2 minutes ✅
  - [ ] SC-004: 100% OAuth errors handled with user feedback ✅
  - [ ] SC-005: 60% reduction in onboarding time vs traditional signup ✅

**Checkpoint**: ✅ All user stories complete, polished, and production-ready

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3, 4, 5)**: All depend on Foundational phase completion
  - User Story 1 (Phase 3): Can start after Foundational - No dependencies on other stories
  - User Story 2 (Phase 4): Can start after Foundational - Independent (though logically follows US1)
  - User Story 3 (Phase 5): Can start after Foundational - Independent (may reference US1/US2 logic)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

**User Story 1 (P1) - New User Google Login**

- Dependencies: Foundational phase (T008-T019)
- Blocks: None (fully independent)
- Can be deployed as MVP: ✅ YES

**User Story 2 (P2) - Existing User Google Login**

- Dependencies: Foundational phase (T008-T019)
- Soft dependency: US1 provides basic OAuth flow (but US2 could be implemented independently)
- Blocks: None
- Can be deployed independently: ✅ YES

**User Story 3 (P3) - Account Linking**

- Dependencies: Foundational phase (T008-T019)
- Soft dependency: US1/US2 provide OAuth infrastructure (but US3 could be implemented independently)
- Blocks: None
- Can be deployed independently: ✅ YES

### Within Each User Story

**User Story 1 Tasks (T020-T043)**:

- Tests (T020-T027) → Run first, should FAIL
- UX Tests (T028-T031) → Run in parallel with unit tests
- Implementation: T032 (callbacks) → T033 (user creation) → T034-T036 (UI) → T037-T038 (errors) → T039 (session) → T040-T043 (validation)

**User Story 2 Tasks (T044-T058)**:

- Tests (T044-T047) → Run first, should FAIL
- UX Tests (T048-T049) → Run in parallel
- Implementation: T050-T051 (lookup & validation) → T052-T053 (token management) → T054 (cleanup) → T055 (profile updates) → T056-T058 (validation)

**User Story 3 Tasks (T059-T082)**:

- Tests (T059-T065) → Run first, should FAIL
- UX Tests (T066-T068) → Run in parallel
- Implementation: T069-T070 (merging) → T071-T072 (API) → T073-T075 (settings UI) → T076 (merge UI) → T077-T078 (audit) → T079-T082 (validation)

### Parallel Opportunities

**Setup Phase (Phase 1)** - All tasks can run in parallel:

- T001-T007 [P] (7 tasks)

**Foundational Phase (Phase 2)** - Parallelizable groups:

- Database: T008 → T009 → T010 (sequential due to migration dependency)
- Auth infrastructure: T012, T013, T014, T015, T016 (can run in parallel except T014 depends on T013)
- Testing infrastructure: T017, T018, T019 (can run in parallel)

**User Story 1 (Phase 3)** - Parallelizable groups:

- All tests: T020-T031 [P] (12 tasks in parallel)
- UI components: T034, T035, T036 (T035 depends on T034 for icons)
- Error handling: T037, T038 [P] (2 tasks)

**User Story 2 (Phase 4)** - Parallelizable groups:

- All tests: T044-T049 [P] (6 tasks)
- Token management: T052, T054, T055 [P] (3 tasks independent of T050-T051)

**User Story 3 (Phase 5)** - Parallelizable groups:

- All tests: T059-T068 [P] (10 tasks)
- API routes: T071, T072 [P] (2 tasks)
- UI components: T073, T074, T076 [P] (3 tasks)
- Audit: T077, T078 [P] (2 tasks)

**Polish Phase (Phase 6)** - Highly parallelizable:

- Security: T083-T086 [P] (4 tasks)
- GDPR: T087-T090 [P] (4 tasks)
- Sessions: T091-T093 [P] (3 tasks)
- Error handling: T094-T096 [P] (3 tasks)
- Performance: T097-T099 [P] (3 tasks)
- Documentation: T100-T103 [P] (4 tasks)
- Testing: T104-T110 [P] (7 tasks)
- Deployment: T115, T116 [P] (2 tasks)

---

## Parallel Example: User Story 1 (MVP)

### Parallel Test Execution

```bash
# Launch all tests for User Story 1 together:
Task T020: "Unit test for token encryption in tests/auth/token-encryption.test.ts"
Task T021: "Unit test for NextAuth config in tests/auth/nextauth-config.test.ts"
Task T022: "Unit test for JWT callback in tests/auth/callbacks.test.ts"
Task T023: "Unit test for session callback in tests/auth/callbacks.test.ts"
Task T024: "Contract test for /api/auth/signin/google in tests/contract/google-oauth.test.ts"
Task T025: "Contract test for /api/auth/callback/google in tests/contract/google-oauth.test.ts"
Task T026: "Integration test for OAuth flow in tests/integration/oauth-flow.test.ts"
Task T027: "Integration test for user creation in tests/integration/user-creation.test.ts"
Task T028: "Component test for GoogleLoginButton in tests/auth/google-login-button.test.tsx"
Task T029: "Accessibility test for login page in tests/ux/login-accessibility.test.tsx"
Task T030: "Visual regression test in tests/ux/login-visual.test.tsx"
Task T031: "Performance test for OAuth flow in tests/integration/oauth-performance.test.ts"
```

### Parallel Implementation Execution

```bash
# After tests are written and failing, launch parallel implementation:
Task T034: "Create Google icon in components/ui/icons.tsx"
Task T037: "Implement error display in components/auth/auth-error-alert.tsx"

# Then sequential dependencies:
Task T032 (depends on Foundational)
→ Task T033 (depends on T032)
→ Task T035 (depends on T034)
→ Task T036 (depends on T035)
→ Task T038 (depends on T037)
→ Task T039 (depends on T032, T033)
```

---

## Parallel Example: User Story 3 (Account Linking)

### Parallel Test Execution

```bash
# Launch all tests for User Story 3 together:
Task T059: "Unit test for account merging in tests/auth/account-merging.test.ts"
Task T060: "Unit test for account linking in tests/auth/account-linking.test.ts"
Task T061: "Unit test for account unlinking in tests/auth/account-unlinking.test.ts"
Task T062: "Contract test for /api/account/link/google in tests/contract/account-linking.test.ts"
Task T063: "Contract test for /api/account/unlink/google in tests/contract/account-linking.test.ts"
Task T064: "Integration test for linking flow in tests/integration/account-linking-flow.test.ts"
Task T065: "Integration test for merge confirmation in tests/integration/account-merge.test.ts"
Task T066: "Component test for AccountLinking in tests/auth/account-linking.test.tsx"
Task T067: "UX test for account linking flow in tests/ux/account-linking-ux.test.tsx"
Task T068: "Accessibility test for settings in tests/ux/settings-accessibility.test.tsx"
```

### Parallel Implementation Execution

```bash
# After tests are written and failing, launch parallel implementation:
Task T071: "Create link API in app/api/account/link/google/route.ts"
Task T072: "Create unlink API in app/api/account/unlink/google/route.ts"
Task T073: "Create UserProfile in components/auth/user-profile.tsx"
Task T076: "Create merge confirmation in app/auth/merge-confirm/page.tsx"
Task T077: "Implement audit logging in lib/auth/audit-log.ts"

# Then sequential tasks:
Task T069 (merging logic)
→ Task T070 (update signIn callback)
→ Task T074 (AccountLinking component, depends on T073)
→ Task T075 (settings page, depends on T073, T074)
→ Task T078 (add audit logging, depends on T077)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only - Fastest Path to Value)

**Goal**: Enable new users to sign in with Google in minimum time

1. ✅ **Phase 1: Setup** (T001-T007) - ~1 hour
   - Google Cloud Console setup
   - Environment variables configuration

2. ✅ **Phase 2: Foundational** (T008-T019) - ~2 hours
   - Database schema and migrations
   - NextAuth.js configuration
   - Token encryption
   - Error handling infrastructure
   - Testing infrastructure

3. ✅ **Phase 3: User Story 1** (T020-T043) - ~4-5 hours
   - Write all tests first (T020-T031) - ~1.5 hours
   - Implement authentication logic (T032-T033) - ~1 hour
   - Build UI components (T034-T036) - ~1 hour
   - Add error handling (T037-T038) - ~30 mins
   - Session management (T039) - ~30 mins
   - Validation and testing (T040-T043) - ~1 hour

4. **STOP and VALIDATE**: Test User Story 1 independently
   - Manual testing checklist
   - Accessibility validation
   - Performance validation
   - **Deploy/demo if ready**

**Total MVP Time**: ~7-8 hours

---

### Incremental Delivery (Add Features Progressively)

**Round 1: MVP** (Setup + Foundational + US1)

- **Result**: New users can sign in with Google
- **Deploy**: Production deployment #1
- **Value**: Core authentication working

**Round 2: Add US2** (Existing User Login)

- **Tasks**: T044-T058 (~2-3 hours)
- **Result**: Returning users have seamless experience
- **Deploy**: Production deployment #2
- **Value**: User retention improved

**Round 3: Add US3** (Account Linking)

- **Tasks**: T059-T082 (~3-4 hours)
- **Result**: Email/password users can migrate to Google OAuth
- **Deploy**: Production deployment #3
- **Value**: Flexible authentication options

**Round 4: Polish** (Production Hardening)

- **Tasks**: T083-T117 (~3-4 hours)
- **Result**: Production-ready with security, GDPR, monitoring
- **Deploy**: Production deployment #4
- **Value**: Enterprise-grade security and compliance

**Total Full Implementation**: ~15-20 hours

---

### Parallel Team Strategy (If Multiple Developers Available)

**Team Setup**: 3 developers working in parallel

**Phase 1-2: All Together** (Setup + Foundational)

- All developers collaborate on foundation (~3 hours)
- Pair programming for critical security components

**Phase 3+: Parallel User Stories**

- **Developer A**: User Story 1 (T020-T043) - ~4-5 hours
- **Developer B**: User Story 2 (T044-T058) - ~2-3 hours
- **Developer C**: User Story 3 (T059-T082) - ~3-4 hours

**Result**: All 3 user stories complete simultaneously after ~5 hours

**Phase 6: Divide Polish Tasks**

- **Developer A**: Security + GDPR (T083-T090)
- **Developer B**: Session Management + Error Handling (T091-T096)
- **Developer C**: Performance + Documentation (T097-T103)
- **All Together**: Testing + Deployment (T104-T117)

**Total Parallel Implementation Time**: ~10-12 hours (vs ~15-20 sequential)

---

## Task Summary

**Total Tasks**: 117

- **Setup**: 7 tasks (T001-T007)
- **Foundational**: 12 tasks (T008-T019)
- **User Story 1 (P1)**: 24 tasks (T020-T043)
- **User Story 2 (P2)**: 15 tasks (T044-T058)
- **User Story 3 (P3)**: 24 tasks (T059-T082)
- **Polish & Cross-Cutting**: 35 tasks (T083-T117)

**Parallel Opportunities Identified**:

- Setup: 7 tasks [P]
- Foundational: 8 tasks [P] (with dependencies)
- US1 Tests: 12 tasks [P]
- US1 Implementation: 4 tasks [P]
- US2 Tests: 6 tasks [P]
- US2 Implementation: 3 tasks [P]
- US3 Tests: 10 tasks [P]
- US3 Implementation: 7 tasks [P]
- Polish: 25+ tasks [P]
- **Total Parallelizable**: ~75 tasks

**Independent Test Criteria**:

- **US1**: New user can sign in with Google and access dashboard ✅
- **US2**: Existing user can sign in with same Google account ✅
- **US3**: User can link/unlink Google account in settings ✅

**Suggested MVP Scope**: User Story 1 only (Tasks T001-T043) - ~7-8 hours

---

## Notes

- **[P]** tasks = different files, no dependencies - can run in parallel
- **[Story]** label maps task to specific user story for traceability
- Each user story is independently completable and testable
- **TDD mandatory**: Write tests first, ensure they fail before implementing
- **UX mandatory**: Validate accessibility and shadcn/ui compliance
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Each phase builds working, deployable increments
- Security requirements (SR-001 to SR-024) validated in tests and implementation
- UX requirements (UX-001 to UX-045) validated in UX tests and component implementation
- Functional requirements (FR-001 to FR-018) mapped to tasks across all user stories
