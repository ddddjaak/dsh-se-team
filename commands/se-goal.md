---
name: se-goal
description: Autonomous goal-driven SE workflow — give a clear end-goal and the agent runs the full Define → Design → Document → Verify → Validate chain without per-phase prompts. Self-corrects on review failures, escalates only when genuinely stuck. Use when the user wants the whole SE pipeline executed end to end rather than guided step by step.
whenToUse: The user states a completion goal ("端到端做完", "走完全流程", "complete the full SE workflow for X") instead of asking for help with one phase.
---

# /se-goal — Autonomous SE Workflow

## Overview

This is **Autonomous Goal Mode**. The user gives a clear end-goal, and you run the complete SE workflow chain autonomously — requirements decomposition → architecture design → specification authoring → adversarial review → traceability validation. You self-correct when reviews find issues. You ask the user only when genuinely stuck.

This is the "give a goal, go to work" pattern. Not "help me step by step" — "do it all."

## Invocation

```
/se-goal <your goal>
```

Everything after `/se-goal` is the objective. Examples:

```
/se-goal 完成温度传感器方案的完整SE流程，PRD在docs/inputs/prd.md
/se-goal from this datasheet to a reviewed spec and traceability matrix
/se-goal 端到端：从需求分解走到追溯矩阵，芯片是PMIC
/se-goal complete the full SE workflow for the motor controller, inputs are in docs/inputs/
```

If the objective is missing, ask for it once before starting — do not invent one.

## What Happens

Follow the Plan → Act → Observe → Reflect loop:

1. **PLAN** — parse the goal, scan for input artifacts (PRD, datasheet, standards, existing requirements), and report the planned chain to the user **once**
2. **ACT** — auto-select and execute skills in order: `requirements-decompose` → `architecture-design` (→ SW/HW variants) → `spec-authoring` (→ SW/HW/algorithm variants) → `design-review` → `traceability-matrix`. Record each artifact in `docs/versions.json`
3. **OBSERVE** — run each skill's verification checklist and record pass/fail per item
4. **REFLECT** — all pass → next phase. Some fail → classify the failure, fix, and retry the same skill (max 3 attempts). Genuinely stuck → escalate
5. **REPORT** — one concise status line per completed phase

Do NOT ask "ready to proceed?" between phases. Report and continue.

## Stop Conditions

- ✅ **SUCCESS** — `traceability-matrix` passes all checks with zero gaps; report completion with an artifact summary
- 🚨 **ESCALATE** — the same phase fails 3 consecutive retries; present the specific blocker and options
- 🚨 **ESCALATE** — contradictory requirements or constraints detected; surface them with the specific REQ-XXX IDs
- ⏱️ **BUDGET** — 20+ skill executions; report progress so far and ask whether to continue
- ⏸️ **PAUSE** — the user says "stop", "pause", or "wait"; report current phase, completed artifacts, and next steps

## Progress Format

```
✅ Define   complete — 23 requirements (REQ-001 ~ REQ-023), 3 domains
✅ Design   complete — 5 modules (MOD-01 ~ MOD-05), 12 interfaces
⏳ Document in progress — spec-authoring (attempt 1)…
```

## Verification

Before reporting completion:

- [ ] Every phase in the chain was executed or explicitly skipped with a reason
- [ ] Each executed skill's verification checklist was run with recorded evidence
- [ ] `docs/versions.json` reflects every produced artifact
- [ ] Any escalation names the specific blocker, not a general difficulty
- [ ] The final report states the artifact chain and the traceability verdict

## After This Skill

| Phase reached | Routes to |
|---------------|-----------|
| Define done | `architecture-design` |
| Design done | `spec-authoring` / `software-detailed-design` / `hardware-detailed-design` / `algorithm-design` |
| Document done | `design-review` |
| Verify done | `traceability-matrix` |
| Validate done | Report completion and stop |
