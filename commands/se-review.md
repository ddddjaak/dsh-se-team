---
name: se-review
description: Run adversarial cross-department design review — four parallel fresh-context reviewers (HW, SW, Test, System lenses) examine an SE artifact for gaps, inconsistencies, and unstated assumptions. Use when any SE artifact is ready for review before distribution or a milestone gate.
whenToUse: An SE artifact (architecture, spec, requirements, test plan, test report, release package, or source code) needs a formal review before it is distributed or signed off.
---

# /se-review — Adversarial Design Review Entry

## Overview

This entry invokes `design-review` with the four-step process pre-committed. The default lens set is HW / SW / Test / System; the single-artifact review skills are selected when the artifact type is narrower.

## Artifact Routing

| Artifact under review | Skill |
|-----------------------|-------|
| Architecture or specification (four-lens) | `design-review` |
| Requirements document | `requirements-review` |
| Source code | `code-static-review` |
| Test plan | `test-plan-review` |
| Test report | `test-report-review` |
| Release package | `release-review` |

Confirm the artifact type before starting — routing a test plan to `design-review` wastes the whole cycle.

## Process

Invoke the `design-review` skill.

Work through the four steps:

1. **SCOPE** — confirm the artifact to review, review depth (quick scan / standard / exhaustive), focus areas, and which lenses to use
2. **LENS-REVIEW** — spawn four parallel adversarial reviewers (HW, SW, Test, System), each receiving ONLY the artifact with a department-specific "find issues" prompt. Reviewers do not see each other's output
3. **RECONCILE** — classify every finding using precedence: artifact misread → actionable → trade-off → noise. Surface cross-lens tensions (where two lenses disagree with each other) — these are the highest-value outputs
4. **REPORT** — produce a structured review report with actionable findings, trade-off findings, cross-lens tensions, and a resolution tracking table

Save the output to `docs/reviews/[project]-[artifact]-review-[YYYY-MM-DD].md`.

## Personas

The four lenses are backed by registrable personas — `system-architect`, `hw-domain-expert`, `fw-domain-expert`, `verification-engineer`, plus `compliance-reviewer` for a targeted standards/safety pass. Delegate through the `subagent` tool using the persona name; a persona may invoke skills but never another persona.

## Verification

- [ ] The artifact type was confirmed before routing
- [ ] Each lens received only the artifact — reviewers did not see each other's findings
- [ ] Every finding is classified by the precedence order, not by gut feel
- [ ] Cross-lens tensions are explicitly listed
- [ ] Every actionable finding has an owner and a due date
- [ ] The report records the artifact version reviewed

## After This Skill

Feed actionable findings back to the owning upstream skill (`architecture-design`, `spec-authoring`, …). Run `traceability-matrix` to confirm the fixes did not break coverage. If the review gates a release, continue to `release-review`.
