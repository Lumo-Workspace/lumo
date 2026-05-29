'use client'

import type { ComponentType } from 'react'
import { useIntl } from 'react-intl'
import { TaskArtifactAgent } from '@prisma/client'
// Official monochrome brand glyphs from @lobehub/icons. We deep-import the Mono
// component directly (not the `{ Claude }` namespace or its `.Avatar`) because
// the namespace's `.Avatar` pulls in @lobehub/ui + antd; Mono is self-contained
// (react only) and renders with fill=currentColor, so the chip drives the color.
import ClaudeMono from '@lobehub/icons/es/Claude/components/Mono'
import CodexMono from '@lobehub/icons/es/Codex/components/Mono'
import CursorMono from '@lobehub/icons/es/Cursor/components/Mono'
import GeminiMono from '@lobehub/icons/es/Gemini/components/Mono'
import GithubCopilotMono from '@lobehub/icons/es/GithubCopilot/components/Mono'
import WindsurfMono from '@lobehub/icons/es/Windsurf/components/Mono'

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

/** Localized label for an agent (taskArtifact.agent.<ENUM>). */
export function useAgentLabel(agent: TaskArtifactAgent): string {
  const intl = useIntl()
  return intl.formatMessage({ id: `taskArtifact.agent.${agent}` })
}

/** Row badge: brand icon + label. */
export function AgentBadge({ agent }: { agent: TaskArtifactAgent }) {
  const { Icon, color } = AGENT_META[agent]
  const label = useAgentLabel(agent)
  return (
    <span className='inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0'>
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
  const { Icon, color } = AGENT_META[agent]
  return (
    <span
      className='inline-flex size-5 items-center justify-center rounded-full ring-2 ring-background'
      style={{ backgroundColor: `${color}1A`, color }}
    >
      <Icon size={12} />
    </span>
  )
}
