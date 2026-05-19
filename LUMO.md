# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- SubagentStop hooks can block sub-agent completion, so extraction handlers must return quickly and handle failures gracefully to avoid deadlocking the agent team. <!-- from: LUM-37 -->
- Timeline sessions with only SESSION_START and SESSION_END events (eventCount ≤ 2, memoryCount === 0) represent transient Claude Code lifecycle noise, not real work, and clutter the timeline if displayed. <!-- from: LUM-39 -->
- A Session row has a single taskId foreign key. If a user switches tasks mid-session, all events in that session—including work done on prior tasks—will be attributed to whichever task the session was last attached to. <!-- from: LUM-40 -->
- When multiple Claude Code sessions run in parallel, switching the global task context in one session overwrites ~/.lumo/current-task.json for all sessions, causing subsequent hook events in other sessions to read the wrong task ID and mis-attribute work. <!-- from: LUM-40 -->
## Decisions

- Memory extraction from sub-agents uses the SubagentStop hook rather than manual polling or post-processing because the hook provides immediate access to agent_result when execution completes. <!-- from: LUM-37 -->
- Sync state is database-driven: getTimeline computes unsyncedMemoryCount by comparing memory createdAt against the latest APPLIED LumoProposal's appliedAt timestamp. Frontend reads this value directly without local state management. <!-- from: LUM-39 -->
- Task binding is stored per-session in the server database, not in a global client-side file, because the global ~/.lumo/current-task.json file breaks parallel multi-task workflows when overwritten by one session. <!-- from: LUM-40 -->
- Session-start hook will not prompt the user to select a task because Claude Code hooks are non-interactive and cannot block on user input. Task binding must be driven by prior CLI invocations or by Claude conversational guidance. <!-- from: LUM-40 -->
- Task selection logic and prompts are delivered via session-start hook response body injection, not embedded in CLAUDE.md, because server-driven injection enables instant rollouts and personalization without requiring local file updates. <!-- from: LUM-40 -->
## Conventions

- API route handlers follow a strict three-step pattern: auth check → Zod validation → service call. Direct Prisma queries in route files violate the service-repository boundary established in CLAUDE.md. <!-- from: LUM-41 -->
## Procedures

- To dismiss a 0-operation Lumo proposal without losing sync state: POST /api/lumo-proposals/[proposalId]/dismiss to mark it APPLIED with current appliedAt, then call onSynced to refetch getTimeline. This prevents the banner from reappearing on tab switch. <!-- from: LUM-39 -->
- When refactoring an API route with direct Prisma calls: check if a service method exists for that query. If yes, replace the Prisma call with the service method. If no, create the service method first, then delegate to it from the route. <!-- from: LUM-41 -->