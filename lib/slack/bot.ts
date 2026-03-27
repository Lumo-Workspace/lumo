import { Chat } from 'chat'
import { createSlackAdapter } from '@chat-adapter/slack'

export const slackAdapter = createSlackAdapter({
  clientId: process.env.SLACK_CLIENT_ID!,
  clientSecret: process.env.SLACK_CLIENT_SECRET!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
})

export const bot = new Chat({
  userName: 'Lumo',
  adapters: { slack: slackAdapter },
})
