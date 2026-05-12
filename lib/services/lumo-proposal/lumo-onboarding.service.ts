import * as fs from 'fs'
import * as path from 'path'

interface OnboardingStatus {
  lumoMdExists: boolean
  claudeMdImported: boolean
  agentsMdExists: boolean
  agentsMdImported: boolean
}

interface OnboardingResult {
  created: string[]
  modified: string[]
  skipped: string[]
}

type ImportTarget = 'CLAUDE.md' | 'AGENTS.md'

const LUMO_MD_TEMPLATE = `# LUMO.md
<!-- Auto-maintained by Lumo. Do not edit manually. -->

## Traps

## Decisions

## Conventions

## Procedures
`

function fileContainsImport(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false
  const content = fs.readFileSync(filePath, 'utf-8')
  return content.includes('@import LUMO.md')
}

export const lumoOnboardingService = {
  checkStatus(repoPath: string): OnboardingStatus {
    const lumoPath = path.join(repoPath, 'LUMO.md')
    const claudePath = path.join(repoPath, 'CLAUDE.md')
    const agentsPath = path.join(repoPath, 'AGENTS.md')

    return {
      lumoMdExists: fs.existsSync(lumoPath),
      claudeMdImported: fileContainsImport(claudePath),
      agentsMdExists: fs.existsSync(agentsPath),
      agentsMdImported: fileContainsImport(agentsPath),
    }
  },

  perform(repoPath: string, targets: ImportTarget[]): OnboardingResult {
    const created: string[] = []
    const modified: string[] = []
    const skipped: string[] = []

    const lumoPath = path.join(repoPath, 'LUMO.md')
    if (!fs.existsSync(lumoPath)) {
      fs.writeFileSync(lumoPath, LUMO_MD_TEMPLATE, 'utf-8')
      created.push('LUMO.md')
    } else {
      skipped.push('LUMO.md')
    }

    for (const target of targets) {
      const targetPath = path.join(repoPath, target)

      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, `@import LUMO.md\n`, 'utf-8')
        created.push(target)
      } else if (!fileContainsImport(targetPath)) {
        const existing = fs.readFileSync(targetPath, 'utf-8')
        const separator = existing.endsWith('\n') ? '' : '\n'
        fs.writeFileSync(
          targetPath,
          existing + separator + '@import LUMO.md\n',
          'utf-8'
        )
        modified.push(target)
      } else {
        skipped.push(target)
      }
    }

    return { created, modified, skipped }
  },
}
