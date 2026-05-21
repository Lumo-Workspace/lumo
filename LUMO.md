# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- SubagentStop hooks can block sub-agent completion, so extraction handlers must return quickly and handle failures gracefully to avoid deadlocking the agent team. <!-- from: LUM-37 -->
- Timeline sessions with only SESSION_START and SESSION_END events (eventCount ≤ 2, memoryCount === 0) represent transient Claude Code lifecycle noise, not real work, and clutter the timeline if displayed. <!-- from: LUM-39 -->
- A Session row has a single taskId foreign key. If a user switches tasks mid-session, all events in that session—including work done on prior tasks—will be attributed to whichever task the session was last attached to. <!-- from: LUM-40 -->
- When multiple Claude Code sessions run in parallel, switching the global task context in one session overwrites ~/.lumo/current-task.json for all sessions, causing subsequent hook events in other sessions to read the wrong task ID and mis-attribute work. <!-- from: LUM-40 -->
- Tiptap editor placeholders freeze at initialization-time locale and do not update when the language context changes, causing stale i18n strings to persist across locale switches. <!-- from: LUM-57 -->
- When a React component conditionally returns null instead of a placeholder element, adjacent text shifts left and breaks visual alignment across list rows. Affects any list where some items have icons and others do not. <!-- from: LUM-58 -->
- PR CI status may be null in the database when GitHub check_suite webhooks complete on a branch but the PR is missing from the suite's pull_requests array (e.g., after force-push or cross-fork scenarios), or when the repository has no CI configured. <!-- from: LUM-58 -->
## Decisions

- Memory extraction from sub-agents uses the SubagentStop hook rather than manual polling or post-processing because the hook provides immediate access to agent_result when execution completes. <!-- from: LUM-37 -->
- Sync state is database-driven: getTimeline computes unsyncedMemoryCount by comparing memory createdAt against the latest APPLIED LumoProposal's appliedAt timestamp. Frontend reads this value directly without local state management. <!-- from: LUM-39 -->
- Task binding is stored per-session in the server database, not in a global client-side file, because the global ~/.lumo/current-task.json file breaks parallel multi-task workflows when overwritten by one session. <!-- from: LUM-40 -->
- Session-start hook will not prompt the user to select a task because Claude Code hooks are non-interactive and cannot block on user input. Task binding must be driven by prior CLI invocations or by Claude conversational guidance. <!-- from: LUM-40 -->
- Task selection logic and prompts are delivered via session-start hook response body injection, not embedded in CLAUDE.md, because server-driven injection enables instant rollouts and personalization without requiring local file updates. <!-- from: LUM-40 -->
- Automatic memory sync PRs (title pattern '[Lumo] Sync project memory from LUM-N') are excluded from task PR lists because they represent infrastructure bookkeeping, not actual engineering work, and inflate PR counts misleadingly. <!-- from: LUM-58 -->
## Conventions

- API route handlers follow a strict three-step pattern: auth check → Zod validation → service call. Direct Prisma queries in route files violate the service-repository boundary established in CLAUDE.md. <!-- from: LUM-41 -->
## Procedures

- To dismiss a 0-operation Lumo proposal without losing sync state: POST /api/lumo-proposals/[proposalId]/dismiss to mark it APPLIED with current appliedAt, then call onSynced to refetch getTimeline. This prevents the banner from reappearing on tab switch. <!-- from: LUM-39 -->
- When refactoring an API route with direct Prisma calls: check if a service method exists for that query. If yes, replace the Prisma call with the service method. If no, create the service method first, then delegate to it from the route. <!-- from: LUM-41 -->
- To fix frozen Tiptap placeholders: store formatMessage() result in a ref, update the ref in a useEffect listening to locale changes, and trigger editor.commands.updateExtensions() to force a redraw without mutating the document. <!-- from: LUM-57 -->