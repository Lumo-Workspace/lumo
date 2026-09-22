/**
 * LUM-739 — recognition tables for the diff subgraph (spec §6 L3). Lumo's
 * own stack first; a ProjectPolicy may extend these later. Pure data.
 *
 * `callee` regexes are tested against the dotted callee text of a call
 * expression (`prisma.$queryRawUnsafe`, `schema.parse`, `fetch`).
 */

export interface EntryRule {
  id: string
  /** Tested against the repo-relative path. */
  file: RegExp
  /** Tested against the symbol name; absent = any exported function in the file. */
  name?: RegExp
  /** The file must start with this directive (`'use server'`). */
  directive?: 'use server'
}

export const ENTRY_RULES: readonly EntryRule[] = [
  {
    id: 'next-route-handler',
    file: /(^|\/)app\/.*\/route\.tsx?$/,
    name: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/,
  },
  { id: 'next-server-action', file: /\.tsx?$/, directive: 'use server' },
  {
    id: 'webhook-handler',
    file: /(^|\/)webhooks?\//,
    name: /^(GET|POST|handle\w*|\w*Handler)$/,
  },
  {
    id: 'pages-api-handler',
    file: /(^|\/)pages\/api\/.*\.tsx?$/,
    name: /^(default|handler)$/,
  },
  { id: 'cli-command', file: /(^|\/)cli\/src\/commands\/[^/]+\.ts$/ },
]

export interface CallRule {
  id: string
  callee: RegExp
}

export const SINK_RULES: readonly CallRule[] = [
  {
    id: 'prisma-raw',
    callee: /\.\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/,
  },
  {
    /**
     * LUM-809 — `exec` is the only name here that collides with the standard
     * library, and the collision is one-sided: `RegExp.prototype.exec` ALWAYS
     * has a receiver (`/re/.exec(s)`, `RE.exec(s)`), while `child_process`'s is
     * imported and called bare or read off the module object. So `exec` is
     * accepted bare or module-qualified, never off an arbitrary receiver; the
     * rest of the family has no homonym and keeps the `(^|.)` form.
     *
     * The old rule took `.exec` from anything: all 76 `.exec(` call sites in
     * this repo are regexes and none is a child process, and on LUM-808's scan
     * two regex literals in a test file were the entire trigger surface — the
     * hunt then spent 97,432 tokens on them and submitted a candidate the
     * mechanical gate had to throw away.
     *
     * Known gap, taken knowingly: a namespace import under any other name
     * (`import * as cp` → `cp.exec(...)`) is not matched, because nothing in
     * the callee text tells it apart from a regex held in a variable. The
     * unambiguous names above still cover that import, and `exec` under an
     * alias is the narrow case — a blind spot beats a rule that cried wolf on
     * every regex in the repository.
     */
    id: 'child-process',
    callee:
      /(^|\.)(execSync|execFile|execFileSync|spawn|spawnSync)$|^exec$|^(child_process|childProcess)\.exec$/,
  },
  { id: 'fetch', callee: /^fetch$/ },
  { id: 'eval', callee: /^eval$/ },
  {
    id: 'fs-write',
    callee:
      /(^|\.)(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|mkdir|mkdirSync)$/,
  },
  {
    id: 'llm-call',
    callee: /(^|\.)(generateText|generateObject|streamText|streamObject)$/,
  },
  { id: 'redirect', callee: /(^|\.)(redirect|permanentRedirect)$/ },
]

/**
 * LUM-785 — taint SOURCES: calls whose return value is model output. The
 * same callees stay in SINK_RULES as `llm-call` (what goes INTO the model is
 * the hunt's prompt-injection concern); this table is about what comes OUT.
 * `llm-output-flow.ts` follows a result bound from one of these to a
 * `LLM_OUTPUT_TARGET_SINKS` call with no `zod-parse` on the path.
 */
export const SOURCE_RULES: readonly CallRule[] = [
  {
    id: 'llm-output',
    callee:
      /(^|\.)(generateText|generateObject|streamText|streamObject)$|\.(chat\.completions|completions|messages|responses)\.create$/,
  },
]

/** `new X(...)` sinks — tested against the constructor identifier. */
export const NEW_EXPRESSION_SINKS: readonly CallRule[] = [
  { id: 'new-function', callee: /^Function$/ },
]

export const CONTROL_RULES: readonly CallRule[] = [
  {
    id: 'auth',
    callee:
      /(^|\.)(auth|currentUser|getAuth|requireAuth|requireMember|requireWorkspaceMember|requireWorkspaceAccess|assertMember|assertWorkspaceAccess|resolveMember|getCurrentMember|requireApiKey|verifyApiKey|verifyOidc\w*|authenticate\w*|authorize\w*)$/,
  },
  { id: 'zod-parse', callee: /\.(parse|safeParse|parseAsync|safeParseAsync)$/ },
  {
    id: 'rate-limit',
    callee:
      /(^|\.)(rateLimit|ratelimit|checkRateLimit|enforceRateLimit|assertRateLimit)$/,
  },
  {
    id: 'workspace-scope',
    callee:
      /(^|\.)(assertWorkspace\w*|requireWorkspace\w*|scopeToWorkspace|withWorkspace\w*)$/,
  },
]

export function matchCallRule(
  rules: readonly CallRule[],
  callee: string
): CallRule | null {
  for (const r of rules) if (r.callee.test(callee)) return r
  return null
}
