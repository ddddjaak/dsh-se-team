# Changelog

All notable changes to the SE Skills project will be documented in this file.

## [3.2.0] — 2026-09-15

**The plugin now ships its own tools, registered natively rather than as an MCP server.** `lib/tools/`
adds a unit-aware budget family that the Verify phase can call instead of asserting a budget is fine by
eye. dsh's tool registry is where MCP tools land anyway, so a first-party tool registers into the same
table through `ctx.tools.register()` — no subprocess, no JSON-RPC hop, no second schema dialect.

### Added

- `lib/tools/units.js` — the shared unit/dimension layer: canonical-unit table, alias normalization,
  quantity parsing (`"≤ 500 μs"`, `"2 W"`, `"12.5 MB/s"`, `"1.5GiB"`), same-dimension conversion, and a
  display-unit picker that chooses the largest unit keeping the value ≥ 1
- `lib/tools/budget.js` — three tools:
  - `se_budget_rollup` — sums allocations **by dimension**, never across them, and reports how many lines
    carried a provenance `source` and how many were written with a comparison prefix (`<= 500 us`, which
    understates a total)
  - `se_budget_check` — the Verify-phase gate: per-dimension PASS/FAIL with exact headroom, the dimensions
    that have allocations but **no ceiling at all**, and a note when a cap passes at ≥ 90% (no room for
    the next requirement)
  - `se_budget_bottleneck` — names the line a design change must move: the tightest ceiling, the single
    largest consumer inside it, and top consumers per dimension as a share of their cap
- `scripts/dsh-tool-rules.mjs` — a local replica of the registry's hard requirements (schema subset,
  `output.render`, reserved names, output-vs-schema validation). dsh enforces these at runtime only, so
  without a replica every mistake costs a live dsh session to find
- `scripts/smoke-tools.mjs` (`npm run smoke`) — stubs the `skills` and `tools` services, calls `apply()`,
  and runs all three tools over a realistic flash/power/latency budget, validating each return value
  against that tool's own `output.schema`. Carries negative controls, so a checker that has stopped
  checking fails the run
- `npm run verify` — `validate` then `smoke`
- Validator section 7: every tool definition checked against the registry rules; `npm run validate` now
  reports the tool-definition count

### Changed

- `tools` reaches the plugin through `ctx.inject(['tools'], …)`, **not** the `inject` array. Requiring it
  would mean a profile with the `tools` row disabled loses `commands/` and `agents/` too — turning a soft
  dependency into a hard one
- `tidy()` returns integers untouched. `toPrecision(6)` was turning a 4,306,624-byte total into
  4,306,620 — a partition table short by four bytes
- `unitFactor()` throws when no conversion factor exists instead of falling back to `1`
- The rollup's display unit is picked by asking the unit layer for it, not by re-parsing formatted text
  (`"...formatQuantity(x).split(' ')[1]"` was fragile and order-dependent)

### Findings worth recording

- **An alias that resolves to a dimension but not to a canonical name silently costs a factor of 10⁶.**
  `µs` was indexed to the `time` dimension while `canonicalUnit()` kept returning `µs` instead of `us`.
  The downstream factor lookup then read `units['µs']`, got `undefined`, and hit a
  `Number.isFinite(x) ? x : 1` fallback — so `500 µs` became `500 s` and the wrong number flowed all the
  way into a document. Two fixes: aliases always resolve to the canonical name, and the fallback is now a
  throw. A "safe default" of `1` is not safe when the correct answer is `1e-6`
- **Sharing one schema object across positions is legal; "circular" means ancestor repetition.** The first
  version of the rules replica marked any revisited node as circular, and reported the shared
  `SOURCE_SCHEMA` (used by both `items` and `caps`) as a defect. dsh's own implementation pushes a `leave`
  task and deletes from `seen`, i.e. it tracks an ancestor stack. The replica now does the same, and the
  smoke test locks both directions: shared is fine, genuinely circular is caught
- **Byte/bit and decimal/binary ambiguity is worth an error, not a guess.** `MB`/`MiB` are decided by
  spelling; rate units must spell the slash (`MB/s` bytes, `Mbps` bits); `MBps`-style aliases are refused
  because they differ from `Mbps` only by case, and a bare lowercase `b` is rejected outright. Deciding
  silently would be a factor-of-8 error in a flash budget

## [3.1.0] — 2026-09-15

**Third-party MCP servers are delivered locally instead of fetched at runtime.** Every MCP row now spawns
one launcher shim, which prefers a vendored local copy over the `npx` / `uvx` fallback. An installed
profile keeps working with no network access.

### Added

- `mcp/servers.json` — the single recipe for every third-party MCP server this package ships a row for:
  pinned version, license, entry point, fallback runner, and (for Python) the import used to prove the
  local copy actually loads. Version pins live here rather than in `cordis.patch.yml`, because an MCP
  server's tool vocabulary is part of this plugin's contract and must not drift between sessions
- `mcp/shim.mjs` — zero-dependency launcher shim. Resolves a server id to either the vendored copy or the
  declared fallback, and exits non-zero with a diagnostic when neither works (that one row is then
  disabled by `failOnStartupError: false`). Runs its child with `stdio: 'inherit'`, so it is a pass-through
  parent rather than a proxy — no per-message overhead. `--list` / `--print` make it a doctor
- `scripts/fetch-mcp.mjs` — pinned fetcher (`npm run fetch:mcp`), with `--only`, `--check`, `--clean`,
  `--dry-run`, `--python`. Writes a `.se-skills-vendor.json` stamp recording the interpreter a local copy
  was built from, so a mismatch is diagnosable instead of mysterious
- `npm run mcp:status` — prints what each MCP row would actually launch
- Validator section 6: manifest sanity (kebab ids, exact version pins, declared licenses), duplicate
  `serverName` detection, and cross-checks that every patch row names a server in the manifest and that
  every manifest entry is used by a row

### Changed

- **Track 3 rows spawn the shim, not `npx` / `uvx` directly.** `command` is now `process.execPath` — the
  same node that runs dsh, so it always exists — with one `!!js`-resolved `args` entry pointing at
  `mcp/shim.mjs` and one server id. The existence test that would otherwise be duplicated across
  `command` and every `args` entry now lives in one testable file
- **The `visio` row is disabled by default** (`disabled: true`, a real dsh entry option). It is also the
  one row that is not vendored: upstream (`visio-mcp` on PyPI) requires Python ≥3.14 *and* a licensed
  Microsoft Visio install driven over COM. The v2 row it replaces referenced a module (`visio_mcp_server`)
  that does not exist on PyPI at all — it was uninstallable and unauditable. Enable the row on a machine
  that has both prerequisites
- `package.json`: version `3.1.0`, `mcp` added to `files` (a registry install would otherwise drop it)
- `.gitignore`: `.mcp-vendor/` — it is build output, the recipe is in the manifest

### Findings worth recording

- **`pip install --target` cannot vendor pywin32, which is why Python servers get a venv.** On Windows
  `mcp<2` depends on pywin32, and pywin32 registers its DLL directory through `.pth` files — and `.pth`
  files are only processed for site directories the interpreter knows about, not for a `PYTHONPATH` entry.
  `--target` therefore reports success and then fails at import with `No module named 'pywintypes'`, deep
  inside the MCP SDK. A venv is a real site directory and additionally pins the interpreter, so the ABI
  cannot drift from what was installed
- **Existence is not correctness.** The first vendoring attempt passed an existence check and was still
  broken under both interpreters available here (the build one and the system one, for two different
  reasons). Hence the per-server `probe`: the shim imports the declared module with the local
  environment's own interpreter before trusting it, and falls back if that fails
- **`!!js` interpolates recursively.** The loader's `interpolate()` walks the whole config tree, so
  `command`, any `args` entry, `env`, and `cwd` can each be an expression

## [3.0.0] — 2026-09-15

**dsh-only release.** The package becomes a DeepSeek Harness (dsh) plugin and drops the Claude Code /
Codex multi-platform layer. The multi-platform version stays on `main`; this is a separate branch.

### Added

**dsh plugin surface:**

- `package.json` — declares `dsh.bundle.patch`, `type: module`, `main: lib/index.js`, and a
  `npm run validate` script, so the package loads as a dsh profile bundle
- `cordis.patch.yml` — three-track bundle patch:
  - Track 1: a `@deepseek-ai/dsh-skill-filesystem` provider (`providerName: se-skills`,
    `includeDefaultRoots: false`) that serves **only** this package's `skills/`, resolved through the
    profile's `node_modules` symlink via `!!js`, so skills are served in place and edits are live
  - Track 2: the `dsh-se-skills` plugin row
  - Track 3: the three MCP servers carried over from the multi-platform release, re-expressed as
    `@deepseek-ai/dsh-mcp-client` stdio rows (drawio / visio / math) with `failOnStartupError: false`
- `lib/index.js` — zero-dependency (node: builtins only) plugin entry registering:
  - `commands/` as **user-only** entry skills (`modelInvocable: false`)
  - `agents/` as review personas on both surfaces
  - Dependency-free by necessity: a `link:` install resolves `@deepseek-ai/*` against this repo's
    realpath, so a static import would fail at load time
- `commands/` — the 6 slash commands converted to dsh user-invocable skills (`se-goal`,
  `se-requirements`, `se-architecture`, `se-spec`, `se-review`, `se-traceability`). In dsh a
  user-invocable skill *is* the slash entry (`/name` injects the body), so no Claude Code command
  directory is needed. Bodies gained `name` frontmatter, and the Claude Code plugin namespace
  (`se-skills:<skill>`) was replaced with bare skill names
- `scripts/validate-dsh-plugin.mjs` — zero-dependency validator: manifest wiring, per-surface section
  anatomy, name collisions, `using-se-skills` staleness, multi-platform asset regression, and a real
  parse of the bundle patch (including compiling every `!!js` expression without evaluating it)
- `docs/dsh-setup.md` — install / update / uninstall / troubleshooting, plus why each track exists

### Changed

- **`AGENTS.md` is now the single instruction authority.** The Pipeline Mode and Goal Mode runtime
  rules that lived in `CLAUDE.md` are folded in. This matters for correctness, not tidiness:
  `dsh-agent-instructions` loads both `AGENTS.md` and `CLAUDE.md` from the project root, and only
  de-duplicates files whose content matches exactly — two divergent files would inject the same rules
  twice. Merged size 26 KB against the 65,536-byte injection budget
- `README.md` rewritten for dsh: install via `dsh plugin --profile web add link:<dir>`, `/se-*` entry
  table, and a project structure reflecting the new layout
- `CONTRIBUTING.md`: dsh framing, an entry-skill / persona contribution section, and the zero-dependency
  constraint on `lib/index.js`. Also fixed a pre-existing dangling sentence — the validation step
  introduced a check list with nothing after the colon
- `skills/using-se-skills/SKILL.md`: conductor reference points at `AGENTS.md`; the routing table is
  described as `/se-*` entry skills rather than slash commands
- `agents/README.md` and all 5 personas: "orchestration belongs to slash commands" reworded to the user
  or `design-review`'s fan-out
- `.github/ISSUE_TEMPLATE/bug-report.md`: environment fields now ask for the dsh version and OS
- `docs/README.md`: replaced a dangling link to the gitignored `v2-release-notes.md`
- `.gitignore`: dropped the `.claude/` and `docs/v2-release-notes.md` entries

### Removed

Multi-platform assets, all superseded by the dsh equivalents above:

- `CLAUDE.md` — content merged into `AGENTS.md`
- `.claude-plugin/` (`plugin.json`, `marketplace.json`)
- `.claude/commands/` (6 commands) — converted into `commands/` as dsh skills
- `.codex-plugin/plugin.json`
- `hooks/` (`hooks.json`, `hooks.codex.json`, `session-start.sh`, `session-start-windows.ps1`) — dsh
  injects `AGENTS.md` as workspace instruction context, so the meta-skill injection hook has no dsh role
- `.mcp.json` — the three servers now live in `cordis.patch.yml`

### Verified

- `npm run validate` → PASS, 0 errors, 0 warnings (27 skill files: 16 skills + 6 commands + 5 personas)
- `node --check lib/index.js` clean; `cordis.patch.yml` parses through a dsh profile's YAML parser with
  the `!!js` tag resolved, and every `!!js` expression compiles

## [Unreleased]

### Added
（暂无 — 下一个版本的变更将在此记录）

## [2.0.0] — 2026-06-26

### Added

**MCP Server Integration (3 new servers via `.mcp.json`):**

- **draw.io MCP (`@drawio/mcp`)** — official jgraph MCP server for architecture diagram generation
  - Supports Mermaid.js, XML, and CSV input formats
  - Generates flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, and more
  - Auto-installs via `npx -y @drawio/mcp` on first use — no manual setup required
  - Resolved after two iterations: `drawio-mcp` v1.6.0 (Sujimoshi) crashed on Node.js 24 due to JSDOM `navigator` getter incompatibility; `diagram-master` was limited to flowchart type only; `@drawio/mcp` is the definitive solution

- **Visio MCP (`office-visio-mcp-server`)** — professional `.vsdx` diagram generation for user manuals
  - Supports: create/open `.vsdx` files, add shapes (rectangle, circle, diamond, etc.), connect shapes with dynamic/straight/curved connectors, add text to shapes, list shapes, export images
  - Portable entry point: `python -c "from visio_mcp_server.visio_server import main; main()"` — no hardcoded paths
  - Requires: Windows + Microsoft Visio installed + `pip install office-visio-mcp-server`
  - Use case: formal documentation deliverables (user manuals, datasheets) requiring Visio-format diagrams

- **Engineering Math MCP (`gnomon-mcp`)** — calculation engine for MCU datasheet work
  - `calc()`: Python math expressions (sqrt, sin, cos, log, pi, e, statistics functions)
  - `calc_convert()`: unit conversion via Pint (meter↔foot, Celsius↔Fahrenheit, voltage/current/power units)
  - `calendar()`: date math, business day calculations
  - `now()`: current date/time in multiple formats
  - Windows compatible: `mcp-mathematics` failed on Windows (`resource` module Unix-only); `gnomon-mcp` works cross-platform
  - Use cases: SNR calculation, power budget (P = V × I), thermal analysis (T_j = T_ambient + P × θ_JA), timing calculations, baud rate error, pull-up resistor sizing

**SessionStart Hook System:**

- `hooks/hooks.json`: SessionStart hook registration — mirrors ae-skills pattern
  - Triggers on every new Claude Code session (not `/reload-plugins`)
  - Executes `bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh`
- `hooks/session-start.sh`: injects the `using-se-skills` meta-skill content at session start
  - Reads `skills/using-se-skills/SKILL.md` and outputs JSON with `priority: "IMPORTANT"`
  - Requires `jq` on PATH for JSON construction; graceful fallback with INFO message if missing
  - Result: every new session auto-activates the SE pipeline conductor (phase detection, guided workflow)
  - Verified: `2 hooks` in `/reload-plugins` output (1 ae-skills + 1 se-skills)

**4-Channel Document Preprocessing Pipeline:**

- `scripts/preprocess_pdf.py` (709 lines): PDF → structured text + tables + figures
  - Text extraction via PyMuPDF (fitz), OCR fallback via Tesseract
  - Table extraction with quality scoring, figure extraction with metadata
- `scripts/preprocess_xlsx.py` (575 lines): Excel → markdown tables
  - Sheet-by-sheet conversion, merged cell forward-fill, header row detection
- `scripts/preprocess_docx.py` (476 lines): Word → heading hierarchy + paragraph + table + image extraction
  - Preserves document structure (headings → outline), table border/style metadata
- `scripts/preprocess_pptx.py` (412 lines): PowerPoint → slide text + speaker notes + embedded images
  - Slide-by-slide extraction, shape type detection, notes preservation
- `scripts/extract_figures.py` (214 lines): Shared figure extraction with quality scoring
- `scripts/extract_tables.py` (206 lines): Shared table extraction with false-positive detection
- `scripts/requirements.txt` (26 lines): 10 Python dependencies (PyMuPDF, Pillow, pytesseract, openpyxl, python-docx, python-pptx, pandas, tabula-py, camelot-py, pdfplumber)
- All 4 channels include `--verify` mode for automated quality scoring:
  - Text density check, OCR quality assessment, garbled character detection, table false-positive filtering, empty slide detection
- Integration: `skills/requirements-decompose/SKILL.md` Step 0 PREPROCESS covers all 4 input types (~200 lines added)
- `references/`: 4 processing guides extracted from document-skills patterns:
  - `pdf-processing-guide.md` (222 lines)
  - `spreadsheet-processing-guide.md` (199 lines)
  - `docx-processing-guide.md` (195 lines)
  - `pptx-processing-guide.md` (176 lines)

### Changed

**`requirements-decompose` SKILL.md:**
- Added Step 0 PREPROCESS section (~200 lines): automatic document ingestion pipeline
  - PDF → requirements extraction with OCR fallback
  - DOCX → heading-structured requirement parsing
  - PPTX → slide-by-slide requirement identification
  - XLSX → sheet-based requirement matrix extraction
- Document preprocessing step runs before formal requirement decomposition

### Fixed

**16 findings from comprehensive project audit (4 review rounds):**

CRITICAL fixes (breaking Pipeline/Goal Mode phase detection):
- Output path unification: `docs/specs/` → `docs/spec/` across 6 files (4 spec-producing skills, 2 commands, traceability-matrix)
  - `spec-authoring/SKILL.md`, `hardware-detailed-design/SKILL.md`, `software-detailed-design/SKILL.md`, `algorithm-design/SKILL.md`
  - `.claude/commands/se-spec.md`, `skills/traceability-matrix/SKILL.md`
  - Root cause: skills wrote to `docs/specs/` but pipeline conductor checked `docs/spec/` — automatic phase detection silently skipped the Document phase

HIGH fixes:
- `design-review/SKILL.md`: filled empty "See Also" section with 4 reference checklists (system-design-review, hw-design-review, sw-design-review, testability-review)
- Added Pipeline Mode guidance text to 11 skills that were missing it (now 15/16 skills have guidance; `using-se-skills` is the conductor itself)
  - `requirements-decompose`, `architecture-design`, `software-architecture-design`, `hardware-architecture-design`
  - `spec-authoring`, `software-detailed-design`, `hardware-detailed-design`, `algorithm-design`
  - `design-review`, `requirements-review`, `code-static-review`, `test-plan-review`, `test-report-review`, `release-review`, `traceability-matrix`

MEDIUM fixes:
- `marketplace.json`: updated description from 5 skills (initial release) to all 16 skills with full lifecycle coverage
- `plugin.json` + `marketplace.json`: unified author name to `ddddjaak`
- `agents/README.md`: corrected persona count description (4 default review lenses + compliance-reviewer as independent)

Cross-package hygiene:
- Removed 7 ae-skills skill name references from 4 skills:
  - `architecture-design/SKILL.md`: removed `planning-and-task-breakdown` reference
  - `software-architecture-design/SKILL.md`: removed `spec-driven-development`, `doubt-driven-development`, `interview-me` references
  - `hardware-architecture-design/SKILL.md`: removed `spec-driven-development`, `doubt-driven-development`, `interview-me` references
  - `design-review/SKILL.md`: removed `doubt-driven-development` reference
- `CONTRIBUTING.md`: removed ae-skills script reference
- Preserved boundary declaration statements in `CLAUDE.md` and `AGENTS.md` (these are explicit policy, not cross-package coupling)

LOW fixes:
- `using-se-skills/SKILL.md`: skill count `15+` → `16` (exact count)
- Architecture output templates: added explicit Scope/Not-Covered sections to `architecture-design`, `software-architecture-design`, `hardware-architecture-design`

### Infrastructure

- `.gitignore`: added entries for draw.io test artifacts (`*.drawio`, `*.vsdx`)
- `.mcp.json`: 3 MCP servers configured with descriptions (drawio, visio, math)
  - Uses `${CLAUDE_PLUGIN_ROOT}` resolution for hooks; MCP commands are portable (npx/python/uvx)

## [1.0.0] — 2025

### Added

**Autonomous Goal Mode (`/se-goal`):**
- New slash command `.claude/commands/se-goal.md` — goal-driven full-pipeline execution
- CLAUDE.md: ~150 lines of Goal Mode rules — Plan→Act→Observe→Reflect loop, auto-skill selection by phase+domain, self-correction protocol (max 3 retries per phase), stop conditions (success/escalate/budget/pause), progress reporting format
- Pipeline Mode vs Goal Mode distinction: triggers, user interaction, failure handling

**Pipeline Mode (automatic phase detection and guidance):**
- CLAUDE.md: ~60 lines of Pipeline Mode rules — phrase-level trigger keywords (Chinese/English), 3-step phase detection (directory scan → content quality verification → true phase status), option presentation templates, execution protocol with loop
- using-se-skills: ~80 lines of Pipeline Conduction section — phase detection protocol, per-phase option generation with exact wording templates, special artifact routing
- Cross-session resume: reads `docs/versions.json` on session start to recover pipeline state

**Skill chain fully connected:**
- All 16 skills: `## After This Skill` section declaring upstream dependencies, downstream consumers, alternative paths, and traceability checkpoint
- Pipeline graph from islands to directed graph — any requirement traceable through full chain

**Artifact traceability and state persistence:**
- `docs/versions.json` — 15 artifact entries, 14 dependency links, 5 phase checkpoints, cross-session state persistence
- CLAUDE.md execution protocol: Record step updates versions.json after each skill completes

**Skill description optimization:**
- All 16 skill YAML descriptions rewritten: Chinese trigger phrases first, unique first sentences, explicit NOT clauses for disambiguation
- Review family (7 skills) disambiguated: unique identifiers replace shared "review" opening
- Architecture family (5 skills) disambiguated: "Transforms...into..." pattern eliminated

**Documentation:**
- README.md: `/se-goal` added to command table, Pipeline vs Goal Mode comparison table, skill count 15→16
- docs/README.md: full directory structure, versions.json documentation, work mode reference
- AGENTS.md: complete rewrite reflecting 16 skills, 6 commands, Pipeline Mode + Goal Mode, versions.json

### Changed

**Reference checklist simplification (21 files):**
- Tables reduced from 4–9 columns to 1–2 columns (ID + check content only)
- Removed: 修订记录, 适用范围, 参考文件, CHIPSEA CONFIDENTIAL markers
- Removed: 目的(Objectives) sections, **评估**: YES/NO inline markers
- Cleaned: template placeholder values (OK→[待评估], No→[待评估])
- Total: ~2500+ lines → 1210 lines (~50% reduction)

**using-se-skills meta-skill:**
- Added Pipeline Conduction section with phase detection protocol and option generation
- Added After This Skill section declaring conductor role
- Enhanced Quick Reference to include all 16 skills

**CLAUDE.md:**
- Added Pipeline Mode rules (trigger keywords, phase detection, execution protocol)
- Added Goal Mode rules (Plan→Act→Observe→Reflect, auto-selection, self-correction)
- Added cross-session resume protocol
- Updated slash command routing table
- Refined trigger keywords from single-word to phrase-level patterns

**README.md:**
- Command table restructured with mode badges (自主式/引导式)
- Added Pipeline Mode vs Goal Mode 4-dimension comparison
- Command count 5→6, skill count 15→16
- using-se-skills description updated to pipeline conductor
- Project structure updated with se-goal.md

**docs/README.md:**
- Complete directory structure including all artifact subdirectories
- versions.json documentation
- Work mode reference table

**AGENTS.md:**
- Full rewrite: 16 skills, 6 commands, pipeline architecture, validation rules

### Fixed

- Skill descriptions: eliminated ambiguity between 7 review skills and 5 architecture skills
- Phase detection: upgraded from binary directory check to 3-step quality verification
- Cross-session state: added versions.json to persist pipeline progress across sessions

## [0.1.0] — 2025

### Added
- Initial release with 5 SE workflow skills: requirements-decompose, architecture-design, spec-authoring, design-review, traceability-matrix
- Meta-skill: using-se-skills
- 5 professional agent personas: system-architect, hw-domain-expert, fw-domain-expert, verification-engineer, compliance-reviewer
- 5 slash commands: `/se-requirements`, `/se-architecture`, `/se-spec`, `/se-review`, `/se-traceability`
- Plugin manifest: plugin.json, marketplace.json
- CLAUDE.md with repository structure guide
- AGENTS.md, CONTRIBUTING.md, README.md
- `.github/` — issue templates and PR template
- MIT License
