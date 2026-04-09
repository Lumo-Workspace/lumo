/**
 * @jest-environment node
 *
 * Barrel export verification for @/lib/integrations/slack.
 * Ensures all public functions, types, and constants are accessible from the index.
 */

// Mock the bot module — it imports ESM-only packages ('chat', '@chat-adapter/slack')
// that cannot be transformed by Jest's CommonJS transformer
jest.mock('@/lib/integrations/slack/bot', () => ({
  slackAdapter: {},
  bot: {},
}))

// Mock Prisma to avoid DB connection requirements
jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))

// Mock crypto to avoid native module issues
jest.mock('@/lib/crypto', () => ({
  decrypt: jest.fn(),
  encrypt: jest.fn(),
}))

import * as slackModule from '@/lib/integrations/slack'

describe('lib/integrations/slack barrel exports', () => {
  it('exports ALL_SLACK_EVENTS as an array', () => {
    expect(Array.isArray(slackModule.ALL_SLACK_EVENTS)).toBe(true)
    expect(slackModule.ALL_SLACK_EVENTS.length).toBeGreaterThan(0)
  })

  it('exports SLACK_EVENT_LABELS as an object', () => {
    expect(typeof slackModule.SLACK_EVENT_LABELS).toBe('object')
    expect(slackModule.SLACK_EVENT_LABELS).not.toBeNull()
  })

  it('exports sendChannelNotification as a function', () => {
    expect(typeof slackModule.sendChannelNotification).toBe('function')
  })

  it('exports sendDMNotification as a function', () => {
    expect(typeof slackModule.sendDMNotification).toBe('function')
  })

  it('exports handleCommand as a function', () => {
    expect(typeof slackModule.handleCommand).toBe('function')
  })

  it('exports slackAdapter', () => {
    expect(slackModule.slackAdapter).toBeDefined()
  })

  it('exports bot', () => {
    expect(slackModule.bot).toBeDefined()
  })

  it('exports all expected public names', () => {
    const expectedExports = [
      'ALL_SLACK_EVENTS',
      'SLACK_EVENT_LABELS',
      'sendChannelNotification',
      'sendDMNotification',
      'handleCommand',
      'slackAdapter',
      'bot',
    ]
    const actualExports = Object.keys(slackModule)
    for (const name of expectedExports) {
      expect(actualExports).toContain(name)
    }
  })

  it('ALL_SLACK_EVENTS contains expected event types', () => {
    const expected = [
      'task_created',
      'task_assigned',
      'task_in_review',
      'task_done',
      'task_sent_back',
      'pr_opened',
      'pr_merged',
      'comment_mention',
    ]
    for (const event of expected) {
      expect(slackModule.ALL_SLACK_EVENTS).toContain(event)
    }
  })

  it('SLACK_EVENT_LABELS has a label for every event in ALL_SLACK_EVENTS', () => {
    for (const event of slackModule.ALL_SLACK_EVENTS) {
      expect(typeof slackModule.SLACK_EVENT_LABELS[event]).toBe('string')
    }
  })
})
