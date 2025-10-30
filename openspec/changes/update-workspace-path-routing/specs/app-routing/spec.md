## ADDED Requirements

### Requirement: Path-Based Workspace Routing

The application SHALL route workspace context using the path `/app/{workspaceUrl}`.

#### Scenario: Redirect to default workspace

- **WHEN** an authenticated user with a team visits `/app`
- **THEN** they are redirected to `/app/{workspaceUrl}` for their default team

#### Scenario: Unknown workspace slug

- **WHEN** a user visits `/app/{workspaceUrl}` that does not exist
- **THEN** the system returns 404 or a friendly error page

#### Scenario: Unauthorized workspace access

- **WHEN** an authenticated user visits `/app/{workspaceUrl}` for a team they do not belong to
- **THEN** the system blocks access (403) or redirects to their own workspace

#### Scenario: Post-onboarding redirect

- **WHEN** a user finishes onboarding and a workspace is created
- **THEN** they are redirected to `/app/{workspaceUrl}`
