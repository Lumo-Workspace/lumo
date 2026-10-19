/**
 * LUM-413: regenerate grammar.json from the live CLI commander tree.
 *
 * Run:    npx tsx scripts/cli-grammar/emit-grammar.ts
 * Print:  npx tsx scripts/cli-grammar/emit-grammar.ts --print
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
import {
  CODEX_CLASSES_FILE,
  codexClassesSource,
  extractGrammar,
  type CommandLike,
} from './grammar'

async function main() {
  process.env.LUMO_CLI_INTROSPECT = '1'
  const here = dirname(fileURLToPath(import.meta.url))
  const cliPkg = JSON.parse(
    readFileSync(join(here, '../../cli/package.json'), 'utf8')
  ) as { version: string }
  const { program } = (await import('../../cli/src/index')) as {
    program: CommandLike
  }
  const grammar = extractGrammar(program, cliPkg.version)
  // Format through prettier (repo config) so the emitted bytes are identical
  // to what the pre-commit hook would produce — `emit-grammar && git diff
  // --exit-code grammar.json` must be a clean no-op on an up-to-date tree
  // (LUM-640; raw JSON.stringify expands the short arrays prettier collapses).
  const prettier = await import('prettier')
  const outPath = join(here, 'grammar.json')
  const config = (await prettier.resolveConfig(outPath)) ?? {}
  const json = await prettier.format(JSON.stringify(grammar), {
    ...config,
    parser: 'json',
  })
  const classesPath = join(here, '../..', CODEX_CLASSES_FILE)
  const classes = await prettier.format(codexClassesSource(grammar), {
    ...((await prettier.resolveConfig(classesPath)) ?? {}),
    parser: 'typescript',
  })
  if (process.argv.includes('--print')) {
    process.stdout.write(json)
    return
  }
  writeFileSync(outPath, json)
  writeFileSync(classesPath, classes)
  console.log(
    `grammar.json written: ${Object.keys(grammar.commands).length} command nodes (cli v${grammar.cliVersion})`
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
