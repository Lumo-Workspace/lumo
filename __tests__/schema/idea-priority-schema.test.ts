/**
 * @jest-environment node
 *
 * LUM-660: team-level Idea/Priority schema foundation (Spec1).
 * A schema-parse test asserting the shape of the two new models directly
 * against prisma/schema.prisma — the frozen contract for the地基:
 *   - Idea: teamId + workspaceId, NO projectId, @@unique([teamId, number]),
 *     nullable self-referencing parentId, IdeaStatus enum (CAPTURED, PLANNED).
 *   - Priority: teamId/workspaceId/statement/effectiveFrom, append-only
 *     (no `updatedAt`, no update/delete surface at the schema level).
 */
import { readFileSync } from 'fs'
import path from 'path'

const schema = readFileSync(
  path.resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8'
)

/** Extract the body of a `model <name> { … }` block from the schema text. */
function modelBlock(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, 'm')
  const m = schema.match(re)
  if (!m?.[1]) throw new Error(`model ${name} not found in schema.prisma`)
  return m[1]
}

describe('LUM-660 Idea/Priority schema foundation', () => {
  it('Idea and Priority schema shape', () => {
    const idea = modelBlock('Idea')
    const priority = modelBlock('Priority')

    // ── Idea: team-level scoping, NO projectId ───────────────────────────────
    expect(idea).toMatch(/^\s*teamId\s+String\s*$/m)
    expect(idea).toMatch(/^\s*workspaceId\s+String\b/m)
    // The whole point of the foundation: ideas live ABOVE projects.
    expect(idea).not.toMatch(/projectId/)

    // ── per-team numbering ───────────────────────────────────────────────────
    expect(idea).toMatch(/@@unique\(\[teamId,\s*number\]\)/)
    expect(idea).toMatch(/^\s*number\s+Int\b/m)

    // ── nullable self-referencing parentId (Phase-2 hierarchy placeholder) ───
    expect(idea).toMatch(/^\s*parentId\s+String\?/m)
    expect(idea).toMatch(
      /parent\s+Idea\?\s+@relation\("IdeaHierarchy",\s*fields:\s*\[parentId\],\s*references:\s*\[id\]/
    )
    expect(idea).toMatch(/children\s+Idea\[\]\s+@relation\("IdeaHierarchy"\)/)

    // ── IdeaStatus enum (CAPTURED → PLANNED) ─────────────────────────────────
    const enumMatch = schema.match(/enum IdeaStatus \{([\s\S]*?)\n\}/m)
    expect(enumMatch).not.toBeNull()
    const ideaStatus = enumMatch![1]
    expect(ideaStatus).toMatch(/\bCAPTURED\b/)
    expect(ideaStatus).toMatch(/\bPLANNED\b/)
    expect(idea).toMatch(/status\s+IdeaStatus\s+@default\(CAPTURED\)/)

    // ── Priority: team-level, required core fields ───────────────────────────
    expect(priority).toMatch(/^\s*teamId\s+String\s*$/m)
    expect(priority).toMatch(/^\s*workspaceId\s+String\s*$/m)
    expect(priority).toMatch(/^\s*statement\s+String\b/m)
    expect(priority).toMatch(/^\s*effectiveFrom\s+DateTime\b/m)

    // ── Priority is append-only: no `updatedAt` (no mutation surface) ────────
    expect(priority).not.toMatch(/updatedAt/)
  })
})
