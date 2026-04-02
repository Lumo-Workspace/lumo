# Notification Preference Gate

## Problem

Notification dispatch (`notifyActor`, `createAndPush`, comment mentions) sends all notifications unconditionally. The `UserPreference` toggles (10 booleans: 5 events x inApp/slack) are stored but never checked before sending.

## Solution

A centralized `shouldNotify()` function that gates notification delivery per-channel based on user preferences.

## Architecture

### New file: `lib/notifications/preferenceGate.ts`

```typescript
shouldNotify(recipientActorId: string, channel: 'inApp' | 'slack', notificationType: NotificationType): Promise<boolean>
```

- Resolves actor → memberId → `UserPreference`
- Maps `NotificationType` to the corresponding preference boolean field
- Returns `true` if no preference record exists (default: all enabled)
- **Always returns `true`** for `requiresAction` types (`AGENT_CLARIFY`, `AGENT_AUTHORIZE`, `AGENT_VERIFY`) — these are critical and must never be silenced

### NotificationType → Preference field mapping

| NotificationType                                                          | inApp field           | slack field           |
| ------------------------------------------------------------------------- | --------------------- | --------------------- |
| TASK_ASSIGNED, TASK_SENT_BACK, TASK_DONE, TASK_IN_REVIEW, TASK_SPEC_READY | notifyInAppAssigned   | notifySlackAssigned   |
| TASK_MENTIONED                                                            | notifyInAppMention    | notifySlackMention    |
| AGENT_CLARIFY, AGENT_AUTHORIZE                                            | notifyInAppAgentInput | notifySlackAgentInput |
| AGENT_DONE, AGENT_FAILED, AGENT_VERIFY                                    | notifyInAppAgentDone  | notifySlackAgentDone  |

Note: `notifyInApp/SlackComment` is reserved for future non-mention comment notifications (e.g. replies to your comment). Currently unused.

### Integration points

1. **`notifyActor()` in `notifyTaskChange.ts`**
   - Before inbox creation: check `shouldNotify(recipientActorId, 'inApp', notificationType)`
   - Before Slack DM: check `shouldNotify(recipientActorId, 'slack', slackEventType → notificationType)`
   - Slack **channel** notifications are NOT gated (project-level, not personal)
   - Pusher push only fires if inbox notification was created

2. **`createAndPush()` in `notifyAgentActions.ts`**
   - Before inbox creation: check `shouldNotify(recipientActorId, 'inApp', type)`
   - Pusher push only fires if inbox notification was created

3. **Comment mention logic in `comments/route.ts`**
   - Batch-fetch preferences for all mentioned users
   - Filter inbox creation per user based on inApp preference
   - Filter Slack DM per user based on slack preference

### Performance

- Single DB query per recipient (or batch `findMany` for multi-recipient scenarios like mentions)
- No caching needed — preferences change rarely and notification volume is low
- Helper: `shouldNotifyBatch(recipientActorIds[], channel, notificationType)` for the mention case

### What does NOT change

- Slack channel notifications (project-level config, not user preference)
- `requiresAction` notifications (always delivered)
- Notification API routes (GET/PATCH/DELETE)
- `usePreferences` hook / NotificationsPage UI
- Event dispatcher / state machines
