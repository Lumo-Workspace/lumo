import { EXIT_ERROR, EXIT_USAGE } from '../lib/exit-codes'
import {
  listSkillFiles,
  readSkillFile,
  SKILL_READ_FOOTER,
} from '../lib/skill-content'

/**
 * LUM-1292 — `lumo skill read [path]`: print the Lumo skill (SKILL.md by
 * default, or a file under it like `references/tasks.md`) from the CLI
 * package. Local read only: no login, no network.
 */
export async function skillRead(
  rel: string | undefined
): Promise<number | void> {
  const result = readSkillFile(
    rel === undefined || rel === '' ? undefined : rel
  )
  if (!result.ok) {
    if (result.error === 'outside') {
      console.error(`Error: "${rel}" is outside the skill directory.`)
      console.error(
        'Hint: use a path relative to the skill root, e.g. `lumo skill read references/tasks.md`.'
      )
      return EXIT_USAGE
    }
    console.error(`Error: no skill file "${rel}".`)
    console.error(
      `Hint: lumo skill read <path> — available: ${listSkillFiles().join(', ')}`
    )
    return EXIT_ERROR
  }
  if (rel === undefined || rel === '') {
    process.stdout.write(`${result.content}\n${SKILL_READ_FOOTER}\n`)
  } else {
    process.stdout.write(result.content)
  }
}
