# AGENTS.md

This file provides guidance to AI agents working in this repository, and it is **also** the runtime behaviour definition of the SE pipeline: dsh injects it as workspace instruction context on the first request of every session. It is the single authority for how the SE workflow behaves. There is deliberately no second instruction file under the older agent filename — dsh recognises both names and would inject the same rules twice.

## Repository Overview

**dsh-se-skills** — a DeepSeek Harness (dsh) plugin: 16 structured workflow skills for chip vendor SEs (System Engineers / Application Architects), covering the full SE lifecycle in a **Define → Design → Document → Verify → Validate** chain. Two work modes: **Pipeline Mode** (guided step-by-step) and **Goal Mode** (fully autonomous). **dsh-only: no Claude Code / Codex / other platform assets are shipped.**

## dsh Integration

dsh is a skill-driven runtime. Skills reach agents through the `skill` tool and, for user-invocable skills, through the `/` composer menu.

| Directory | Count | Registered by | Edit takes effect |
|-----------|-------|---------------|-------------------|
| `skills/` | 16 | `@deepseek-ai/dsh-skill-filesystem` provider (providerName `se-skills`) | **live** — provider-served in place, no restart |
| `commands/` | 6 | the plugin, `lib/index.js` | after a dsh service restart |
| `agents/` | 5 | the plugin, `lib/index.js` | after a dsh service restart |
| `lib/tools/` | 3 tools | the plugin, `lib/index.js` → `ctx.tools.register()` | after a dsh service restart |
| `references/` | 21 | not a skill root — loaded on demand from `SKILL.md` "See Also" | live |

The plugin registers two invocation policies: `commands/` are **user-only** (`modelInvocable: false`) so the six `/se-*` entry points never bloat the model's catalog, and `agents/` personas are on **both** surfaces so they can be loaded directly or delegated to as a subagent role name.

`lib/tools/` holds the first-party tool families and registers them **natively**, not through MCP — dsh's tool registry is where MCP tools land anyway (`dsh-mcp-client` injects `tools`), so wrapping our own tools in an MCP subprocess would add a process and a schema dialect for nothing. `tools` is a *soft* dependency: it reaches the plugin through `ctx.inject(['tools'], …)`, never the `inject` array, so a profile that disables the `tools` row still gets the skills.

`mcp/` + `scripts/fetch-mcp.mjs` deliver the three third-party MCP servers (drawio / math / visio) locally: `mcp/servers.json` is the pinned recipe, `mcp/shim.mjs` is the zero-dependency launcher every patch row spawns, and `.mcp-vendor/` is the gitignored build output. See `docs/dsh-setup.md`.

### Core Rules

- If a task matches a skill, invoke it via the `skill` tool — do not implement the workflow from memory
- Follow the skill's steps in order; do not partially apply them
- Routing is the job of `using-se-skills`. Do not guess a skill by name when the phase is detectable

### Lifecycle Mapping

- DEFINE → `requirements-decompose`
- DESIGN → `architecture-design`, then `software-architecture-design` / `hardware-architecture-design`
- DOCUMENT → `spec-authoring`, then `software-detailed-design` / `hardware-detailed-design` / `algorithm-design`
- VERIFY → `design-review` (+ `requirements-review`, `code-static-review`, `test-plan-review`, `test-report-review`, `release-review`)
- VALIDATE → `traceability-matrix`

## SE Pipeline Mode — AUTOMATIC (Critical)

**This project contains 16 SE workflow skills organized in a Define → Design → Document → Verify → Validate chain.** When a user expresses SE work intent without naming a specific skill, **you MUST enter Pipeline Mode automatically**. Do NOT ask "which skill do you want to use?" or dump a list of 16 skill names. Instead, guide the user through the workflow by detecting their current phase and presenting logical next-step options.

### Trigger Keywords

**Pipeline Mode triggers** — the user wants guided, step-by-step help. Enter when the message matches any of these (but NOT a Goal Mode pattern):

| Chinese Phrase Patterns | English Phrase Patterns |
|------------------------|------------------------|
| 帮我做需求 / 帮我分解需求 / 梳理需求 | "help me with requirements" / "structure the requirements" |
| 帮我做架构 / 帮我设计架构 / 模块怎么划分 | "help me design the architecture" / "how should I structure" |
| 帮我写规格 / 帮我写概要设计 / 生成接口文档 | "help me write the spec" / "generate the specification" |
| 帮我审查 / 帮我review / 帮我检查一下 | "help me review" / "can you check this" |
| 帮我做追溯 / 帮我检查覆盖 / 查一下缺口 | "help me with traceability" / "check coverage" |
| 下一步做什么 / 该用哪个技能 / 我现在在哪个阶段 | "what should I do next" / "which phase am I in" |
| 我有PRD / 我有需求文档 / 这是数据手册 | "I have a PRD" / "here is the datasheet" |

**Goal Mode triggers** — the user wants fully autonomous execution:

| Chinese Phrase Patterns | English Phrase Patterns |
|------------------------|------------------------|
| 端到端做完 / 走完全流程 / 全部自动做 | "complete the full workflow" / "run through the entire pipeline" |
| 从需求到追溯全自动 / 一条龙 / 不用问我 | "end to end" / "fully autonomous" / "don't ask me" |
| 开干 / 直接开始 / go | "just do it" / "go ahead" / "run it all" |
| 自动完成...的SE流程 / 自动走完...全链路 | "auto-complete the SE process for" |

**Keyword-only triggers** (weaker signal — combine with context): a message containing at least TWO of 需求 / 架构 / 规格 / 审查 / 追溯 (or requirements / architecture / specification / review / traceability) without a specific skill name likely indicates SE intent.

### Phase Detection (scan docs/ before responding)

**Step 1 — Check directory structure.** Use Glob (`docs/*/`) to detect which artifact directories exist:

```
docs/requirements/   exists → Define phase at minimum (check content quality below)
docs/architecture/   exists → Design phase at minimum
docs/spec/           exists → Document phase at minimum
docs/reviews/        exists → Verify phase has run
docs/traceability/   exists → Validate phase has run
```

**Step 2 — Verify content quality (not just directory existence).** A directory being present does NOT mean the phase is complete:

| Directory | Quality Check | How to Verify |
|-----------|--------------|---------------|
| `docs/requirements/` | Contains .md files with REQ-XXX IDs | Grep for `REQ-` in the directory |
| `docs/architecture/` | Contains .md files with MOD-XXX or IF-XXX IDs | Grep for `MOD-\|IF-` in the directory |
| `docs/spec/` | Contains .md files with spec content (not placeholder) | Check file size > 500 bytes |
| `docs/reviews/` | Contains review report .md files with findings | Grep for `## Findings` or `## Review Report` |
| `docs/traceability/` | Contains traceability matrix .md file | Check for `docs/traceability/*.md` |

**Step 3 — Determine true phase status:**

| Condition | Phase Status | What to offer |
|-----------|-------------|---------------|
| No `docs/requirements/` dir | **Define — not started** | Only `requirements-decompose` |
| `docs/requirements/` exists but empty or no REQ-XXX IDs | **Define — in progress (incomplete)** | Resume `requirements-decompose` or start fresh |
| `docs/requirements/` has REQ-XXX IDs, no `docs/architecture/` | **Design — ready to start** | Architecture options (system / SW / HW) |
| `docs/architecture/` exists but no MOD-XXX/IF-XXX IDs | **Design — in progress (incomplete)** | Resume architecture skill or review existing |
| `docs/architecture/` has IDs, no `docs/spec/` | **Document — ready to start** | Spec authoring options |
| `docs/spec/` has content (files > 500B) | **Verify — ready to start** | Review options matching the artifact type present |
| `docs/reviews/` has review reports | **Validate** | `traceability-matrix` |

### Option Presentation Format

Present exactly 2-4 numbered options. Each option includes the number, what it produces (the outcome — that is what the user cares about), and the skill name in parentheses for traceability.

**Example for Design phase:**
```
Based on your requirements document, the next step is architecture design. Which level?

1. System-level module decomposition — modules, interfaces, constraints, trade-offs (architecture-design)
2. Software/firmware architecture — RTOS threads, memory budget, IPC, data flows (software-architecture-design)
3. Hardware architecture — pin assignments, voltage domains, PCB constraints (hardware-architecture-design)
4. Something else — tell me what you need
```

**Example for Verify phase (when docs/spec/ exists):**
```
Your specification is ready. What would you like to review?

1. Cross-department adversarial review — HW/SW/Test/System lenses (design-review)
2. Requirements document review — checklist-based completeness check (requirements-review)
3. Source code static analysis — coding standard compliance (code-static-review)
4. Something else — tell me what artifact you want reviewed
```

### Execution Protocol

1. **Detect** the phase:
   - First, check whether `docs/versions.json` exists — if so, use it as the authoritative phase state
   - Otherwise scan `docs/` directories (Glob: `docs/*/`) and verify content quality per the checks above
   - Distinguish "phase not started", "phase in progress (incomplete)", and "phase complete"
2. **Present** 2-4 numbered options in the format above — always include "Something else" last
3. **Execute** the chosen skill via the `skill` tool
4. **Record** — after the skill completes, update `docs/versions.json`: add the produced file path to the artifact's `files` array, set `status` to `produced`, update `pipeline.last_updated` and `pipeline.current_phase`, and check off the relevant `phase_checkpoints` entry
5. **Loop** — return to step 1: re-scan state, present the next logical options
6. **Stop** when the user says "done"/"stop", or when `traceability-matrix` has run and `phase_checkpoints.validate_complete` is true

### Cross-Session Resume

When starting a new session, check `docs/versions.json` first:

- Exists with `produced` artifacts → resume from the highest completed phase and present the next logical options
- Absent or has no produced artifacts → run full phase detection from the directory scan
- The user names a specific artifact → cross-reference against `versions.json` to determine the phase

### Never (Pipeline Anti-Patterns)

- ❌ Ask "which of these 16 skills do you want?" — overwhelming and unhelpful
- ❌ Say "use `requirements-decompose` for requirements" — the user does not need to know skill names
- ❌ Skip phase detection — always check `docs/` first
- ❌ Jump downstream when upstream artifacts are missing — if `docs/requirements/` is empty, do NOT offer architecture design
- ❌ Run multiple skills in parallel without asking — each phase gates on the previous one's output

## SE Autonomous Goal Mode — GOAL-DRIVEN (Critical)

**This is the fully autonomous mode.** When the user gives a clear end-goal — not "help me with X" but "complete the full SE workflow for X" — you run the entire Define → Design → Document → Verify → Validate chain autonomously. You do NOT ask per-phase questions. You self-correct when reviews fail. You only escalate when genuinely stuck.

### Trigger (enter Goal Mode instead of Pipeline Mode)

| Trigger | Example |
|---------|---------|
| The `/se-goal` entry skill | `/se-goal 完成温度传感器方案的SE全流程` |
| Explicit completion language | "端到端做完", "走完全流程", "自动完成...的SE", "complete the full SE workflow for", "run through the entire pipeline" |
| Clear end-state declared | "从PRD到追溯矩阵全部自动做", "from requirements to traceability, go" |
| User says "go" / "开干" after Pipeline Mode shows the first option | "直接开始，不用问我" |

**If uncertain whether the user wants Pipeline Mode or Goal Mode, default to Pipeline Mode (ask).** Only enter Goal Mode when the intent is unambiguous.

### Goal Execution Protocol (Plan → Act → Observe → Reflect)

```
GOAL RECEIVED
    │
    ▼
┌─────────────────────────────────────────────┐
│  PLAN: Parse goal, detect inputs, set path   │
│  · What are we building?                     │
│  · What inputs exist? (PRD, datasheet, etc.) │
│  · What's the target endpoint?               │
│  · Report the planned chain to user ONCE     │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│  ACT: Execute the next skill in chain        │
│  · Auto-select skill based on phase + domain │
│  · Run skill to completion                   │
│  · Record output in versions.json            │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│  OBSERVE: Run verification checklist         │
│  · Every skill has a verification section    │
│  · Check every checkbox with evidence        │
│  · Record pass/fail per checklist item       │
└────────────────────┬────────────────────────┘
                     ▼
              ┌──────┴──────┐
              │             │
           ALL PASS     SOME FAIL
              │             │
              ▼             ▼
    ┌─────────────┐  ┌──────────────────┐
    │ Next Phase  │  │ REFLECT: Fix      │
    │ (continue)  │  │ · Identify root   │
    └─────────────┘  │   cause           │
                     │ · Retry same      │
                     │   skill (max 3)   │
                     │ · If 3 failures:  │
                     │   ESCALATE        │
                     └────────┬─────────┘
                              │
                     ┌────────┴─────────┐
                     │                  │
                  FIXABLE          GENUINELY STUCK
                     │                  │
                     ▼                  ▼
               Retry skill        ESCALATE to user
               (go to ACT)        with specific
                                  blocker + options
```

### Auto-Skill Selection Rules

When in Goal Mode, do NOT present options. Select automatically:

| Phase | Condition | Auto-Selected Skill |
|-------|-----------|-------------------|
| **Define** | Always | `requirements-decompose` |
| **Design** | No prior architecture | `architecture-design` (system-level first) |
| **Design** | System arch exists, user mentioned HW | `hardware-architecture-design` |
| **Design** | System arch exists, user mentioned SW/firmware | `software-architecture-design` |
| **Document** | System arch exists | `spec-authoring` |
| **Document** | SW arch exists | `software-detailed-design` |
| **Document** | HW arch exists | `hardware-detailed-design` |
| **Document** | Algorithm requirements present | `algorithm-design` |
| **Verify** | Spec documents exist | `design-review` (four-lens adversarial) |
| **Verify** | Requirements doc only | `requirements-review` |
| **Verify** | Source code exists | `code-static-review` |
| **Verify** | Test plan doc exists | `test-plan-review` |
| **Verify** | Test report exists | `test-report-review` |
| **Verify** | Release package exists | `release-review` |
| **Validate** | Reviews exist | `traceability-matrix` |

**Domain inference from the goal statement:**
- "温度传感器" / "power management" / "motor control" → system-level (`architecture-design`)
- "固件" / "firmware" / "RTOS" / "驱动" → SW path (`software-architecture-design`)
- "PCB" / "原理图" / "schematic" / "layout" → HW path (`hardware-architecture-design`)

### Self-Correction Protocol

When a verification checklist fails:

1. **Identify** which checklist items failed
2. **Classify** the failure:
   - **Missing content** → re-run the same skill with an explicit instruction to address the gap
   - **Quality issue** (output exists but misses quantified metrics) → re-run with tighter constraints
   - **Traceability gap** (missing REQ/MOD/IF/TC IDs) → re-run with an explicit tracing instruction
   - **Ambiguity** (the requirement or constraint is genuinely ambiguous) → ESCALATE, do not guess
3. **Retry** the skill (max 3 attempts per phase), passing the specific failure items as context
4. **If 3 retries are exhausted**: ESCALATE with what was attempted, which checklist items still fail, and recommended options

### Stop Conditions

| Condition | Action |
|-----------|--------|
| `traceability-matrix` passes all checks AND finds zero gaps | **SUCCESS** — report completion with an artifact summary |
| The same phase fails 3 consecutive retries | **ESCALATE** — present the specific blocker and options |
| Total skill executions exceed 20 | **STOP** — report progress so far, ask whether to continue |
| The user interrupts with "stop" / "pause" / "wait" | **PAUSE** — report current phase, completed artifacts, next steps |
| Contradictory requirements or constraints detected | **ESCALATE** — surface the contradiction with the specific REQ-XXX IDs |

### Progress Reporting (Goal Mode)

After each phase completes successfully, report ONE concise status line:

```
✅ Define  complete — 23 requirements (REQ-001 ~ REQ-023), 3 domains
✅ Design  complete — 5 modules (MOD-01 ~ MOD-05), 12 interfaces
✅ Document complete — SOD v1.0, HW-SW IF Spec v1.0, Test Plan v1.0
⏳ Verify  in progress — running design-review (attempt 1)…
```

Do NOT ask "ready to proceed?" between phases in Goal Mode. Just report and continue.

### Goal Mode vs Pipeline Mode

| Dimension | Pipeline Mode | Goal Mode |
|-----------|--------------|-----------|
| Trigger | Any SE-related request | Explicit completion intent |
| Phase transitions | User picks from options | Auto-selected by rules |
| Verification failures | Reported to user | Auto-retried (max 3x) |
| User interaction | Every phase | Only on escalation or completion |
| Stop | User says "done" | Goal achieved or stuck |

**Note on durable continuation:** dsh also ships a host-level `/goal` command and a persisted goal domain that keeps re-driving a task across rounds. The two are independent — `/se-goal` carries the SE chain; the host `/goal` keeps the session running. For a long unattended SE run, the user may arm both.

## Skills by Phase

| Phase | Skill | Domain | Description |
|-------|-------|--------|-------------|
| **Define** | `requirements-decompose` | System | Raw inputs → structured, traceable system requirements with ownership |
| **Design** | `architecture-design` | System | Requirements → module decomposition, interfaces, constraints, trade-offs |
| **Design** | `software-architecture-design` | SW | System arch → firmware thread model, IPC design, memory budget, data flows |
| **Design** | `hardware-architecture-design` | HW | System arch → pin assignments, voltage domains, PCB constraints, component selection |
| **Document** | `spec-authoring` | System | Architecture + Requirements → SOD, HW-SW IF Spec, Test Plan |
| **Document** | `software-detailed-design` | SW | SW arch → function signatures, data structures, state machines, error handling |
| **Document** | `hardware-detailed-design` | HW | HW arch → schematic guidance, PCB rules, PDN design, thermal analysis |
| **Document** | `algorithm-design` | Algorithm | Algorithm reqs → signal processing, control loops, calibration, filter design |
| **Verify** | `design-review` | System | Four-lens (HW/SW/Test/System) adversarial review of architecture or spec artifacts |
| **Verify** | `requirements-review` | Requirements | Checklist-based review of requirements documents for completeness and traceability |
| **Verify** | `code-static-review` | SW | Static analysis of source code against company coding standards |
| **Verify** | `test-plan-review` | Test | Completeness and compliance review of test plan documents |
| **Verify** | `test-report-review` | Test | Review of test reports for correctness, completeness, and traceability |
| **Verify** | `release-review` | Release | Release readiness review (binaries, release notes, version manifest, test reports) |
| **Validate** | `traceability-matrix` | Cross-cutting | Cross-artifact gap analysis: orphans, coverage gaps, action items |

The meta-skill `using-se-skills` routes to the correct skill based on artifact type and phase. Skills chain naturally: Define → Design → Document → Verify → Validate. Each skill can also be used independently.

### /se-* Entry Skills

These are **user-invocable only** — the user types them in the composer, dsh injects the entry body as a user instruction. They are shortcuts to a skill whose process is already pre-committed; the model's own routing goes through `using-se-skills`.

| Entry | Routes to |
|-------|----------|
| `/se-goal` | **Autonomous Goal Mode** — full chain, auto-correcting, human only on escalation |
| `/se-requirements` | `requirements-decompose` |
| `/se-architecture` | `architecture-design` → `software-architecture-design` / `hardware-architecture-design` |
| `/se-spec` | `spec-authoring` → `software-detailed-design` / `hardware-detailed-design` / `algorithm-design` |
| `/se-review` | `design-review`, `requirements-review`, `code-static-review`, `test-plan-review`, `test-report-review`, `release-review` |
| `/se-traceability` | `traceability-matrix` |

### Review Personas

`agents/` registers five review lenses: `system-architect`, `hw-domain-expert`, `fw-domain-expert`, `verification-engineer`, `compliance-reviewer`. Delegate through the `subagent` tool using the persona name as the role. A persona may invoke skills but never another persona — orchestration belongs to the user or to `design-review`'s fan-out.

## Anti-Hallucination Design

Every skill incorporates these mechanisms:

| Mechanism | How it manifests |
|-----------|-----------------|
| **Input gates** | Step 1 of every skill verifies input artifacts exist with exact versions before proceeding |
| **Requirement traceability** | Every claim, function, pin, and constraint must cite a requirement ID (REQ-XXX), interface ID (IF-XXX), or constraint ID (CON-XXX) |
| **Quantified metrics** | "≤ 500μs" not "fast"; "≤ 2W" not "low power"; T_j = T_ambient + P × θ_JA must be calculated, not estimated |
| **Stop-and-ask gates** | "If uncertain, surface and stop — do NOT guess" at every critical decision point |
| **Context boundaries** | Each skill declares what it reads and does NOT read (e.g., software-detailed-design reads ONLY the software architecture) |
| **TBD management** | Every TBD must have an owner and due date; naked TBDs are a verification failure |
| **Version discipline** | Every artifact references its inputs with exact version numbers; mismatches are surfaced as CRITICAL findings |
| **Checkpoint verification** | Every skill ends with a verification checklist; the skill is not complete until every item is ticked with evidence |

## Contributing to This Repository

### Adding or Modifying Skills

1. `skills/<kebab-case-name>/SKILL.md` — the directory name must equal the frontmatter `name`
2. Frontmatter: required `name` (kebab-case) and `description`; optional `whenToUse`
   - Description format: Chinese trigger phrase first, then English, then trigger conditions, then explicit NOT clauses to disambiguate from similar skills
3. Required sections: Overview, When to Use, Process, Common Rationalizations, Red Flags, Verification, **After This Skill**
4. Keep `SKILL.md` under 500 lines — progressive disclosure into `references/`
5. Cross-reference other skills by their directory name
6. Update the `using-se-skills` Quick Reference table when adding or removing skills

### Adding an Entry Skill or a Persona

- Entry skills go in `commands/<se-name>.md` with `name` + `description` frontmatter — keep them short: they select a skill and pre-commit its process
- Personas go in `agents/<role-name>.md` with the anatomy Review Framework → Output Format → Rules → Composition
- Both are registered by `lib/index.js` and need a **dsh service restart** to take effect

### Validation

```bash
npm run validate          # errors + warnings
npm run validate -- --strict   # CI: warnings fail too
npm run smoke             # functional: really runs apply() and all three tools
npm run verify            # both of the above
```

The validator checks manifest wiring, every skill's frontmatter and section anatomy, name collisions, whether `using-se-skills` still reflects the catalog, whether no multi-platform asset has crept back in, the MCP manifest against the patch rows, and every native tool definition against the registry's hard requirements. It parses `cordis.patch.yml` through a dsh profile's YAML parser when one is reachable, and compiles every `!!js` expression without evaluating it.

`npm run smoke` is the one that proves the plugin *runs*: it stubs the `skills` and `tools` services, calls `apply()`, and invokes all three tools on a realistic flash/power/latency budget, validating every return value against the tool's own `output.schema`. It also carries negative controls, so a checker that has silently stopped checking fails the run instead of passing it.

dsh enforces the tool-definition rules at **runtime** only (at `register()` and at call time). `scripts/dsh-tool-rules.mjs` replicates them locally so these never need a live dsh to catch; it is a replica, not an equivalence — `docs/dsh-setup.md` → 「工具定义规则」 records the authoritative source and how to re-align after a dsh upgrade.

### Conventions

- Every skill lives in `skills/<name>/SKILL.md`; every skill's output is a document saved to `docs/<type>/`
- Skills reference each other by name (`requirements-decompose`, `architecture-design`, …)
- `lib/index.js` must stay **dependency-free** (node: builtins only). The plugin is installed with `dsh plugin add link:<dir>`, so node resolves `@deepseek-ai/*` against this repo's realpath and would fail at load time. Unless the package is published to a registry, no static import of a dsh package is allowed there
- A first-party tool goes in `lib/tools/` and registers through `ctx.tools.register()` — **not** an MCP server. Its `output` must be `{ schema, render }`, its `output.schema` must stay inside dsh's JSON Schema subset (no `$ref`/`minimum`/`pattern`; `type` as a single string; `oneOf` without `properties` siblings), and its `execute()` return value must match that schema key for key. Every returned number carries a `source` or the tool reports it as unprovenanced
- Numbers in an SE artifact are quantified and unit-bearing (`≤ 500 us`, `≤ 2 W`). The budget tools normalize units rather than trusting the caller's arithmetic: byte vs bit and decimal vs binary are decided by how the unit is *written*, and an ambiguous spelling is an error, never a guess
- `cordis.patch.yml` config keys must come from the shipped schemas — unknown keys are rejected at activation, so document intent in comments rather than inventing fields
- Always: every claim traces to a requirement/interface/constraint ID; quantify instead of using adjectives; follow the skill anatomy
- Never: add skills that are vague advice instead of actionable processes; duplicate content between skills instead of referencing; proceed downstream before upstream artifacts are confirmed

### Read Order

1. `README.md` — what this is and how to install it
2. `AGENTS.md` — this file: runtime behaviour (Pipeline Mode + Goal Mode + phase detection) and repo conventions
3. `skills/using-se-skills/SKILL.md` — the pipeline conductor
4. `agents/README.md` — how the review personas work
5. `CONTRIBUTING.md` — contribution workflow
