# SE Skills — Agent Personas

Pre-configured professional roles for targeted reviews across the SE workflow.

## Persona List

| Agent | Role | Perspective |
|-------|------|-------------|
| [system-architect](system-architect.md) | Senior System Architect | System-level consistency, constraint satisfaction, cross-domain integration, risk exposure |
| [hw-domain-expert](hw-domain-expert.md) | Hardware Domain Expert | Pin assignments, power domains, clock trees, signal integrity, electrical compliance |
| [fw-domain-expert](fw-domain-expert.md) | Firmware Domain Expert | Driver interfaces, RTOS integration, memory maps, boot flow, concurrency models |
| [verification-engineer](verification-engineer.md) | Verification Quality Engineer | Testability, test coverage, traceability completeness, verification methodology |
| [compliance-reviewer](compliance-reviewer.md) | Compliance & Safety Reviewer | Regulatory compliance, functional safety, security controls, privacy, industry standards |

## How Personas Work

Each persona is a standalone agent with:
- A domain-specific **Review Framework** (what to check and why)
- An **Output Format** (structured, comparable across personas)
- **Rules** (non-negotiable domain principles)
- **Composition** instructions (when and how to invoke)

## Composition Rules

1. **The user (or `design-review`'s fan-out) is the orchestrator.** Personas do not invoke other personas.
2. **Parallel fan-out is the canonical multi-persona pattern.** `/se-review` (via `design-review`) fans out to 4 personas simultaneously (HW, SW, Test, System lenses), then merges findings. `compliance-reviewer` is available as a separate targeted review.
3. **Personas can be invoked individually.** Ask `hw-domain-expert` to review pin assignments without involving the full panel.
4. **A persona may invoke skills** (`architecture-design`, `design-review`, etc.) when its review reveals a gap that requires upstream work.

## Typical Usage Patterns

### Full Design Review (via `/se-review`)

```
User invokes /se-review on an architecture document
    │
    ├── system-architect    → Consistency, constraints, integration
    ├── hw-domain-expert    → Pin assignments, power, clocks
    ├── fw-domain-expert    → Driver interfaces, boot flow, RTOS
    ├── verification-engineer → Testability, coverage
    └── compliance-reviewer → Standards, safety, security
            │
            └── Merge → categorized findings report
```

### Targeted Single-Lens Review

```
User: "Review these pin assignments against the datasheet"
→ Invoke hw-domain-expert directly
```

### Pre-Milestone Audit

```
User: "Check if we're ready for FCC and CE certification"
→ Invoke compliance-reviewer on requirements + architecture
```

## Relationship with Skills

Personas and skills serve different purposes:

| | Persona | Skill |
|---|---------|-------|
| **Purpose** | Domain-specific *review lens* | Structured *workflow process* |
| **Invocation** | User, or `design-review`'s fan-out | User, a `/se-*` entry, or a persona |
| **Example** | `hw-domain-expert` reviews pin assignments | `architecture-design` guides the architecture creation process |

Personas are the *who* — they bring domain expertise to review artifacts. Skills are the *how* — they define the process for creating artifacts. A complete SE workflow uses skills to produce artifacts and personas to review them.
