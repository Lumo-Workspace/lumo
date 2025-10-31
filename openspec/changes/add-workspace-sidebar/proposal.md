## Why

We want to rebuild the workspace experience from scratch, starting with a clean `workspace/[workspaceUrl]` page scaffold that includes a shadcn/ui Sidebar for primary navigation.

## What Changes

- Create a new layout for `app/workspace/[workspaceUrl]/` with a persistent Sidebar (shadcn/ui) and a main content area.
- Sidebar contains two SidebarGroup sections (both list document items):
  - Draft: Draft (single list/entry point for drafts)
  - Workspace: Documents (workspace docs list/navigation)
- Include a collapsible workspace switcher at the top.
- Keep data wiring minimal; focus on structure and styling. Navigation links can be stubs for now.

## Impact

- Affected specs: app-routing (workspace), workspace-ui
- Affected code:
  - `app/workspace/[workspaceUrl]/layout.tsx` – shell with Sidebar and slot
  - `components/workspace/Sidebar.tsx` – shadcn/ui Sidebar component with items
  - Minimal styles, no external state until requested
