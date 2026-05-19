# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- SubagentStop hooks can block sub-agent completion, so extraction handlers must return quickly and handle failures gracefully to avoid deadlocking the agent team. <!-- from: LUM-37 -->
- Timeline sessions with only SESSION_START and SESSION_END events (eventCount ≤ 2, memoryCount === 0) represent transient Claude Code lifecycle noise, not real work, and clutter the timeline if displayed. <!-- from: LUM-39 -->
## Decisions

- Memory extraction from sub-agents uses the SubagentStop hook rather than manual polling or post-processing because the hook provides immediate access to agent_result when execution completes. <!-- from: LUM-37 -->
- Sync state is database-driven: getTimeline computes unsyncedMemoryCount by comparing memory createdAt against the latest APPLIED LumoProposal's appliedAt timestamp. Frontend reads this value directly without local state management. <!-- from: LUM-39 -->
## Conventions

- API route handlers follow a strict three-step pattern: auth check → Zod validation → service call. Direct Prisma queries in route files violate the service-repository boundary established in CLAUDE.md. <!-- from: LUM-41 -->
## Procedures

- To dismiss a 0-operation Lumo proposal without losing sync state: POST /api/lumo-proposals/[proposalId]/dismiss to mark it APPLIED with current appliedAt, then call onSynced to refetch getTimeline. This prevents the banner from reappearing on tab switch. <!-- from: LUM-39 -->
- When refactoring an API route with direct Prisma calls: check if a service method exists for that query. If yes, replace the Prisma call with the service method. If no, create the service method first, then delegate to it from the route. <!-- from: LUM-41 -->