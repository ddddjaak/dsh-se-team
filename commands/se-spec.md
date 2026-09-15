---
name: se-spec
description: Author formal specifications — Software Outline Design (软件概要设计), HW-SW Interface Spec (软硬件接口规格), and Test Plan (测试方案) — from architecture and requirements. Use when architecture is confirmed and the next step is the Document phase.
whenToUse: The user has confirmed architecture plus requirements and needs system-level specifications written, or needs the SW/HW/algorithm detailed-design variants.
---

# /se-spec — Specification Authoring Entry

## Overview

This entry invokes `spec-authoring` with the five-step process pre-committed. It covers the three system-level artifacts; the SW/HW/algorithm detailed-design skills are separate and selected by artifact type.

## Prerequisites

Architecture design and system requirements must exist. If missing, invoke `architecture-design` and/or `requirements-decompose` first.

## Process

Invoke the `spec-authoring` skill.

Work through the five steps:

1. **SELECT** — confirm which specification(s) to generate: Software Outline Design, HW-SW Interface Spec, Test Plan, or all three
2. **GATHER** — collect and version-verify all input artifacts; surface misaligned versions
3. **GENERATE** — author specification content following the defined templates. Every claim must trace to a requirement ID or architecture interface ID. Enforce: numbers not adjectives, empty sections are errors, TBDs must have owners and due dates
4. **CROSS-CHECK** — verify internal consistency: all requirement references resolve, all interface definitions match architecture, no orphan content
5. **FINALIZE** — present for human review and sign-off

Save outputs to `docs/spec/[project]-[spec-type].md` after user confirmation.

## Detailed-Design Variants

| Artifact | Skill |
|----------|-------|
| Firmware module internals — function signatures, state machines, data structures | `software-detailed-design` |
| Schematic guidance, PCB rules, BOM, PDN, thermal | `hardware-detailed-design` |
| Signal processing, control loops, calibration, filters | `algorithm-design` |

## Verification

- [ ] Every specification section traces to a REQ-XXX or IF-XXX
- [ ] No empty sections — a blank section means "not designed", not "not applicable"
- [ ] Every quantitative claim is a number, not an adjective
- [ ] Every TBD carries an owner and a due date
- [ ] Input artifact versions are recorded and mutually consistent
- [ ] Each output was presented for human sign-off before being saved

## After This Skill

Gate the specifications with `design-review` (four-lens adversarial), then run `traceability-matrix` to check coverage across the chain. Type-specific reviews: `test-plan-review`, `requirements-review`, `code-static-review`, `test-report-review`, `release-review`.
