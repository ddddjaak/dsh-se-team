---
name: se-requirements
description: Start requirements decomposition — transform raw requirements (PRD, datasheet, standards, customer specs) into a structured, traceable system requirements document. Use when raw requirements exist as scattered inputs and the next step is the Define phase.
whenToUse: The user has raw SE inputs (PRD, chip datasheet, industry standards, customer spec) and needs them turned into structured, traceable requirements.
---

# /se-requirements — Requirements Decomposition Entry

## Overview

This entry invokes `requirements-decompose` with the six-step process pre-committed. Use it when the user wants to start the Define phase now rather than be guided into it.

## Process

Invoke the `requirements-decompose` skill.

Begin by inventorying all raw input sources — PRD, chip datasheet, industry standards, customer specifications, reference designs. Surface the inventory to the user and ask if anything is missing.

Then work through the six steps:

1. **COLLECT** — inventory all raw inputs with versions and dates
2. **CLASSIFY** — categorize every requirement by domain (HW/SW/System/Mechanical/Compliance) and type (Functional/Performance/Constraint/Interface/Safety)
3. **RESOLVE** — detect and surface conflicts, gaps, and ambiguities. For each, attach a GUESS with reasoning
4. **DERIVE** — generate testable system-level requirements from raw requirements
5. **ASSIGN** — assign every requirement an owner (who implements) and a verifier (who tests)
6. **VALIDATE** — present the complete structured requirements document for human sign-off

Save the output to `docs/requirements/[project]-system-requirements.md` after user confirmation.

## Verification

- [ ] Every raw input source is inventoried with version and date
- [ ] Every requirement carries a REQ-XXX ID, a domain, a type, an owner, and a verifier
- [ ] Every conflict and ambiguity is surfaced with a GUESS and reasoning — none silently resolved
- [ ] Every requirement is quantified (no adjectives standing in for numbers)
- [ ] Every TBD has an owner and a due date
- [ ] The document was presented for human sign-off before being saved

## After This Skill

Routes to `architecture-design` (system-level), then `software-architecture-design` / `hardware-architecture-design`. Run `requirements-review` to gate the document before design starts, and `traceability-matrix` after any artifact is produced.
