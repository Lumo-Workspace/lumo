import { parseCliVersion } from '@/lib/api/cli-version-gate'

/**
 * LUM-1136 — the Lumo CLI / skill versions a SessionStart hook reports, shown
 * on the members page. Both headers are untrusted client input: anything that
 * is not one of the known shapes is dropped (never stored), so the column only
 * ever holds a value the UI knows how to render.
 */
export interface ClientVersions {
  cliVersion?: string
  skillVersion?: string
}

export const SKILL_VERSION_HEADER = 'X-Lumo-Skill-Version'
const CLI_VERSION_HEADER = 'X-Lumo-Cli-Version'

/** `1.2.3`, `1.2.3 modified`, `modified`, `source`, `none` (no copy installed). */
const SKILL_VERSION_RE =
  /^(?:\d{1,6}\.\d{1,6}\.\d{1,6}(?: modified)?|modified|source|none)$/

/** A well-formed skill-version value (see SKILL_VERSION_RE), or null. */
export function parseSkillVersion(
  value: string | null | undefined
): string | null {
  const v = (value ?? '').trim()
  return SKILL_VERSION_RE.test(v) ? v : null
}

/** The valid version headers on `headers`; absent / malformed ones are omitted. */
export function parseClientVersionHeaders(headers: Headers): ClientVersions {
  const out: ClientVersions = {}
  const cli = parseCliVersion(headers.get(CLI_VERSION_HEADER))
  if (cli) out.cliVersion = cli.join('.')
  const skill = parseSkillVersion(headers.get(SKILL_VERSION_HEADER))
  if (skill) out.skillVersion = skill
  return out
}
