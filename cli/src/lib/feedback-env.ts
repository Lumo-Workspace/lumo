import * as os from 'os'
import type { LastCommand } from './last-command'

/** Environment variables (a plain record, so tests can pass a literal). */
type EnvLike = Record<string, string | undefined>

/**
 * LUM-1240 — the environment block `lumo feedback create` sends unless
 * `--no-env` is given. A WHITELIST: exactly these keys, built from the values
 * below and nothing else (the server rejects any other key). No hostname,
 * username, cwd, repository, branch, environment-variable value, argument
 * value, code, diff or transcript ever goes in here.
 */
export interface FeedbackEnv {
  cliVersion: string | null
  os: string
  osRelease: string | null
  arch: string | null
  nodeVersion: string | null
  /** Which agent runs this CLI, from the PRESENCE of its session variable. */
  agentHost: 'CLAUDE_CODE' | 'CODEX' | null
  lastCommand: LastCommand | null
}

export const FEEDBACK_ENV_KEYS = [
  'cliVersion',
  'os',
  'osRelease',
  'arch',
  'nodeVersion',
  'agentHost',
  'lastCommand',
] as const

const SAFE = /^[0-9A-Za-z._+-]{1,64}$/

function safe(value: string | undefined | null): string | null {
  return value && SAFE.test(value) ? value : null
}

/** Codex first: a Codex started from Claude Code inherits its session variable. */
export function detectAgentHost(
  env: EnvLike = process.env
): FeedbackEnv['agentHost'] {
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return 'CODEX'
  if (env.CLAUDE_CODE_SESSION_ID) return 'CLAUDE_CODE'
  return null
}

export function collectFeedbackEnv(input: {
  cliVersion: string | null
  lastCommand: LastCommand | null
  env?: EnvLike
}): FeedbackEnv {
  const version = input.cliVersion
  return {
    cliVersion:
      version &&
      /^\d{1,6}\.\d{1,6}\.\d{1,6}([-+][0-9A-Za-z.-]{1,32})?$/.test(version)
        ? version
        : null,
    os: process.platform,
    osRelease: safe(os.release()),
    arch: /^[a-z0-9_]{1,16}$/.test(process.arch) ? process.arch : null,
    nodeVersion: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(process.versions.node)
      ? process.versions.node
      : null,
    agentHost: detectAgentHost(input.env),
    lastCommand: input.lastCommand,
  }
}

const AGENT_TOKEN: Record<string, string> = {
  CLAUDE_CODE: 'claude-code',
  CODEX: 'codex',
}

/** The one-line summary printed after a submission (`Sent env:`). */
export function formatEnvSummary(env: FeedbackEnv | null): string {
  if (!env) return '- (disabled with --no-env)'
  const parts = [
    env.cliVersion ? `cli ${env.cliVersion}` : null,
    [env.os, env.osRelease, env.arch].filter(Boolean).join(' '),
    env.nodeVersion ? `node ${env.nodeVersion}` : null,
    env.agentHost ? (AGENT_TOKEN[env.agentHost] ?? env.agentHost) : null,
    env.lastCommand
      ? `last: ${env.lastCommand.command} (exit ${env.lastCommand.exitCode})`
      : null,
  ]
  return parts.filter((p): p is string => Boolean(p)).join(' · ')
}
