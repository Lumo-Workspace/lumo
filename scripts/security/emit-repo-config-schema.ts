/**
 * LUM-1146: regenerate the JSON schema editors validate `.lumo.yaml` against,
 * from the one Zod schema (ee/security/validation/repo-config.ts).
 *
 * Run:  npx tsx scripts/security/emit-repo-config-schema.ts
 *
 * The committed file is served at `/schemas/lumo-yaml.schema.json`; the test
 * __tests__/ee/security/lum1146-repo-config.test.ts fails when it
 * drifts from the Zod schema.
 */
import { writeFileSync } from 'fs'
import { join } from 'path'
import {
  REPO_CONFIG_JSON_SCHEMA_PATH,
  repoConfigJsonSchema,
} from '../../ee/security/validation/repo-config'

const out = join(process.cwd(), REPO_CONFIG_JSON_SCHEMA_PATH)
writeFileSync(out, `${JSON.stringify(repoConfigJsonSchema(), null, 2)}\n`)
process.stdout.write(`wrote ${REPO_CONFIG_JSON_SCHEMA_PATH}\n`)
