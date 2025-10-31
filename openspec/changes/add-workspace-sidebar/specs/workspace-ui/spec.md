## ADDED Requirements

### Requirement: Workspace Sidebar Shell

The system SHALL render a persistent Sidebar on `workspace/[workspaceUrl]` with primary navigation grouped into two SidebarGroups and a content slot.

#### Scenario: Sidebar renders with grouped doc items

- **WHEN** a user visits `/workspace/{workspaceUrl}`
- **THEN** the page shows a left Sidebar with two groups:
  - Draft: Draft (documents)
  - Workspace: Documents (workspace-level documents)
- **AND** the main content area renders the route content

#### Scenario: Responsive collapse

- **WHEN** the viewport is narrow
- **THEN** the Sidebar can collapse into an icon-only rail or a toggleable drawer
