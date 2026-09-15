---
name: using-se-skills
description: SE技能发现和管道引导器：自动检测当前阶段并引导用户完成Define→Design→Document→Verify→Validate全流程。SE skill discovery and pipeline conductor — automatically detects the current SE phase and guides the user through the full Define-Design-Document-Verify-Validate workflow chain. Use when the user says 我不知道用什么技能, 该用哪个技能, which skill should I use, what comes next, or when starting an SE session without knowing which phase to begin. This is the meta-skill that governs how all other SE skills are discovered and chained.
---

# Using SE Skills

## Overview

SE Skills is a collection of workflow skills for chip vendor System Engineers (Application Architects), organized by the SE workflow phase. Each skill encodes a specific process that senior SEs follow — from raw requirements decomposition through architecture design, formal specification authoring, cross-department review, and traceability validation.

This meta-skill helps you discover and apply the right skill for your current SE task.

## When to Use

- Starting a new chip application project and unsure which skill to apply first
- You know the SE workflow exists but don't know which phase you're in
- A task spans multiple SE phases and you need to know the correct sequence
- A colleague asks "which SE skill should I use for this?"
- You want a quick reference for the full SE skill lifecycle

**When NOT to use:**

- You already know exactly which skill to invoke (just invoke it directly)
- The task is not SE-related (e.g., pure software implementation, hardware design, mechanical engineering)

## Pipeline Conduction (Automatic Phase Detection)

**This is the conductor.** When invoked (either explicitly or via AGENTS.md Pipeline Mode), you do not just discover one skill — you guide the user through the entire SE workflow, one phase at a time. After each skill completes, you return here to present the next logical step.

### Phase Detection Protocol

Before responding, scan `docs/` with Glob (`docs/*/`). The presence of artifact directories determines the current phase:

| Artifacts Present | Phase | Status |
|-------------------|-------|--------|
| (none) | **Define** | Start here |
| `docs/requirements/` | **Design** | Requirements ready, need architecture |
| `docs/architecture/` | **Document** | Architecture ready, need specs |
| `docs/spec/` | **Verify** | Specs ready, need review |
| `docs/reviews/` | **Validate** | Reviews done, need cross-check |

### Option Generation by Phase

**Define Phase** (no `docs/requirements/`):
```
Your project is at the starting point. The first step:

1. Requirements decomposition — transform PRD/datasheet/standards into structured, traceable requirements (requirements-decompose)
2. Skip requirements — I already have structured requirements (proceed to Design phase)
3. Something else — tell me what you need
```

**Design Phase** (has `docs/requirements/`, no `docs/architecture/`):
```
Requirements are ready. Next: architecture design. Which level?

1. System-level architecture — module decomposition, interfaces, constraints, trade-offs (architecture-design)
2. Software/firmware architecture — RTOS threads, memory budget, IPC design (software-architecture-design)
3. Hardware architecture — pin assignments, voltage domains, PCB constraints (hardware-architecture-design)
4. Something else
```

**Document Phase** (has `docs/architecture/`, no `docs/spec/`):
```
Architecture is defined. Next: formal specification. Which artifact?

1. System-level specifications — SOD, HW-SW IF Spec, Test Plan (spec-authoring)
2. Software detailed design — function signatures, state machines, error handling (software-detailed-design)
3. Hardware detailed design — schematic guidance, PCB rules, PDN design (hardware-detailed-design)
4. Algorithm detailed design — signal processing, control loops, filter design (algorithm-design)
5. Something else
```

**Verify Phase** (has `docs/spec/`):
```
Specifications are ready for review. Which artifact?

1. Cross-department adversarial review — HW/SW/Test/System four-lens (design-review)
2. Requirements document review — checklist-based completeness (requirements-review)
3. Source code static analysis — coding standards compliance (code-static-review)
4. Something else
```

**Verify Phase — Specific Artifacts** (detect by filename):
```
If docs/spec/ contains test-plan:
→ Also offer: Test plan review (test-plan-review)

If docs/reviews/ contains test-reports:
→ Also offer: Test report review (test-report-review)

If preparing for release:
→ Also offer: Release readiness review (release-review)
```

**Validate Phase** (after any Verify run):
```
Reviews are complete. Final step:

1. Traceability matrix — cross-artifact gap analysis, orphans, coverage (traceability-matrix)
2. Something else
```

### After traceability-matrix completes

```
Traceability validated. The SE workflow is complete.

1. Fix identified gaps — re-run the relevant upstream skill
2. Done — the artifact chain is verified
```

## Skill Discovery

When an SE task arrives, identify the phase and domain, then apply the corresponding skill:

```
SE Task arrives
    │
    ├── Raw requirements exist as scattered docs? ──→ requirements-decompose
    │   (PRD + Datasheet + Standards + Customer Spec)
    │
    ├── Have structured requirements, need architecture?
    │   ├── System-level module breakdown? ──→ architecture-design
    │   ├── Firmware/software architecture? ──→ software-architecture-design
    │   └── Hardware architecture? ──→ hardware-architecture-design
    │
    ├── Architecture confirmed, need detailed design?
    │   ├── System-level spec (SOD, HW-SW IF, Test Plan)? ──→ spec-authoring
    │   ├── Firmware module detailed design? ──→ software-detailed-design
    │   ├── Hardware detailed design? ──→ hardware-detailed-design
    │   └── Algorithm design? ──→ algorithm-design
    │
    ├── An artifact is ready for review?
    │   ├── Architecture or spec artifact (4-lens review)? ──→ design-review
    │   ├── Requirements document? ──→ requirements-review
    │   ├── Source code (static analysis)? ──→ code-static-review
    │   ├── Test plan document? ──→ test-plan-review
    │   ├── Test report document? ──→ test-report-review
    │   └── Software release package? ──→ release-review
    │
    ├── Need to verify cross-artifact integrity? ──→ traceability-matrix
    │   (Req → Design → Test gap analysis and coverage report)
    │
    └── Stakeholder requirements vague or ambiguous?
        → Surface ambiguity, ask one question at a time,
          propose GUESSes with reasoning (wrong guess is faster
          to correct than a blank answer). Then proceed to
          requirements-decompose once you reach ~95% confidence.
```

## The SE Workflow Chain

For a complete chip application project, the typical skill sequence is:

**Before starting:** If stakeholder requirements are vague or ambiguous (e.g., "system shall be robust," "must be high-performance"), surface the ambiguity first. Ask clarifying questions one at a time. Propose a GUESS — a quantified interpretation with reasoning — and ask the stakeholder to confirm or correct. Reacting to a wrong guess is faster than asking open-ended "what do you mean?" questions. Proceed to requirements decomposition only once you have ~95% confidence in what's being asked.

```
1. requirements-decompose     → Raw inputs → Structured system requirements
                                 with domain classification, ownership assignment,
                                 conflict resolution, and traceability IDs

2. architecture-design        → System-level module decomposition,
    (system)                     interface definitions, constraint analysis,
                                 trade-off decisions

3a. software-architecture-design → System arch → Firmware module breakdown,
                                    RTOS thread model, memory budget, SW interfaces

3b. hardware-architecture-design → System arch → Pin assignments, voltage domains,
                                    PCB constraints, component selection

4a. spec-authoring            → System arch + Requirements → SOD, HW-SW IF Spec, Test Plan

4b. software-detailed-design  → SW architecture → Function signatures, data structures,
                                    state machines, error handling per module

4c. hardware-detailed-design  → HW architecture → Schematic guidance, BOM constraints,
                                    PCB layout rules, PDN design

4d. algorithm-design          → Algorithm requirements → Signal processing, control loops,
                                    calibration routines, filter design

5a. design-review             → 4-lens adversarial review of architecture or spec artifacts

5b. requirements-review       → Checklist-based review of requirements documents

5c. code-static-review        → Static analysis of source code against coding standards

5d. test-plan-review          → Completeness and compliance review of test plans

5e. test-report-review        → Review of test reports for correctness and traceability

5f. release-review            → Release readiness review (binaries, notes, test reports)

6. traceability-matrix        → Cross-artifact validation:
                                 coverage gaps, orphans, action items
```

**Note:** `traceability-matrix` can (and should) be run after every artifact is produced, not just at the end. It is the quality check that runs across the chain.

**Not every task needs every skill.** A standalone architecture review only requires `design-review`. A test report check before release only requires `test-report-review`. A gap analysis before milestone only requires `traceability-matrix`. The chain is a map, not a mandatory route — use the skills that match your current task.

**Skill routing by `/se-*` entry skill:**

In dsh these are user-invocable **skills**, not a separate command plane: typing `/se-goal <goal>` in the composer injects the entry body as a user instruction. They are registered `modelInvocable: false`, so this conductor — not the entry table — is the model's own routing path. Honour an entry when the user names one; otherwise route by phase and artifact type as above.

| Entry skill | Routes to |
|---------|----------|
| `/se-goal` | Autonomous Goal Mode — the full chain, self-correcting, human only on escalation |
| `/se-requirements` | `requirements-decompose` |
| `/se-architecture` | `architecture-design` → `software-architecture-design` or `hardware-architecture-design` (based on domain) |
| `/se-spec` | `spec-authoring` → `software-detailed-design`, `hardware-detailed-design`, or `algorithm-design` (based on artifact type) |
| `/se-review` | `design-review`, `requirements-review`, `code-static-review`, `test-plan-review`, `test-report-review`, or `release-review` (based on artifact type) |
| `/se-traceability` | `traceability-matrix` |

## Core Operating Behaviors

These behaviors apply across all SE skills. They are non-negotiable.

### 1. Every Claim Traces to Something

Every design element, specification section, and test case must reference a requirement ID, architecture interface ID, or constraint ID. Content without a trace is opinion, not engineering. When you write a specification sentence, ask: "which requirement does this satisfy?"

### 2. Numbers, Not Adjectives

"Fast" is not a requirement. "≤ 500μs" is. "Robust" is not a requirement. "Survives 1000 transitions without state corruption" is. Replace every qualitative adjective with a quantified, testable statement. If you cannot quantify it, flag it as an ambiguity for the stakeholder.

### 3. Surface Conflicts Immediately

When two requirements contradict, two constraints cannot both be satisfied, or two departments have incompatible expectations, surface the conflict with a proposed resolution and reasoning. Silent resolution is the SE's most expensive mistake — it turns a conversation-cost problem into a rework-cost problem.

### 4. Ownership is Non-Negotiable

Every requirement must have an owner. Every action item must have an owner and a due date. Every TBD must have an owner and a due date. Items without owners are risks, not tasks.

### 5. Verification is Part of the Process

Every skill includes a verification checklist. A skill is not complete until the checklist is satisfied. "Looks right" is never sufficient — there must be explicit confirmation against each checklist item.

### 6. Version Discipline

Every artifact references its inputs with exact version numbers. When an input changes version, all dependent artifacts must be checked for consistency. Version skew between artifacts is a primary source of integration errors.

### 7. Surface Assumptions

When decomposing requirements or designing architecture, explicitly declare what you are assuming. Every unstated assumption is a potential rework trigger:

```
DESIGN ASSUMPTIONS:
1. SPI flash is quad-mode capable (Datasheet §3.2 implies but does not confirm)
2. Power sequencer is single-rail-sequencer (if multi-sequencer, adds N parallel state machines)
3. eSPI operates at 66MHz (per Standard §2; confirm HW team has not changed to 33MHz)
→ Correct me now, or I will proceed with these assumptions baked in.
```

Do not silently fill in gaps. The most expensive SE mistake is an assumption made in architecture that turns out false during integration. Surface uncertainty early — it's cheaper than rework.

### 8. Push Back When Warranted

You are not a yes-man. When a design decision, requirement, or constraint has clear problems:

- Call out the issue directly and specifically
- Explain the concrete negative impact — quantify it ("this adds ~300ms to boot time" not "this might be slower")
- Propose an alternative with reasoning
- If the stakeholder overrides after hearing the full picture, accept and document the decision with the override rationale

Syndophancy is a failure mode. "Of course!" and then implementing a bad architecture decision that costs months of rework helps no one. Honest, professional technical dissent is worth more than false agreement.

### 9. Maintain Scope Discipline

Only touch what you were asked to touch. Do not:

- Redesign modules outside the current change scope
- "Clean up" unrelated sections of the architecture document
- Expand the requirements decomposition to adjacent subsystems without being asked
- Resolve constraints that are not blocking the current task
- Add derived requirements for modules that are not in scope

Your job is surgical precision on the task at hand, not unsolicited renovation of the entire system design.

## Failure Modes to Avoid

1. Jumping to architecture design before requirements are decomposed and confirmed (architecture on unstable requirements is guessing)
2. Accepting vague stakeholder requirements without surfacing ambiguity — ask clarifying questions, propose GUESSes, resolve before proceeding
3. Defining interfaces without timing, error handling, and concurrency models ("I2C" is not an interface specification)
4. Generating specifications with empty sections (a blank section communicates "not designed," not "not applicable")
5. Accepting TBDs without owners and due dates (an unowned TBD is a project risk)
6. Reviewing your own artifact without fresh-context adversarial reviewers (you will see what you expect to see)
7. Running traceability only at the end (gaps found late cost more to fix; run after every artifact)
8. Being sycophantic — "of course!" to a bad architecture decision that will cost months of rework
9. Classifying requirements without inventorying all input sources (missing sources discovered later invalidate the classification)
10. Silently resolving ambiguity — when a requirement or constraint can be interpreted multiple ways, picking one interpretation without surfacing it for confirmation is guessing, not engineering. Surface the ambiguity, propose a GUESS, let the stakeholder confirm.

## Skill Rules

1. **Check prerequisites before invoking a skill.** Architecture design requires structured requirements. Spec authoring requires architecture. Design review requires a completed artifact. If prerequisites are missing, invoke the upstream skill inline.

2. **Skills are workflows, not suggestions.** Follow the steps in order. Do not skip verification steps. The process was designed to catch errors at the cheapest possible moment.

3. **Multiple skills chain naturally.** A complete SE workflow chains: `requirements-decompose` → `architecture-design` → `spec-authoring` → `design-review` → `traceability-matrix`. But skills can also be used independently — run just `design-review` on a colleague's artifact, or just `traceability-matrix` before a milestone review.

4. **When in doubt, start with requirements.** If requirements are not yet structured and traceable, begin with `requirements-decompose`. Everything downstream depends on it.

5. **Verification is part of the work.** Every skill includes a verification checklist. A skill is not complete until every checkbox is ticked. "Looks right" is never sufficient — there must be explicit confirmation against each checklist item.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I already know which skill to use — I don't need a discovery flow" | The discovery flow exists because the number of skills (16) exceeds what one person can keep in mind. Even the skill authors use the flow to confirm they are not missing a more specific skill for the task. |
| "The SE chain is too many steps for a small task" | The chain is a map, not a mandatory route. A small task may need only one skill. The chain shows the full landscape so you know what you are skipping — and why. |
| "I'll just use architecture-design for everything — it's the closest" | Architecture-design handles system-level module decomposition. It does not cover HW pin assignments, software data structures, algorithm math, or release readiness. Using the wrong skill means missing the right checklist — and the right verification gate. |
| "Meta-skills don't need to follow the same format as regular skills" | Meta-skills are discovered and invoked by agents the same way as any other skill. If the format diverges, the agent mis-handles it. Consistency across all skills is how the discovery machinery works reliably. |
| "The routing table is for humans — agents can figure it out from context" | Context is ambiguous. "Review the test plan" could mean `test-plan-review` (correct) or `design-review` (wrong artifact type). The routing table removes ambiguity — exact match, not probabilistic guess. |
| "I can skip verification — this is just routing" | Routing to the wrong skill is a silent error. If the meta-skill routes incorrectly, the entire downstream workflow wastes time on the wrong process. Verification catches misrouting before work begins. |

## Red Flags

- Three or more skills invoked without consulting the discovery flowchart (the agent is guessing, not routing)
- Routing to a skill that does not match the artifact type (e.g., routing a test plan to `design-review`)
- Skipping `requirements-decompose` and jumping directly to `architecture-design` with raw, unstructured inputs
- Accepting "we'll figure out the skill sequence later" — later means after work has started in the wrong skill
- Running a review skill without first confirming which artifact type is under review
- Invoking `traceability-matrix` without version-pinning all input artifacts first
- Using `architecture-design` for hardware-specific design when `hardware-architecture-design` exists
- Using `architecture-design` for software-specific design when `software-architecture-design` exists
- Accepting a stakeholder's vague requirements without surfacing ambiguity before proceeding to `requirements-decompose`
- Routing to a skill whose prerequisites are not satisfied (e.g., `spec-authoring` without system architecture)

## Verification

Before completing the SE skill discovery:

- [ ] The user's task has been classified into exactly one phase (Define / Design / Document / Verify / Validate)
- [ ] The correct skill for the task has been identified via the Skill Discovery flowchart
- [ ] The skill's prerequisites are satisfied (upstream artifacts exist with confirmed versions)
- [ ] If the task spans multiple phases, the correct skill chain has been identified and communicated
- [ ] If the artifact type is ambiguous, the user was asked to clarify before routing
- [ ] The routed skill matches the `/se-*` entry mapping table (if the user named an entry directly)
- [ ] No shortcuts taken — the user was not routed to a generic skill when a specialized one exists
- [ ] The "When NOT to use" section of the target skill was read and confirmed not to apply

## After This Skill (Pipeline Conductor)

`using-se-skills` is the pipeline conductor — it does not produce an artifact; it routes to the skill that does. After this meta-skill identifies the correct phase and skill:

| Phase Detected | Routes To |
|----------------|-----------|
| **Define** (no `docs/requirements/`) | `requirements-decompose` |
| **Design** (has requirements, no architecture) | `architecture-design` / `software-architecture-design` / `hardware-architecture-design` |
| **Document** (has architecture, no specs) | `spec-authoring` / `software-detailed-design` / `hardware-detailed-design` / `algorithm-design` |
| **Verify** (has specs) | `design-review` / `requirements-review` / `code-static-review` / `test-plan-review` / `test-report-review` / `release-review` |
| **Validate** (has reviews) | `traceability-matrix` |

After the routed skill completes, the conductor loops back: re-scan `docs/`, detect the new phase, and present the next options.


## Quick Reference

| Phase | Skill | One-Line Summary |
|-------|-------|-----------------|
| Define | `requirements-decompose` | Raw inputs → structured, traceable system requirements with ownership |
| Design | `architecture-design` | Requirements → system-level module decomposition, interfaces, constraints, trade-offs |
| Design | `software-architecture-design` | System arch → firmware module breakdown, RTOS model, memory budget, SW interfaces |
| Design | `hardware-architecture-design` | System arch → pin assignments, voltage domains, PCB constraints, component selection |
| Document | `spec-authoring` | System arch + Requirements → SOD, HW-SW IF Spec, Test Plan |
| Document | `software-detailed-design` | SW architecture → function signatures, data structures, state machines, error handling |
| Document | `hardware-detailed-design` | HW architecture → schematic guidance, BOM constraints, PCB layout rules, PDN |
| Document | `algorithm-design` | Algorithm requirements → signal processing, control loops, calibration, filter design |
| Verify | `design-review` | Four-lens (HW/SW/Test/System) adversarial review of architecture or spec artifacts |
| Verify | `requirements-review` | Checklist-based focused review of requirements documents |
| Verify | `code-static-review` | Static analysis of source code against company coding standards |
| Verify | `test-plan-review` | Completeness and compliance review of test plan documents |
| Verify | `test-report-review` | Review of test reports for correctness, completeness, and traceability |
| Verify | `release-review` | Release readiness review (binaries, release notes, version manifest, test reports) |
| Validate | `traceability-matrix` | Cross-artifact gap analysis: orphans, coverage gaps, action items |
