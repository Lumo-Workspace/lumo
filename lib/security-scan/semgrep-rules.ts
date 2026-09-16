/**
 * LUM-785 — Lumo's own semgrep rules, as the string the managed scan writes
 * into the sandbox before running semgrep (`security-managed-scan.service.ts`).
 *
 * The source of truth is `security/semgrep-rules/llm.yaml` (what
 * `semgrep --test` and a human edit). This constant exists because the file
 * itself is not part of the serverless bundle: reading it from disk at run
 * time would depend on output tracing picking it up, and a silently missing
 * rule file would land as a semgrep "config not found" failure in production.
 * `__tests__/security-managed-scan.service.lum785.test.ts` asserts the two
 * are byte-identical — edit the YAML, then paste it here.
 */

/**
 * Where the managed scan writes the rules: a dotfile at the ROOT of the
 * checkout (the scan's cwd), removed again once semgrep has run. Not `/tmp`:
 * semgrep prefixes a local config's rule ids with its directory path
 * (`/tmp/x/llm.yaml` → `tmp.x.lumo.llm.…`), and only a file in cwd keeps the
 * ids as written (`lumo.llm.…` → `ext:semgrep:lumo.llm.…`, verified on
 * 1.176.1). The file never reaches the customer's git history — the checkout
 * is a throwaway clone — and it is a YAML target no TypeScript rule matches.
 */
export const SEMGREP_CUSTOM_RULES_PATH = '.lumo-semgrep-rules.yaml'
/** Heredoc terminator — must never appear inside the YAML. */
export const SEMGREP_CUSTOM_RULES_EOF = 'LUMO_SEMGREP_RULES_EOF'

export const LLM_SEMGREP_RULES_YAML = `# LUM-785 — Lumo's own semgrep rules for LLM-specific defects (spec §6 L1).
#
# Shipped into the managed-scan sandbox by \`security-managed-scan.service.ts\`
# (the sandbox clones the CUSTOMER repo, so a repo-relative \`--config\` could
# never find this file) and loaded with \`--config <dir>\` next to the registry
# packs. The findings then ride the existing SARIF normalisation unchanged:
# \`metadata.security-severity\` → severity, \`metadata.source\` → helpUri →
# externalRef. Zero new code paths on the read side.
#
# Fixtures: \`llm.ts\` beside this file, run by \`scripts/security/semgrep-rules-test.ts\`
# (\`semgrep --test\`). \`lib/security-scan/semgrep-rules.ts\` carries a byte-identical
# copy for bundling — a jest parity test keeps the two in step.
rules:
  - id: lumo.llm.untrusted-input-in-prompt
    message: >-
      Request-derived input reaches an LLM prompt (\`messages\` / \`prompt\` /
      \`system\` / message \`content\`) without a schema parse in between. Text the
      caller controls becomes part of the instruction stream (prompt injection).
      Parse it with a schema first, or put it in a clearly delimited data
      block and keep instructions out of the same string.
    languages: [typescript, javascript]
    severity: WARNING
    mode: taint
    metadata:
      category: security
      subcategory: [vuln]
      cwe: 'CWE-1427: Improper Neutralization of Input Used for LLM Prompting'
      technology: [llm, ai-sdk, openai]
      confidence: MEDIUM
      likelihood: MEDIUM
      impact: MEDIUM
      security-severity: '5.0'
      source: https://github.com/Lumo-Workspace/lumo/blob/main/security/semgrep-rules/llm.yaml
      references:
        - https://cwe.mitre.org/data/definitions/1427.html
        - https://owasp.org/www-project-top-10-for-large-language-model-applications/
    pattern-sources:
      - pattern-either:
          - pattern: $REQ.body
          - pattern: $REQ.query
          - pattern: $REQ.params
          - pattern: $REQ.headers
          - pattern: $REQ.cookies
          - pattern: $REQ.nextUrl.searchParams
          - pattern: await $REQ.json()
          - pattern: await $REQ.text()
          - pattern: await $REQ.formData()
          - pattern: $REQ.json()
          - pattern: $REQ.text()
          - pattern: $REQ.formData()
          - pattern: $URL.searchParams
          - pattern: searchParams.get(...)
          - pattern: formData.get(...)
          - pattern: params.$KEY
          - pattern: body.$KEY
      - patterns:
          - pattern-either:
              - pattern-inside: |
                  function $F(..., $P, ...) { ... }
              - pattern-inside: |
                  async function $F(..., $P, ...) { ... }
              - pattern-inside: |
                  (..., $P, ...) => { ... }
              - pattern-inside: |
                  async (..., $P, ...) => { ... }
              - pattern-inside: |
                  $M(..., $P, ...) { ... }
              - pattern-inside: |
                  async $M(..., $P, ...) { ... }
          - focus-metavariable: $P
    pattern-sanitizers:
      - pattern-either:
          - pattern: $S.parse(...)
          - pattern: $S.parseAsync(...)
          - pattern: $S.safeParse(...)
          - pattern: $S.safeParseAsync(...)
          - pattern: await $S.parseAsync(...)
          - pattern: await $S.safeParseAsync(...)
    pattern-sinks:
      # LUM-793: \`content\` is matched only as a MESSAGE part — an object that
      # also carries \`role\`. The bare \`{..., content: $V, ...}\` sink this
      # replaces keyed on the property NAME, so every non-LLM object literal
      # with a \`content\` field (a memory card, a comment, a document, an
      # artifact) was a finding: 112 hits repo-wide, 11 of them at a real
      # prompt site. The rule's own message always said "message \`content\`";
      # this is that sentence, expressed as a pattern. \`messages\` / \`prompt\` /
      # \`system\` are unchanged — they are prompt-only property names.
      - patterns:
          - pattern-either:
              - pattern: |
                  {..., messages: $V, ...}
              - pattern: |
                  {..., prompt: $V, ...}
              - pattern: |
                  {..., system: $V, ...}
              - pattern: |
                  {..., role: $R, content: $V, ...}
          - pattern-not-inside: generateText(...)
          - pattern-not-inside: generateObject(...)
          - pattern-not-inside: streamText(...)
          - pattern-not-inside: streamObject(...)
          - focus-metavariable: $V

  - id: lumo.llm.untrusted-input-in-ai-sdk-prompt
    message: >-
      Request-derived input reaches the \`prompt\` / \`system\` / \`messages\` of an
      AI SDK call (\`generateText\` / \`generateObject\` / \`streamText\` /
      \`streamObject\`) without a schema parse in between (prompt injection).
      Parse it with a schema first, or pass it as delimited data rather than
      as part of the instruction string.
    languages: [typescript, javascript]
    severity: WARNING
    mode: taint
    metadata:
      category: security
      subcategory: [vuln]
      cwe: 'CWE-1427: Improper Neutralization of Input Used for LLM Prompting'
      technology: [llm, ai-sdk]
      confidence: MEDIUM
      likelihood: MEDIUM
      impact: MEDIUM
      security-severity: '5.0'
      source: https://github.com/Lumo-Workspace/lumo/blob/main/security/semgrep-rules/llm.yaml
      references:
        - https://cwe.mitre.org/data/definitions/1427.html
        - https://ai-sdk.dev/docs/ai-sdk-core/generating-text
    pattern-sources:
      - pattern-either:
          - pattern: $REQ.body
          - pattern: $REQ.query
          - pattern: $REQ.params
          - pattern: $REQ.headers
          - pattern: $REQ.cookies
          - pattern: $REQ.nextUrl.searchParams
          - pattern: await $REQ.json()
          - pattern: await $REQ.text()
          - pattern: await $REQ.formData()
          - pattern: $REQ.json()
          - pattern: $REQ.text()
          - pattern: $REQ.formData()
          - pattern: $URL.searchParams
          - pattern: searchParams.get(...)
          - pattern: formData.get(...)
          - pattern: params.$KEY
          - pattern: body.$KEY
      - patterns:
          - pattern-either:
              - pattern-inside: |
                  function $F(..., $P, ...) { ... }
              - pattern-inside: |
                  async function $F(..., $P, ...) { ... }
              - pattern-inside: |
                  (..., $P, ...) => { ... }
              - pattern-inside: |
                  async (..., $P, ...) => { ... }
              - pattern-inside: |
                  $M(..., $P, ...) { ... }
              - pattern-inside: |
                  async $M(..., $P, ...) { ... }
          - focus-metavariable: $P
    pattern-sanitizers:
      - pattern-either:
          - pattern: $S.parse(...)
          - pattern: $S.parseAsync(...)
          - pattern: $S.safeParse(...)
          - pattern: $S.safeParseAsync(...)
          - pattern: await $S.parseAsync(...)
          - pattern: await $S.safeParseAsync(...)
    pattern-sinks:
      - patterns:
          - pattern-either:
              - pattern: |
                  $FN({..., prompt: $V, ...}, ...)
              - pattern: |
                  $FN({..., system: $V, ...}, ...)
              - pattern: |
                  $FN({..., messages: $V, ...}, ...)
          - metavariable-regex:
              metavariable: $FN
              regex: ^(generateText|generateObject|streamText|streamObject)$
          - focus-metavariable: $V

  - id: lumo.llm.system-prompt-from-runtime-value
    message: >-
      The \`system\` prompt is assembled from a runtime value (template
      interpolation or string concatenation). A system prompt should be a
      constant: anything interpolated into it is promoted to instruction-level
      trust. Move runtime data into the user turn as delimited data.
    languages: [typescript, javascript]
    severity: WARNING
    metadata:
      category: security
      subcategory: [audit]
      cwe: 'CWE-1427: Improper Neutralization of Input Used for LLM Prompting'
      technology: [llm, ai-sdk, openai]
      confidence: MEDIUM
      likelihood: LOW
      impact: MEDIUM
      security-severity: '4.0'
      source: https://github.com/Lumo-Workspace/lumo/blob/main/security/semgrep-rules/llm.yaml
      references:
        - https://cwe.mitre.org/data/definitions/1427.html
    pattern-either:
      - patterns:
          - pattern-either:
              - pattern: |
                  {..., system: \`...\${$X}...\`, ...}
              - pattern: |
                  {..., role: "system", content: \`...\${$X}...\`, ...}
          - metavariable-regex:
              metavariable: $X
              # An interpolated ALL_CAPS identifier is a constant
              # (\`\${SYSTEM_PROMPT}\`), not a runtime value — stays quiet.
              regex: '^(?![A-Z0-9_]+$)'
          - focus-metavariable: $X
      - patterns:
          - pattern-either:
              - pattern: |
                  {..., system: $S, ...}
              - pattern: |
                  {..., role: "system", content: $S, ...}
          - metavariable-pattern:
              metavariable: $S
              pattern: $A + $B
          - pattern-not: |
              {..., system: "..." + "...", ...}
          - pattern-not: |
              {..., role: "system", content: "..." + "...", ...}
          - focus-metavariable: $S
`
