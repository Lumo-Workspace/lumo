# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

- SubagentStop hooks can block sub-agent completion, so extraction handlers must return quickly and handle failures gracefully to avoid deadlocking the agent team. <!-- from: LUM-37 -->
## Decisions

- Memory extraction from sub-agents uses the SubagentStop hook rather than manual polling or post-processing because the hook provides immediate access to agent_result when execution completes. <!-- from: LUM-37 -->
## Conventions

## Procedures
