'use client'

import type { ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { TaskArtifactAgent } from '@prisma/client'
// Monochrome brand glyphs, inlined locally (LUM-715). They render with
// fill=currentColor, so the chip drives the color.
import {
  ClaudeMono,
  CodexMono,
  CursorMono,
  GeminiMono,
  GithubCopilotMono,
  WindsurfMono,
} from '@/components/icons/agent-glyphs'

type IconComponent = ComponentType<{ size?: number; className?: string }>

interface AgentMeta {
  Icon: IconComponent
  /** brand color applied to the monochrome glyph + chip tint */
  color: string
}

export const AGENT_META: Record<TaskArtifactAgent, AgentMeta> = {
  [TaskArtifactAgent.CLAUDE_CODE]: { Icon: ClaudeMono, color: '#D97757' },
  [TaskArtifactAgent.CODEX]: { Icon: CodexMono, color: '#111827' },
  [TaskArtifactAgent.CURSOR]: { Icon: CursorMono, color: '#475569' },
  [TaskArtifactAgent.GEMINI_CLI]: { Icon: GeminiMono, color: '#3186FF' },
  [TaskArtifactAgent.GITHUB_COPILOT]: {
    Icon: GithubCopilotMono,
    color: '#1F2937',
  },
  [TaskArtifactAgent.WINDSURF]: { Icon: WindsurfMono, color: '#0D9488' },
}

/** Coerce any value to a known agent, defaulting to Claude Code. Guards
 *  against deploy-race rows read before the column exists and dirty data. */
function safeAgent(agent: TaskArtifactAgent): TaskArtifactAgent {
  return agent in AGENT_META ? agent : TaskArtifactAgent.CLAUDE_CODE
}

/** Localized label for an agent (taskArtifact.agent.<ENUM>). */
export function useAgentLabel(agent: TaskArtifactAgent): string {
  const intl = useIntl()
  return intl.formatMessage({ id: `taskArtifact.agent.${safeAgent(agent)}` })
}

/** Row badge: brand icon + label. */
export function AgentBadge({ agent }: { agent: TaskArtifactAgent }) {
  const a = safeAgent(agent)
  const { Icon, color } = AGENT_META[a]
  const label = useAgentLabel(a)
  return (
    <span className='inline-flex items-center gap-1.5 text-caption text-muted-foreground shrink-0'>
      <span
        className='inline-flex size-5 items-center justify-center rounded-full'
        style={{ backgroundColor: `${color}1A`, color }}
      >
        <Icon size={12} />
      </span>
      {label}
    </span>
  )
}

/** Icon-only avatar for the header stack. */
export function AgentAvatar({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[safeAgent(agent)]
  return (
    <span
      className='inline-flex size-5 items-center justify-center rounded-full ring-2 ring-background'
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <Icon size={12} />
    </span>
  )
}
