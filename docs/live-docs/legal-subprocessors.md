# Lumo Subprocessors

Last updated: 2026-09-26 · Draft for legal review (LUM-857)

This page lists the third parties ("subprocessors") that [Lumo legal entity] ("Lumo", "we") engages to process Customer Personal Data on behalf of our customers when providing the Lumo service. It is the list referenced by the Lumo Data Processing Agreement (DPA). We notify customers of changes as described in "Changes to this list" below.

## Infrastructure subprocessors

These subprocessors process data for every workspace.

| Subprocessor | Service | Purpose | Data processed | Data location |
| --- | --- | --- | --- | --- |
| Vercel Inc. | Hosting and serverless functions | Runs the Lumo web application, API and scheduled jobs | All data in transit through the application | United States |
| Vercel Inc. | Vercel Blob | Stores uploaded files: images, workspace logos, test-case evidence (screenshots), raw security-scan uploads | Uploaded files | United States |
| Vercel Inc. | Vercel Sandbox | Short-lived isolated virtual machines that clone a customer repository to run static security analysis on a pull request; the machine is discarded after the scan | Customer source code | United States |
| Vercel Inc. | Vercel AI Gateway | Routes every model request to an LLM hosting provider; every request is sent with zero data retention enforced, and the gateway itself does not retain prompts or outputs | Prompts and outputs (may contain customer code) | Global edge network; no retention |
| Neon Inc. (a Databricks company) | Serverless Postgres | Primary database for all workspace data | All stored customer data | United States (AWS us-east-1) |
| Clerk Inc. | Authentication | Sign-in, user accounts, sessions, organization membership | Name, email address, profile image, authentication metadata | United States |
| Pusher Ltd. | Pusher Channels | Real-time updates pushed to open browser tabs | Task and activity update events | United States (us2 cluster) |
| Upstash Inc. (via Vercel KV) | Redis key-value store | Rate limiting of API and upload endpoints | Request counters keyed by workspace or token identifier | United States |
| Resend Inc. | Transactional email | Sends workspace invitation emails | Recipient email address, inviter name, workspace name | United States |

## AI model hosting subprocessors

Lumo sends prompts that may contain customer code, diffs, task text and agent session records to large language models for security review, summaries and memory features. Every request goes through the Vercel AI Gateway with zero data retention (ZDR) enforced on the request: the gateway only routes to providers that have a ZDR agreement with Vercel, and a request fails rather than falling back to a provider that would retain data. ZDR includes a commitment not to train on the data.

Which provider serves a given request is chosen by the gateway from the ZDR-eligible set for that model, based on availability. Every provider below may therefore receive requests.

| Subprocessor | Models served for Lumo | Purpose | Retention terms | Data location |
| --- | --- | --- | --- | --- |
| OpenAI, L.L.C. | GPT reasoning model | Security judgement, verification and review checks | Zero data retention with safety retention (limited retention for abuse monitoring); no training | Routed globally; no location commitment |
| Microsoft Corporation (Azure) | GPT reasoning model; open-weight models | Fallback host for the above | Zero data retention; no training | Routed globally; no location commitment |
| Alibaba Cloud | Qwen coder and embedding models; open-weight models | Security hunt, summaries, memory, embeddings | Zero data retention under a custom agreement with Vercel; no training | Routed globally; no location commitment |
| Baseten, Inc. | Open-weight models | Summaries, content and policy compilation | Zero data retention; no training | Routed globally; no location commitment |
| DeepInfra, Inc. | Open-weight and embedding models | Summaries, memory, embeddings | Zero data retention; no training | Routed globally; no location commitment |
| DigitalOcean, LLC | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Together Computer, Inc. (Together AI) | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Nebius B.V. | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Parasail | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Runware | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |
| Wafer | Open-weight models | Fallback host | Zero data retention; no training | Routed globally; no location commitment |

Notes on AI processing:

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

We will announce any new subprocessor, or any change in the purpose or data location of an existing one, by updating this page and notifying workspace owners by email at least [30] days before the change takes effect, except where a change is needed urgently to keep the service secure or available, in which case we will notify as soon as possible. Customers may object to a change as set out in the DPA.

To receive notifications, or for questions about this list, contact [privacy@uselumo.ai].
