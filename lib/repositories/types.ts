// lib/repositories/types.ts
// Shared type definitions for the repository layer.
// These types describe common data shapes returned from repository queries.

// ── Task ────────────────────────────────────────────────────────────────────

export interface TaskBasic {
  id: string
  title: string
  status: string
  priority: string
  identifier: string
}

// ── Project ─────────────────────────────────────────────────────────────────

export interface ProjectBasic {
  id: string
  name: string
  workspaceId: string
}
