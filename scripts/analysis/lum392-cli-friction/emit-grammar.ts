/**
 * LUM-413: regenerate grammar.json from the live CLI commander tree.
 *
 * Run:    npx tsx scripts/analysis/lum392-cli-friction/emit-grammar.ts
 * Print:  npx tsx scripts/analysis/lum392-cli-friction/emit-grammar.ts --print
 *
 * Imports cli/src/index.ts under LUMO_CLI_INTROSPECT=1 (no parse, no update
 * check, no side effects) and walks the registered command tree. The
 * committed grammar.json is the snapshot the AST validator and the drift
 * test (grammar-drift.test.ts) pin against: any CLI command change must
 * regenerate it, which re-anchors the validator regression set.
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { extractGrammar, type CommandLike } from './grammar'

async function main() {
  process.env.LUMO_CLI_INTROSPECT = '1'
  const here = dirname(fileURLToPath(import.meta.url))
  const cliPkg = JSON.parse(
    readFileSync(join(here, '../../../cli/package.json'), 'utf8')
  ) as { version: string }
  const { program } = (await import('../../../cli/src/index')) as {
    program: CommandLike
  }
  const grammar = extractGrammar(program, cliPkg.version)
  const json = JSON.stringify(grammar, null, 2) + '\n'
  if (process.argv.includes('--print')) {
    process.stdout.write(json)
    return
  }
  writeFileSync(join(here, 'grammar.json'), json)
  console.log(
    `grammar.json written: ${Object.keys(grammar.commands).length} command nodes (cli v${grammar.cliVersion})`
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
