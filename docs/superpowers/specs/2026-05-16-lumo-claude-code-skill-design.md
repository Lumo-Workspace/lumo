# Lumo Claude Code Skill Design

**Date**: 2026-05-16
**Scope**: Single `.claude/skills/lumo/SKILL.md` file for task context loading and session management

## Overview

A Claude Code skill that teaches Claude how to use the `lumo` CLI to:

1. Load task context (description, history, unresolved items) before starting work
2. Manage session–task bindings (start / attach)

Task status updates and subtask creation are out of scope for this iteration.

## Trigger Conditions

The skill should activate when:

- User mentions a Lumo task identifier (e.g., "LUM-42", "look at LUM-12")
- User asks to load task context or background
- User wants to bind/switch the current session to a task
- User is about to start development work on a specific task

## Skill Structure

### 1. Prerequisites Check

Before any CLI operation:

1. Verify `lumo` is on PATH (`which lumo`)
2. Verify login status (`lumo whoami`)
3. If either fails, instruct user with the fix (`npm install`, `lumo auth login`)

### 2. Task Context Loading

**Command**: `lumo task context <identifier>`

**Output format** (markdown to stdout):

- Task identifier, title, status, description
- Memory section (cross-session learnings)
- Previous sessions list with: short ID, recency, duration, headline summary, unresolved items

**Guidance for Claude**:

- Unresolved items from the most recent session are carry-over TODOs — address them first
- Memory section contains validated cross-session context — trust it as background
- Session summaries are ordered newest-first; focus on the most recent 1–2 sessions
- If the task has no prior sessions, this is a fresh start — read the description carefully

### 3. Session Management

Two commands, different use cases:

| Command                    | When to use                                             |
| -------------------------- | ------------------------------------------------------- |
| `lumo session start <ID>`  | Before launching a new `claude code` session for a task |
| `lumo session attach <ID>` | Mid-session, to bind the running session to a task      |

**`session start`**: Writes `~/.lumo/current-task.json` so the next Claude Code session's hook events are tagged with this task. Use when the user says "I'm going to work on LUM-42" before starting.

**`session attach`**: Does the same as start, AND server-side re-tags the current session's hook events. Use when already inside a Claude Code session and the user mentions a task — suggest attaching so this session's work is tracked.

**Guidance for Claude**:

- If the user mentions a task ID and no session is currently bound, suggest `session attach`
- After attaching, automatically run `task context` to load the task background
- Don't run `session start` from inside an active session — use `attach` instead

## File Location

`.claude/skills/lumo/SKILL.md`

## Not Included

- Task status updates (`lumo task update` — future CLI command)
- Subtask creation (`lumo task create-subtask` — future CLI command)
- Direct Lumo API calls via curl (use CLI wrapper exclusively)
- Automatic session binding on every conversation start (handled by hooks, not skill)
