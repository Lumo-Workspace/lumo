# Security policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions or pull requests.**

Report privately through either channel:

- **GitHub:** the **Report a vulnerability** button on this repository's
  [Security tab](https://github.com/Lumo-Workspace/lumo-oss/security/advisories/new) (private vulnerability
  reporting).
- **Email:** [security@uselumo.ai](mailto:security@uselumo.ai).

Include as much as you can of:

- the affected component (web app, API route, `@lumoai/cli`, MCP server,
  self-hosting files) and the version or commit;
- the impact as you understand it, and the conditions an attacker needs;
- steps to reproduce or a proof of concept;
- whether the issue is already public or known to anyone else.

Do not access, modify or delete data that is not yours, do not degrade the
service for others, and give us a reasonable chance to fix the issue before you
disclose it.

## What happens next

| Step                            | Target                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| Acknowledge your report         | within 3 business days                                                                       |
| Initial assessment and severity | within 10 business days                                                                      |
| Fix for a confirmed issue       | critical / high: as fast as possible, aim for 30 days · moderate / low: next regular release |

We keep you updated while we work on it, agree a disclosure date with you, and
credit you in the advisory unless you prefer to stay anonymous. Fixes are
published as a GitHub security advisory together with the release that contains
them. These are targets, not contractual commitments.

## Supported versions

Security fixes go into the latest release only. If you self-host Lumo, update to
the newest release tag; older releases do not receive back-ported fixes. The
`@lumoai/cli` npm package follows the same rule: only its latest published
version is supported.

## Scope

In scope:

- the code in this repository — the web application and its API, the CLI
  (`cli/`, published as `@lumoai/cli`), the shared package (`shared/`), the MCP
  server, and the self-hosting files (`Dockerfile`, `docker-compose.yml`,
  `deploy/`);
- the hosted service, Lumo Cloud (`uselumo.ai`), through the same channels.

Lumo Cloud includes a commercial plugin that is not part of this repository.
Report issues in Lumo Cloud's plugin features to the same address; they are
handled the same way, but there is no code for them here.

Out of scope: vulnerabilities in third-party dependencies that do not affect
Lumo (report those upstream), findings from automated scanners without a
demonstrated impact, missing best-practice headers without an exploit, social
engineering, and denial of service by volume.
