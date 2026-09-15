---
name: se-architecture
description: Start architecture design — decompose system requirements into modules, define every interface, analyze cross-cutting constraints, and document trade-off decisions. Use when structured requirements are confirmed and the next step is the Design phase.
whenToUse: The user has confirmed, structured requirements and needs system-level module decomposition, interface definitions, or architecture trade-off records.
---

# /se-architecture — Architecture Design Entry

## Overview

This entry invokes `architecture-design` with the five-step process pre-committed. It produces the system-level architecture; the SW and HW variants are invoked downstream when the domain is known.

## Prerequisites

Structured system requirements must exist. If missing or incomplete, invoke `requirements-decompose` first — architecture on unstable requirements is guessing.

## Process

Invoke the `architecture-design` skill.

Work through the five steps:

1. **DECOMPOSE** — break the system into modules with single responsibilities, natural boundaries, and clear dependencies
2. **INTERFACE** — define every module dependency precisely: data format, timing, concurrency model, error handling, power-state behavior
3. **CONSTRAINT** — extract all cross-cutting constraints from requirements, assign to affected modules, surface conflicts
4. **TRADE-OFF** — for every non-trivial decision, document alternatives considered, rationale (citing specific requirement IDs), and accepted downsides
5. **DOCUMENT** — produce the complete architecture design document with block diagram, module definitions, interface specs, constraint analysis, trade-off records, and risk register

Save the output to `docs/architecture/[project]-architecture-design.md` after user confirmation.

## Verification

- [ ] Every module has a single responsibility and a MOD-XXX ID
- [ ] Every interface has an IF-XXX ID plus data format, timing, error handling, concurrency, and power-state behavior — "I2C" alone is not an interface specification
- [ ] Every constraint traces to a requirement ID (REQ-XXX / CON-XXX)
- [ ] Every non-trivial decision lists alternatives, rationale, and accepted downsides — including rejected options
- [ ] Cross-module budgets (memory, timing, power) sum without overcommitment
- [ ] Orphan requirements (owned by no module) are surfaced, not dropped

## After This Skill

| Domain | Routes to |
|--------|-----------|
| Software / firmware | `software-architecture-design` |
| Hardware / board | `hardware-architecture-design` |
| Both or undecided | `spec-authoring` after the domain split |

Gate the result with `design-review`, then continue to `spec-authoring`.
