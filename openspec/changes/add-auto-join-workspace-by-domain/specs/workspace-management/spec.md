## ADDED Requirements

### Requirement: Auto-join Workspace by Email Domain

The system SHALL automatically join new users to an existing workspace based on their email domain, excluding public email providers. New domains must go through manual onboarding.

#### Scenario: Auto-join existing workspace by domain (enabled)

- **WHEN** a new user signs in with email `user@acme.com`
- **AND** a Team exists with `domain = "acme.com"` and `allowAutoJoin = true`
- **THEN** the user is automatically added as a TeamMember (role: member)
- **AND** the user's session includes team and workspace information
- **AND** the user is redirected to the workspace (not onboarding)

#### Scenario: Auto-join disabled by owner

- **WHEN** a new user signs in with email `user@acme.com`
- **AND** a Team exists with `domain = "acme.com"` but `allowAutoJoin = false`
- **THEN** no auto-join occurs
- **AND** the user proceeds to normal onboarding flow
- **AND** the user must manually create a team/workspace

#### Scenario: New domain proceeds to onboarding

- **WHEN** a new user signs in with email `user@startup.io`
- **AND** no Team exists with `domain = "startup.io"`
- **AND** "startup.io" is not a public email provider
- **THEN** no auto-join occurs
- **AND** the user proceeds to normal onboarding flow
- **AND** the user must manually create a team/workspace

#### Scenario: Skip auto-join for public email providers

- **WHEN** a new user signs in with email `user@gmail.com`
- **THEN** no auto-join occurs
- **AND** the user proceeds to normal onboarding flow
- **AND** the user must manually create a team/workspace

#### Scenario: Skip auto-join if user already has team membership

- **WHEN** a user with existing team membership signs in
- **THEN** auto-join logic is skipped
- **AND** existing team membership is used

### Requirement: Domain-to-Workspace Mapping

The system SHALL maintain a mapping between email domains and Teams/Workspaces, allowing multiple Teams per domain.

#### Scenario: Multiple Teams per domain

- **WHEN** multiple Teams use the same domain (e.g., "acme.com")
- **AND** a new user signs in with `user@acme.com`
- **THEN** the user auto-joins the earliest created Team with `allowAutoJoin = true`
- **AND** other Teams with the same domain remain unaffected

### Requirement: Auto-join Control

Team owners SHALL be able to enable or disable auto-join for their domain.

#### Scenario: Owner enables auto-join

- **WHEN** a Team owner sets `allowAutoJoin = true` for their team's domain
- **THEN** new users with matching email domain can automatically join
- **AND** auto-join occurs according to the main requirement

#### Scenario: Owner disables auto-join

- **WHEN** a Team owner sets `allowAutoJoin = false` for their team's domain
- **THEN** new users with matching email domain must go through onboarding
- **AND** no auto-join occurs regardless of domain match

## MODIFIED Requirements

### Requirement: Team Creation (from team-onboarding)

The system SHALL allow users to create a team after authentication, or automatically join/create based on email domain.

#### Scenario: Manual team creation still works

- **WHEN** a user with public email (e.g., gmail.com) signs in
- **THEN** they proceed to manual onboarding flow
- **AND** can create a team manually as before
