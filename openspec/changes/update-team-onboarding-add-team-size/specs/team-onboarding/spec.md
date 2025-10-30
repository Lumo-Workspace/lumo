## ADDED Requirements

### Requirement: Team Size Collection

The system SHALL collect a team/company size during onboarding after the Team Name step.

Allowed options (exact text):

- "1 (Just me)"
- "2–5"
- "6–20"
- "21–50"
- "51–200"
- "200+"

#### Scenario: Select team size and continue

- **WHEN** a user completes the Team Name step and proceeds
- **THEN** they are shown a Team Size selection with predefined ranges
- **AND** they can choose a size and continue
- **AND** the chosen size is persisted with the team or workspace settings

#### Scenario: Validate only allowed values

- **WHEN** the client submits a value not in the allowed options
- **THEN** the server rejects the request with a validation error

#### Scenario: Skip team size

- **WHEN** a user opts to skip
- **THEN** the system continues onboarding without storing a size value

## MODIFIED Requirements

### Requirement: Team Creation

The system SHALL allow users to create a team after authentication.

#### Scenario: Successful team creation

- **WHEN** an authenticated user without a team accesses the application
- **THEN** they are redirected to the onboarding page

#### Scenario: Complete onboarding

- **WHEN** a user provides a valid team name and optional workspace URL
- **THEN** the system prepares team creation and proceeds to the next step
- **AND** the primary CTA text on the Team Name step reads "Continue"
- **AND** the user can review/add additional details (e.g., Team Size) before finalization
