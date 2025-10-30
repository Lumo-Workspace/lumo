## ADDED Requirements

### Requirement: Team Creation

The system SHALL allow users to create a team after authentication.

#### Scenario: Successful team creation

- **WHEN** an authenticated user without a team accesses the application
- **THEN** they are redirected to the onboarding page

#### Scenario: Complete onboarding

- **WHEN** a user provides a valid team name and optional workspace URL
- **THEN** the system creates the team with the specified workspace URL
- **AND** the user is assigned as a team member with owner role
- **AND** the user is redirected to the application

### Requirement: Workspace URL Generation

The system SHALL automatically generate a URL-safe workspace identifier from the team name.

#### Scenario: Auto-generate URL from team name

- **WHEN** a user enters "Hello World" as team name
- **THEN** the workspace URL is auto-generated as "hello-world"
- **AND** the full URL preview shows "uselumo.ai/hello-world"

#### Scenario: Handle special characters

- **WHEN** a user enters "Team#1 @Acme Corp!"
- **THEN** special characters are removed to generate "team1-at-acme-corp"

#### Scenario: Handle long names

- **WHEN** a user enters a team name longer than 50 characters
- **THEN** the generated URL is truncated to 50 characters while preserving readability

### Requirement: Workspace URL Customization

The system SHALL allow users to customize the auto-generated workspace URL.

#### Scenario: Custom URL override

- **WHEN** the auto-generated URL is "hello-world"
- **AND** the user changes it to "acme-team"
- **THEN** the workspace is created with the custom URL
- **AND** the full URL preview updates to show "uselumo.ai/acme-team"

### Requirement: Workspace URL Format Validation

The system SHALL enforce URL format restrictions to ensure valid workspace URLs.

#### Scenario: Valid URL format

- **WHEN** a user enters a URL containing only lowercase letters, numbers, and hyphens
- **THEN** the URL is accepted

#### Scenario: Invalid URL format

- **WHEN** a user enters a URL with uppercase letters, spaces, or special characters
- **THEN** an error message is displayed
- **AND** the submission is prevented

#### Scenario: URL length validation

- **WHEN** a user enters a URL shorter than 2 characters or longer than 50 characters
- **THEN** an error message is displayed
- **AND** the submission is prevented

### Requirement: Workspace URL Uniqueness

The system SHALL ensure workspace URLs are unique across all teams.

#### Scenario: Unique URL accepted

- **WHEN** a user enters a workspace URL that doesn't exist
- **THEN** the URL is available and the submission proceeds

#### Scenario: Duplicate URL rejected

- **WHEN** a user enters a workspace URL that already exists
- **THEN** an error message suggests using a different URL
- **AND** the submission is prevented

### Requirement: Team Membership Check

The system SHALL verify users have team membership before allowing application access.

#### Scenario: User with team accesses app

- **WHEN** an authenticated user with team membership accesses /app
- **THEN** the application loads normally
- **AND** team context is available in the session

#### Scenario: User without team accesses app

- **WHEN** an authenticated user without team membership accesses /app
- **THEN** they are redirected to /onboarding
- **AND** the onboarding flow is initiated

### Requirement: Reserved URL Protection

The system SHALL prevent users from using reserved workspace URLs.

#### Scenario: Reserved URL blocked

- **WHEN** a user attempts to use a reserved URL (e.g., "admin", "api", "www")
- **THEN** an error message indicates the URL is reserved
- **AND** the submission is prevented
- **AND** an alternative is suggested
