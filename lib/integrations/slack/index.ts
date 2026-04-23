// Types and constants
export type {
  SlackEventType,
  NotificationPayload,
  CommandResult,
} from './types'
export { ALL_SLACK_EVENTS, SLACK_EVENT_LABELS } from './types'

// Notification functions
export { sendChannelNotification, sendDMNotification } from './notify'

// Command handler
export { handleCommand } from './commands'

// Bot adapter intentionally NOT re-exported here: `./bot` imports the pure-ESM
// `chat` and `@chat-adapter/slack` packages, which break Jest resolution and
// leak server code into client bundles (see MEMORY:
// project_integrations_barrel_rsc_boundary.md). Any code that actually needs
// `bot` or `slackAdapter` should import directly from
// `@/lib/integrations/slack/bot`.
