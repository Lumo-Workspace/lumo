# Lumo Subprocessors

Last updated: 2026-10-28 · Draft for legal review (LUM-857)

This page lists the third parties ("subprocessors") that [Lumo legal entity] ("Lumo", "we") engages to process Customer Personal Data on behalf of our customers when providing the Lumo service. It is the list referenced by the Lumo Data Processing Agreement (DPA). We notify customers of changes as described in "Changes to this list" below.

## Infrastructure subprocessors

These subprocessors process data for every workspace.

| Subprocessor | Service | Purpose | Data processed | Data location |
| --- | --- | --- | --- | --- |
| Vercel Inc. | Hosting and serverless functions | Runs the Lumo web application, API and scheduled jobs | All data in transit through the application | United States |
| Vercel Inc. | Vercel Blob | Stores uploaded files: images, workspace logos, test-case evidence (screenshots), raw security-scan uploads | Uploaded files | United States |
| Vercel Inc. | Vercel Sandbox | Short-lived isolated virtual machines that clone a customer repository to run static security analysis on a pull request; the machine is discarded after the scan | Customer source code | United States |
| Vercel Inc. | Vercel AI Gateway | Routes every model request to an LLM hosting provider; every request except boundary-crossing triage is sent with zero data retention enforced, and the gateway itself does not retain prompts or outputs | Prompts and outputs (may contain customer code) | Global edge network; no retention |
| Neon Inc. (a Databricks company) | Serverless Postgres | Primary database for all workspace data | All stored customer data | United States (AWS us-east-1) |
| Pusher Ltd. | Pusher Channels | Real-time updates pushed to open browser tabs | Task and activity update events | United States (us2 cluster) |
| Upstash Inc. (via Vercel KV) | Redis key-value store | Rate limiting of API and upload endpoints | Request counters keyed by workspace or token identifier | United States |
| Resend Inc. | Transactional email | Sends transactional emails: one-time sign-in codes, workspace invitations, workspace deletion notices to workspace owners, and subprocessor change notices to workspace owners | Recipient email address, one-time sign-in code, workspace name, name of the member who sent the invitation or requested the deletion | United States |

## AI model hosting subprocessors

Lumo sends prompts that may contain customer code, diffs, task text and agent session records to large language models for code and security review, summaries and memory features. Every request goes through the Vercel AI Gateway. Except for boundary-crossing triage (see the notes below), zero data retention (ZDR) is enforced on the request: the gateway only routes to providers that have a ZDR agreement with Vercel, and a request fails rather than falling back to a provider that would retain data. ZDR includes a commitment not to train on the data.

Which provider serves a given request is chosen by the gateway from the ZDR-eligible set for that model, based on availability. Every provider below may therefore receive requests.

| Subprocessor | Models served for Lumo | Purpose | Retention terms | Data location |
| --- | --- | --- | --- | --- |
| OpenAI, L.L.C. | GPT reasoning model | Security judgement, verification and review checks | Zero data retention with safety retention (limited retention for abuse monitoring); no training | Routed globally; no location commitment |
| Anthropic, PBC | Claude Sonnet and Haiku models | AI code review and security hunt of pull requests | Zero data retention; no training | Routed globally; no location commitment |
| Microsoft Corporation (Azure) | GPT reasoning model; open-weight models | Fallback host for the above | Zero data retention; no training | Routed globally; no location commitment |
| Alibaba Cloud | Qwen embedding model; open-weight models | Summaries, memory, embeddings | Zero data retention under a custom agreement with Vercel; no training | Routed globally; no location commitment |
| Baseten, Inc. | Open-weight models | Summaries, content and policy compilation | Zero data retention; no training | Routed globally; no location commitment |
| DeepInfra, Inc. | Open-weight and embedding models | Summaries, memory, embeddings | Zero data retention; no training | Routed globally; no location commitment |
| DigitalOcean, LLC | Open-weight models; TypeSafe Jev evaluation model | Fallback host; boundary-crossing triage (Jev) | Zero data retention; no training — except TypeSafe Jev: no zero data retention, no training | Routed globally; no location commitment |
| Together Computer, Inc. (Together AI) | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Nebius B.V. | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Parasail | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Runware | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Wafer | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |

Notes on AI processing:

- Boundary-crossing triage is the one exception. When Lumo's rule detectors flag an action an AI agent took, Lumo asks TypeSafe's Jev model, through the Vercel AI Gateway, whether the action was a legitimate part of the task. For this it sends the flagged command or file path (with detected credentials redacted), the project rule that fired, the task's title and description, and the agent's own explanation. Jev's only host, DigitalOcean, has committed not to train on the data but does not offer zero data retention. Turning off AI review in workspace settings stops this triage.
- Zero data retention is each provider's own policy, and a provider can exclude specific models or features from it; the Vercel AI Gateway does not fail such requests (see Vercel's [zero data retention documentation](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr)). Lumo sends only text and does not use the features the providers above list as exclusions, such as stored conversations, file or image inputs, hosted tools or batch processing. Providers may still cache parts of a prompt to speed up repeated requests; OpenAI keeps this cache encrypted for up to 24 hours.
- AI code review and security hunt requests are sent only to Anthropic's own API; the gateway is not allowed to route them to any other host of Claude models. Anthropic may retain inputs and outputs of a request flagged by its automated trust and safety systems for up to 2 years, or where required by law.
- Open-weight models (the DeepSeek and GLM model families) are run by the hosting providers above. The model authors' own APIs (DeepSeek and Zhipu AI) do not receive Lumo customer data: they do not offer zero data retention through the gateway and are excluded from routing.
- AI requests are routed globally: for each request the gateway picks a region based on availability and latency, so processing may take place outside your region. Zero data retention applies wherever a request is processed. We do not currently commit to a processing location for AI features; customers who need a data-location commitment for AI processing should contact us before relying on this list.
- Lumo does not use customer data to train models, and does not permit its subprocessors to do so.

## Customer-enabled integrations

The following services exchange data with Lumo only when a workspace member connects them. The customer chooses to connect them and has its own agreement with each provider; Lumo acts on the customer's instructions when it reads from or writes to them. Access tokens for these services are encrypted with AES-256-GCM before storage.

| Service | Provider | What Lumo reads or writes | Enabled by |
| --- | --- | --- | --- |
| GitHub App and GitHub account link | GitHub, Inc. | Repository contents, pull requests, check runs and comments on installed repositories; the member's GitHub identity | Workspace admin installs the App; each member links their own account |
| Slack | Slack Technologies, LLC | Messages and threads a member links to a task or idea; notifications posted to chosen channels | Workspace admin |
| Figma | Figma, Inc. | Metadata and previews of Figma files a member links | Each member |
| Google Drive | Google LLC | Google Docs a member chooses to import | Each member |
| Sentry | Functional Software, Inc. (Sentry) | Error events the customer's Sentry project sends to Lumo by webhook | Workspace admin |

## Changes to this list

We will announce any new subprocessor, or any change in the purpose or data location of an existing one, by updating this page and the subprocessor list on our security page (https://www.uselumo.ai/security), and by email to the owners of every workspace, at least [30] days before the change takes effect, except where a change is needed urgently to keep the service secure or available, in which case we will notify as soon as possible. Workspace owners are notified automatically and do not need to sign up. Customers may object to a change as set out in the DPA.

### Change history

The main tables above list only subprocessors in effect on the "Last updated" date. A change that is announced but not yet in effect is listed here until it takes effect.

| Change | Announced | Takes effect | Summary |
| --- | --- | --- | --- |
| 2026-10-05-resend-purpose | 2026-10-05 | 2026-10-05 | Resend (transactional email): purpose corrected to workspace invitations, workspace deletion notices and subprocessor change notices to workspace owners. These emails were already being sent; nothing else changes. |
| 2026-10-12-resend-purpose | 2026-10-12 | 2026-10-12 | Resend (transactional email): purpose now also includes one-time sign-in codes, since Lumo moved sign-in to its own authentication service on 2026-10-12. These emails are already being sent; nothing else changes. |
| 2026-10-12-clerk-purpose | 2026-10-12 | 2026-10-12 | Clerk (authentication): no longer handles sign-in since Lumo moved sign-in to its own authentication service on 2026-10-12. Clerk keeps the account data it already held only so that Lumo can switch back if needed, and that data is deleted no later than 2026-11-11. |
| 2026-10-14-anthropic-purpose | 2026-10-14 | 2026-10-14 | Anthropic (AI model hosting): purpose extended from AI code review to AI code review and security hunt of pull requests, because the model the hunt ran on through Alibaba Cloud was withdrawn. Hunt requests go only to Anthropic's own API under zero data retention; no subprocessor is added. |
| 2026-10-28-clerk-removed | 2026-10-28 | 2026-10-28 | Clerk (authentication) removed: its instance, and with it the account data it still held from before Lumo moved sign-in to its own authentication service, was deleted on 2026-10-28. |

Workspace owners receive change notices automatically. A customer can ask [privacy@uselumo.ai] to send these notices to one additional recipient address as well, which we record manually. Anyone else who wants to hear about changes, or who has a question about this list, can contact [privacy@uselumo.ai].
