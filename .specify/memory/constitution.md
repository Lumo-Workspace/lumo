<!--
Sync Impact Report:
- Version change: 1.1.0 → 1.2.0 (UX prioritization and shadcn UI framework added)
- Modified principles: Added UX Prioritization as core principle
- Added sections: UX Prioritization principle, shadcn UI framework requirement
- Removed sections: N/A
- Templates requiring updates: ✅ plan-template.md, ✅ spec-template.md, ✅ tasks-template.md
- Follow-up TODOs: None - all templates updated successfully
-->

# Lumo AI Constitution

## Core Principles

### I. Document-First Architecture (NON-NEGOTIABLE)

Every feature MUST start as a structured document (Spec) that drives implementation.
Documents are the source of truth for requirements, not code comments or separate
documentation. All specifications must be executable and directly integrated with
GitHub workflows.

### II. GitHub Integration (NON-NEGOTIABLE)

Every Spec MUST automatically generate corresponding Issues, PRs, tests, and tracking.
Document changes MUST be traceable to GitHub commits and pull requests. All
modifications must include AI-generated records with source attribution and
confidence scores.

### III. Test-Driven Development (NON-NEGOTIABLE)

TDD is MANDATORY for all implementation work. The Red-Green-Refactor cycle MUST be
strictly enforced: Tests written → Tests fail → Implementation → Tests pass →
Refactor. No production code may be written without a failing test first. All
tests must be independent, fast, and executable in isolation.

### IV. AI Collaboration (NON-NEGOTIABLE)

AI assistants (Copilot, Cursor, Lumo AI) MUST be able to read and understand
document context for development assistance. All documents must be structured for
AI consumption with clear metadata, relationships, and executable instructions.

### V. Structured Specifications

All product requirements (PRD), technical designs, and project specifications MUST
follow the established Spec template format. Documents must include user scenarios,
acceptance criteria, and measurable success criteria. No implementation details
should leak into specification documents.

### VI. UX Prioritization (NON-NEGOTIABLE)

User experience MUST be prioritized in all design and implementation decisions.
Every feature MUST include comprehensive UX requirements with measurable success
criteria. User flows, interface design, accessibility, and usability MUST be
specified and validated before implementation begins. UX quality gates MUST be
enforced through dedicated checklists and testing protocols.

### VII. Automated Execution

Every specification MUST be capable of generating executable workflows. Document
changes MUST trigger appropriate GitHub actions, issue creation, and progress
tracking. Manual intervention should be minimized through intelligent automation.

## Development Standards

### Technology Stack Requirements

- Next.js 15+ with App Router for web interface
- TypeScript for type safety and developer experience
- shadcn/ui as the default UI framework for consistent, accessible components
- Tailwind CSS for styling (integrated with shadcn/ui)
- React Hook Form + Zod for form validation
- GitHub API integration for automated workflows

### Quality Gates

- All features must pass specification quality checklist before implementation
- UX requirements must be validated through dedicated UX quality checklists
- User stories must be independently testable and deliverable
- TDD compliance: Tests must be written and failing before any implementation
- All tests must pass before code review approval
- Test coverage must meet minimum standards (unit, integration, contract tests)
- UI components must use shadcn/ui framework for consistency and accessibility
- AI assistants must be able to understand and assist with each component
- GitHub integration must be validated for each new feature

## Development Workflow

### Specification Process

1. Create feature specification using `/speckit.specify` command
2. Validate specification quality using generated checklist
3. Validate UX requirements using UX quality checklist
4. Generate implementation plan using `/speckit.plan` command
5. Create task breakdown using `/speckit.tasks` command
6. Implement following user story priorities (P1 → P2 → P3) with strict TDD

### Test-Driven Development Process

1. **Red Phase**: Write failing test based on specification requirements
2. **Green Phase**: Write minimal code to make test pass
3. **Refactor Phase**: Improve code while keeping tests green
4. **Repeat**: Continue cycle for each new requirement
5. **Validation**: All tests must pass before moving to next user story

### Code Review Requirements

- All PRs must verify compliance with document-first principles
- UX requirements must be validated and tested
- TDD compliance must be verified: tests written before implementation
- All tests must be passing and provide adequate coverage
- UI components must follow shadcn/ui framework standards
- GitHub integration must be tested for new features
- AI assistance capabilities must be validated
- Specification updates must be linked to implementation changes

### Testing Standards

- TDD is mandatory: Red-Green-Refactor cycle must be followed
- Tests must be written before any production code
- User stories must be independently testable
- UX testing must validate user flows, accessibility, and usability
- Unit tests must cover all business logic
- Integration tests required for GitHub workflows and API endpoints
- Contract tests required for external service integrations
- UI component tests must validate shadcn/ui framework compliance
- AI context understanding must be validated
- Specification-to-implementation traceability must be verified
- Test coverage minimum: 80% for new code, 70% for modified code

## Governance

This constitution supersedes all other development practices. Amendments require:

1. Documentation of the change rationale
2. Impact assessment on existing specifications
3. Update to all dependent templates
4. Validation that AI assistants can understand the changes

All development work must comply with these principles. Complexity must be
justified against the core principle of document-driven development. Use the
established command templates for consistent specification and implementation
workflows.

**Version**: 1.2.0 | **Ratified**: 2025-01-27 | **Last Amended**: 2025-01-27
