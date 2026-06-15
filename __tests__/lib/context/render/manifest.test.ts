/** @jest-environment node */
// LUM-500: with resources defaulting to a Tier-2 one-line manifest, each
// manifest must be decision-useful on its own — it carries the type tag, a
// short descriptor so an agent can tell whether to pull, and the
// `lumo … show <id>` retrieval hint. These tests pin that shape.

import {
  slackManifest,
  type SlackContextCard,
} from '@/lib/context/render/slack'
import {
  webLinkManifest,
  type WebLinkCard,
} from '@/lib/context/render/web-link'
import { figmaManifest } from '@/lib/context/render/figma'
import { prManifest, type PRCard } from '@/lib/context/render/pr'
import type { TaskFigmaLink } from '@prisma/client'

describe('slackManifest (LUM-500)', () => {
  const base: SlackContextCard = {
    id: 'slk_1',
    isThread: true,
    slackChannelName: 'eng-backend',
    permalink: 'https://x.slack.com/archives/C1/p1',
    snapshotAt: new Date('2026-06-01T00:00:00Z'),
    refreshError: null,
    summary: 'Decided to migrate the auth service to Clerk before the launch.',
    snapshot: { messages: [] },
  }

  it('carries the type tag, the channel, a summary descriptor, and the show hint with the task identifier', () => {
    const line = slackManifest(base, 'LUM-42')
    expect(line).toContain('[external:slack]')
    expect(line).toContain('#eng-backend')
    expect(line).toContain('Decided to migrate') // descriptor from summary
    expect(line).toContain('lumo task slack show LUM-42 slk_1')
    expect(line.split('\n')).toHaveLength(1) // one line
  })

  it('truncates a long summary and stays one line', () => {
    const line = slackManifest({ ...base, summary: 'A'.repeat(300) }, 'LUM-42')
    expect(line.split('\n')).toHaveLength(1)
    expect(line.length).toBeLessThan(200)
  })

  it('omits the descriptor gracefully when there is no summary', () => {
    const line = slackManifest({ ...base, summary: null }, 'LUM-42')
    expect(line).toContain('[external:slack]')
    expect(line).toContain('#eng-backend')
    expect(line).toContain('lumo task slack show LUM-42 slk_1')
    expect(line.split('\n')).toHaveLength(1)
  })
})

describe('webLinkManifest (LUM-500)', () => {
  const base: WebLinkCard = {
    id: 'web_1',
    url: 'https://docs.example.com/guide',
    domain: 'docs.example.com',
    title: 'Deployment Runbook',
    description: null,
    note: null,
    fetchedAt: new Date('2026-06-01T00:00:00Z'),
    fetchError: null,
  }

  it('carries the type tag, the page title, the host, and the show hint with the task identifier', () => {
    const line = webLinkManifest(base, 'LUM-42')
    expect(line).toContain('[external:web]')
    expect(line).toContain('Deployment Runbook') // descriptor from title
    expect(line).toContain('docs.example.com') // host
    expect(line).toContain('lumo task web show LUM-42 web_1')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('falls back to the url + host when there is no title', () => {
    const line = webLinkManifest({ ...base, title: null }, 'LUM-42')
    expect(line).toContain('[external:web]')
    expect(line).toContain('docs.example.com')
    expect(line).toContain('lumo task web show LUM-42 web_1')
    expect(line.split('\n')).toHaveLength(1)
  })
})

describe('figmaManifest (LUM-500)', () => {
  const base = {
    id: 'fig_1',
    fileName: 'Design System',
    frameName: 'Login Screen',
  } as TaskFigmaLink

  it('carries the type tag, the file/frame name, and the context hint with the task identifier', () => {
    const line = figmaManifest(base, 'LUM-42')
    expect(line).toContain('[external:figma]')
    expect(line).toContain('Design System') // descriptor
    expect(line).toContain('Login Screen')
    expect(line).toContain('lumo task figma context LUM-42 fig_1')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('handles a file-level link without a frame name', () => {
    const line = figmaManifest(
      { ...base, frameName: null } as TaskFigmaLink,
      'LUM-42'
    )
    expect(line).toContain('[external:figma]')
    expect(line).toContain('Design System')
    expect(line).toContain('lumo task figma context LUM-42 fig_1')
    expect(line.split('\n')).toHaveLength(1)
  })
})

describe('prManifest (LUM-500)', () => {
  const base: PRCard = {
    number: 42,
    title: 'Add Google OAuth login',
    state: 'OPEN',
    ciStatus: 'passing',
  }

  it('carries the type tag, the PR title, and the show hint with the task identifier', () => {
    const line = prManifest(base, 'LUM-42')
    expect(line).toContain('[external:github]')
    expect(line).toContain('#42')
    expect(line).toContain('Add Google OAuth login') // descriptor
    expect(line).toContain('lumo task pr show LUM-42 42')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('truncates a very long PR title and stays one line', () => {
    const line = prManifest(
      { ...base, title: 'Refactor '.repeat(40) },
      'LUM-42'
    )
    expect(line.split('\n')).toHaveLength(1)
    expect(line.length).toBeLessThan(200)
  })
})
