## ADDED Requirements

### Requirement: User Role Collection

The system SHALL collect a user's primary role during onboarding after the Team Size step. The UI MUST display the prompt text exactly as: "What’s your role?".

Allowed options (exact text):

- Product Manager
- Engineer
- Designer
- Founder / Executive
- Project Manager

#### Scenario: Select role and continue

- **WHEN** a user completes the Team Size step and proceeds
- **THEN** they are shown a Role selection with the allowed options
- **AND** they can choose a role and continue
- **AND** the chosen role is persisted in workspace settings or onboarding profile

#### Scenario: Skip role selection

- **WHEN** a user opts to skip
- **THEN** the system continues without storing a role value

#### Scenario: Validate only allowed values

- **WHEN** the client submits a value not in the allowed options
- **THEN** the server rejects the request with a validation error
