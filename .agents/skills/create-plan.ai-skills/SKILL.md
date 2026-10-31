---
name: create-plan.ai-skills
description: Use when creating, updating, or maintaining Agent Skills for the plan.ai chat repository (chat.plan.ai). Enforces TDD-for-documentation (Jimi) and machine-specific versioning (Omen) with .PROMPT.md and council-linkage.
---

# Create Plan.ai Skills

## Overview

This skill implements "Test-Driven Development for Documentation" for the plan.ai chat repository. Every skill must be high-signal, searchable (CSO optimized), and verified against a failing baseline before deployment.

## Required Structure

Each skill lives in `.agents/skills/<skill-name>/` and must contain:

1. `SKILL.md`: The machine-readable instructions.
2. `.PROMPT.md`: Dev-only context, versioning, and changelog.
3. `council-feedback/`: (Optional) Feedback from multiple models during creation.

## The Iron Law: RED-GREEN-REFACTOR

**NO SKILL WITHOUT A FAILING TEST FIRST.**

1. **RED**: Run a subagent on a task relevant to the skill WITHOUT the skill. Document the failure and the rationalizations used.
2. **GREEN**: Write the minimal `SKILL.md` to address those specific failures. Verify the subagent now succeeds.
3. **REFACTOR**: Close loopholes. If the agent finds a new way to fail, add explicit counters.

## Continuous Skill Updates & Proactive Creation (Self-Healing Requirement)

To prevent skills from going stale and to capture evolving architecture, this rule **MUST** be enforced by all agents:

1. **Trigger on Modification**: If you modify core architectural files (e.g., `web/package.json` (Parcel), `web/src/chat/main.ts`, `web/src/chat/api.ts`, `web/src/chat/style.css`, `server/src/api.rs`), evaluating the corresponding skill's relevance is **mandatory**. If outdated, use `mcporter call context7.query-docs` to fetch the latest paradigms and update the `.agents/skills/<skill>/SKILL.md` immediately.
2. **Trigger on Discovery (Proactive)**: If you are asked to implement a feature or debug an issue and you discover a complex, project-specific pattern that is NOT yet documented in this repository's agent skills, you **must proactively create a new skill** covering it.
3. **Execution**: Generate both `.PROMPT.md` and `SKILL.md` utilizing TDD-for-documentation. Ensure all new skills follow the CSO "Use when..." standard.

## .PROMPT.md Requirements

Include YAML frontmatter:

```yaml
version: 0.1.0
status: dev-only
machine: local-macos
```

Keep an append-only changelog at the bottom.

## CSO Optimization (Search)

- **Description**: MUST start with "Use when..." and describe _triggering conditions_, NOT the workflow.
- **Workflow Summary Trap**: Never summarize the process in the description. Claude might follow the description blindly and skip the full skill content.
- **Keywords**: Include technical terms like `Tailwind v4`, `Vue`, `Parcel`, `SPA`, `EventSource`, `axum`.

## Multi-Model Council

When improving complex skills:

1. Get feedback from at least 2 other models (e.g., Opus, GPT-4o).
2. Save to `council-feedback/<model>.md`.
3. Synthesize improvements using the current model as master.
