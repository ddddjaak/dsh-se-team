---
name: se-traceability
description: Build and validate the traceability chain across all SE artifacts — Raw Requirements → System Reqs → Design Elements → Test Cases — identifying gaps, orphans, and over-coverage. Use after any artifact is produced, and before milestone reviews that need formal coverage evidence.
whenToUse: Coverage must be verified across the artifact chain, a milestone needs a formal traceability report, or a requirement change needs its impact scope assessed.
---

# /se-traceability — Traceability Validation Entry

## Overview

This entry invokes `traceability-matrix` with the five-step process pre-committed. It is the cross-cutting quality check — run it after every artifact, not only at the end.

## Process

Invoke the `traceability-matrix` skill.

Run this after completing any SE artifact to verify coverage, or before milestone reviews to produce formal traceability.

Work through the five steps:

1. **EXTRACT** — parse all reference IDs from all SE artifacts (requirements, architecture, specs, test plan) with version verification
2. **LINK** — build the full traceability graph: Raw Source → System Req → Architecture Element → Design Element → Test Case
3. **COVERAGE** — calculate coverage metrics for all traceability dimensions, in both directions: does every requirement have a design? does every design trace to a requirement?
4. **GAP-ANALYSIS** — identify orphans (nodes with no upstream or downstream trace), coverage gaps (requirements without tests), and over-coverage (tests without requirements)
5. **REPORT** — produce a traceability report with the full matrix, gap analysis, and action items (each with owner and due date)

Save the output to `docs/traceability/[project]-traceability-[YYYY-MM-DD].md`.

## Verification

- [ ] Every input artifact is version-pinned before extraction
- [ ] Coverage is reported in both directions — forward and backward
- [ ] Orphans, coverage gaps, and over-coverage are each reported separately
- [ ] Every action item has an owner and a due date
- [ ] Version skew between artifacts is reported as a CRITICAL finding, not a note

## After This Skill

Zero gaps → the SE chain is validated; report completion. Gaps found → route back to the owning upstream skill (`requirements-decompose`, `architecture-design`, `spec-authoring`, …) and re-run this skill after the fix.
