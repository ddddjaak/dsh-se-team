# dsh-se-skills

**面向芯片原厂 SE（系统工程师 / 应用架构师）的 SE 工作流技能集 —— DeepSeek Harness（dsh）专用插件。**

Skills 把资深系统工程师在芯片应用项目中遵循的工作流、质量门禁和最佳实践编码封装，使 agent 能够在 SE 工作流的每个阶段 —— 从原始需求分解、架构设计、规格撰写、跨部门评审到可追溯性验证 —— 一致地遵循这些规范。

> **本仓库是 dsh 专用分支。** 不再随附 Claude Code / Codex / 其他平台资产；多平台版本保留在 `main` 分支。

---

## 快速开始（dsh 专用）

```powershell
dsh plugin --profile web add link:<本仓库路径>
```

安装后**重启 dsh 服务**，新会话的技能目录即出现 16 个 SE 技能 + 6 个 `/se-*` 入口 + 5 个评审角色。详见 [docs/dsh-setup.md](docs/dsh-setup.md)。

更新：

```bash
git pull   # link 安装下 skills/ 由 provider 直供，实时生效；插件层改动需重启 dsh 服务
```

---

## 入口

6 个 `/se-*` 入口，覆盖两种工作模式：**引导式（Pipeline Mode）** 和 **自主式（Goal Mode）**。
在 dsh 里它们就是 user-invocable 技能 —— 输入框敲 `/` 从菜单选，或直接打 `/se-goal <目标>`，dsh 会把该入口的正文注入为一条 user 指令。

| 你在做什么 | 入口 | 模式 | 核心原则 |
|-------------------|---------|------|---------------|
| 🚀 端到端全自动 SE 流程 | `/se-goal` | **自主式** | 给目标 → agent 自动跑完 Define→Design→Document→Verify→Validate，自查自修，只在真卡住时找你 |
| 分解原始需求 | `/se-requirements` | 引导式 | 每个需求可追溯、可测试、有归属 |
| 设计系统架构 | `/se-architecture` | 引导式 | 系统级 → HW/SW 专业架构拆分；每个接口精确定义，每个决策有据可查 |
| 撰写正式规格和详细设计 | `/se-spec` | 引导式 | 架构 + 需求 → SOD、HW-SW IF Spec、测试方案、模块详细设计 |
| 多类型产物评审 | `/se-review` | 引导式 | 六种评审类型覆盖全产物：设计、需求、代码、测试计划、测试报告、发布 |
| 验证可追溯性 | `/se-traceability` | 引导式 | 跨产物差距分析，覆盖率报告 |

这 6 个入口注册为 `modelInvocable: false` —— 它们是**人在回路**的快捷方式，不进驻模型技能目录。模型侧的路由由 `using-se-skills` 元技能负责。

### 两种工作模式

| | Pipeline Mode（引导式） | Goal Mode（自主式） |
|---|---|---|
| **怎么触发** | 说"帮我做需求分解" | 说"端到端走完全流程" 或 `/se-goal` |
| **阶段切换** | agent 展示选项，你选 | agent 自动决定下一步 |
| **验证失败** | 报告给你 | 自动自查自修（最多重试 3 次） |
| **跟你互动** | 每阶段都问 | 只在真卡住时或完成时 |
| **适用场景** | 你想一步步把控 | 你信任流程，想省时间 |

技能也会根据你正在做的事情自动激活 —— 设计软件架构会触发 `software-architecture-design`，需求存在矛盾会触发 `requirements-decompose`，对测试报告有疑问会触发 `test-report-review`，以此类推。

> dsh 另有一个 host 级 `/goal` 命令和持久化 goal domain，能让一个任务跨轮次持续被驱动。两者互不依赖：`/se-goal` 承载 SE 链路，host `/goal` 负责让会话继续跑。长时间无人值守的 SE 跑批可以两个都开。

---

## 全部 16 个技能

上述入口是快捷方式。本包包含 16 个 SE 工作流技能，覆盖 Define → Design → Document → Verify → Validate 全流程。每个技能专注于一个场景，包含输入验证门禁、量化指标、步骤流程和反合理化表。你也可以直接引用任何技能。

### 元技能 — 管道引导器

| 技能 | 功能 | 使用场景 |
|-------|-------------|----------|
| [using-se-skills](skills/using-se-skills/SKILL.md) | **管道引导器** — 自动检测当前 SE 阶段，引导用户完成 Define→Design→Document→Verify→Validate 全流程。支持 Pipeline Mode（展示选项）和 Goal Mode（全自动执行）两种工作模式 | 开始一个 SE 会话，或不确定该用哪个技能时；也可以直接说"端到端走完全流程"进入自主模式 |

### 定义 — 明确要构建什么

| 技能 | 功能 | 使用场景 |
|-------|-------------|----------|
| [requirements-decompose](skills/requirements-decompose/SKILL.md) | 六步流程（收集→分类→解决冲突→派生→分配归属→验证）：将原始异构输入（PRD、芯片数据手册、行业标准、客户规格）转化为结构化、可追溯的系统需求文档 | 新项目启动且需求分散在多个文档中；多个输入源存在矛盾；需要为每条需求分配归属（HW/SW/System） |

### 设计 — 架构方案与模块分解

| 技能 | 领域 | 功能 | 使用场景 |
|-------|------|-------------|----------|
| [architecture-design](skills/architecture-design/SKILL.md) | 系统 | 系统级模块分解、跨域接口定义、约束冲突分析、设计决策记录（含被拒绝方案和接受的下行风险） | 系统需求已确认，需设计模块划分；评估架构替代方案；下游设计发现缺失的架构决策 |
| [software-architecture-design](skills/software-architecture-design/SKILL.md) | 软件 | 系统架构 → 固件模块分解、RTOS 线程模型、IPC 设计、内存预算分配、时序关键数据流分析 | 系统架构已确认，需设计固件线程/ISR 模型和内存布局；评估 RTOS 选型 |
| [hardware-architecture-design](skills/hardware-architecture-design/SKILL.md) | 硬件 | 系统架构 → 引脚分配、电源域划分、PCB 层叠约束、信号完整性分析、元器件选型决策 | 系统架构已确认，需设计板级硬件；评估元器件替代方案；评审发现引脚冲突或 SI 问题 |

### 文档 — 撰写正式规格和详细设计

| 技能 | 领域 | 功能 | 使用场景 |
|-------|------|-------------|----------|
| [spec-authoring](skills/spec-authoring/SKILL.md) | 系统 | 从架构和需求生成三类系统级规格：软件概要设计（SOD）、软硬件接口规格（HW-SW IF Spec）、测试方案（Test Plan） | 架构已确认，需生成系统级规格文档；软硬件边界需明确定义；验证团队需测试程序 |
| [software-detailed-design](skills/software-detailed-design/SKILL.md) | 软件 | SW 架构 → 函数签名精确定义、状态机设计、数据结构与共享数据线程安全、错误处理矩阵、资源量化预算 | SW 架构已确认，某固件模块需详细设计文档后再编码；新模块加入现有固件代码库 |
| [hardware-detailed-design](skills/hardware-detailed-design/SKILL.md) | 硬件 | HW 架构 → 原理图元器件规格（容值/精度/封装/介质/布局约束）、PCB 布线规则、PDN 设计（Z_target 计算）、热分析（T_j 计算） | HW 架构已确认，原理图即将开始；准备 PCB 布局约束；评审发现硬件约束欠规格 |
| [algorithm-design](skills/algorithm-design/SKILL.md) | 算法 | 算法需求 → 信号处理/控制回路/标定程序/滤波器设计文档，含数学模型、量化位宽分析、时序预算 | 算法需求已明确（如 ADC 采样处理、电机 FOC 控制、传感器融合）；算法需独立于固件模块进行设计 |

### 验证 — 发布前的质量门禁

| 技能 | 领域 | 功能 | 使用场景 |
|-------|------|-------------|----------|
| [design-review](skills/design-review/SKILL.md) | 系统 | 四视角（HW/SW/Test/System）对抗式审查，每位审查者独立考察同一份产物，交叉比对发现分歧。纯流程技能 —— 不挂载审查清单 | 任何 SE 产物在分发前需跨部门评审；审查同事的架构或规格设计；里程碑前确认设计质量 |
| [requirements-review](skills/requirements-review/SKILL.md) | 需求 | 基于解决方案和软件需求分析审查清单，对需求文档进行逐项审查，输出分级问题报告 | 需求文档完成，需正式审查后再进入架构设计；需求变更后需重新验证完整性和一致性 |
| [code-static-review](skills/code-static-review/SKILL.md) | 软件 | 依据公司编码标准审查清单（6 类：代码层次/布局/注释/命名/设计/寄存器定义），对源码进行逐项合规检查 | 代码提交前需编码规范合规检查；模块代码冻结前需正式静态审查；遗留代码纳入当前编码标准 |
| [test-plan-review](skills/test-plan-review/SKILL.md) | 测试 | 基于测试方案和测试策略审查清单，验证测试方案的完整性、可追溯性和合规性 | 测试方案完成，需正式审查后再执行测试；需求变更后需验证测试方案是否覆盖新需求 |
| [test-report-review](skills/test-report-review/SKILL.md) | 测试 | 基于三项审查清单，验证测试报告的正确性、完整性和可追溯性 —— 不仅看通过率，更看覆盖率和未测项目 | 测试完成、报告生成后需正式评审；发布前需确认测试报告无未解决的阻断项 |
| [release-review](skills/release-review/SKILL.md) | 发布 | 发布包就绪审查 —— 盘点全部产物、版本一致性校验、对照发布审查清单逐项评估，输出分级问题报告 | 发布包（固件/发布说明/版本清单/测试报告）已组装，需对外分发前评审；里程碑发布签核 |

### 验证 — 跨产物可追溯性

| 技能 | 功能 | 使用场景 |
|-------|-------------|----------|
| [traceability-matrix](skills/traceability-matrix/SKILL.md) | 跨产物可追溯性分析 —— 需求→设计→测试的覆盖率缺口检测、孤立产物识别、过度覆盖发现、追溯报告生成 | 每个产物产出后立即验证覆盖率；里程碑评审前生成正式追溯证据；需求变更时评估影响范围 |

---

## 评审角色

用于针对性审查的预配置专业角色，覆盖 SE 工作流的五个审查视角：

| 角色 | 职责 | 视角 |
|-------|------|-------------|
| [system-architect](agents/system-architect.md) | 资深系统架构师 | 系统一致性、约束满足、跨域集成、风险暴露 |
| [hw-domain-expert](agents/hw-domain-expert.md) | 硬件域专家 | 引脚分配、电源域、时钟树、信号完整性、电气合规 |
| [fw-domain-expert](agents/fw-domain-expert.md) | 固件域专家 | 驱动接口、RTOS 集成、内存映射、启动流程、并发模型 |
| [verification-engineer](agents/verification-engineer.md) | 验证质量工程师 | 可测试性、测试覆盖率、追溯完整性、验证方法论 |
| [compliance-reviewer](agents/compliance-reviewer.md) | 合规安全审查员 | 法规合规、功能安全、安全控制、隐私、行业标准 |

五个角色由 `design-review` 并行扇出，对同一份 SE 产物做五视角对抗式审查，合并生成分类问题报告；也可以单独装入任一角色做针对性审查，或作为 subagent 角色名委派。角色可以调用技能，但**不调用其他角色** —— 编排权归用户或 `design-review`。

---

## 技能的工作原理

每个技能都遵循一致的结构：

```
┌─────────────────────────────────────────────────┐
│  SKILL.md                                       │
│                                                 │
│  ┌─ 前置元数据 ──────────────────────────────┐  │
│  │ name: 小写连字符命名                      │  │
│  │ description: 引导 agent 完成 [任务]。     │  │
│  │              使用场景：…                  │  │
│  └───────────────────────────────────────────┘  │
│  概览             → 这个技能做什么              │
│  使用场景         → 触发条件                    │
│  流程             → 逐步工作流                  │
│  常见合理化借口   → 借口 + 反驳                 │
│  红旗信号         → 出问题的迹象                │
│  验证             → 证据要求                    │
│  After This Skill → 上游/下游衔接               │
└─────────────────────────────────────────────────┘
```

**核心设计选择：**

- **是流程，不是散文。** 技能是 agent 遵循的工作流，不是让他们阅读的参考文档。每个技能都有步骤、检查点和退出标准。
- **一个技能 = 一个场景。** 16 个技能按职责精确拆分，每个技能专注一个场景（如 `software-detailed-design` 只设计一个固件模块），上下文干净、输入文档最多 2-3 项。
- **反合理化。** 每个技能都包含一个常见借口表，列出 agent 用来跳过步骤的借口（例如 "需求大概清楚了，直接开始设计吧"），并附有文档化的反驳。
- **验证不容妥协。** 每个技能都以证据要求结尾 —— 冲突解决日志、接口完整性检查清单、人类确认门禁。"看起来没问题" 永远不够。
- **渐进式披露。** `SKILL.md` 是入口点，每个控制在 500 行以内。详细审查清单放在 `references/` 目录（21 项 SE 审查清单），由技能通过 "See Also" 按需加载，不撑爆上下文。
- **独立可组合。** 技能可以端到端串联（需求→架构→详细设计→评审→追溯），也可以独立使用 —— 单跑 `design-review` 审查同事的产物，或单跑 `traceability-matrix` 做里程碑前的覆盖率检查。

---

## 项目结构

```
se-skills/                             # dsh 专用插件
├── skills/                            # 16 个 SE 工作流技能（provider 直供，实时生效）
│   ├── using-se-skills/               #   元技能：管道引导器
│   ├── requirements-decompose/        #   定义：原始输入 → 结构化需求
│   ├── requirements-review/           #   验证：需求文档清单审查
│   ├── architecture-design/           #   设计：系统级模块分解
│   ├── software-architecture-design/  #   设计：固件线程模型、IPC、内存预算
│   ├── hardware-architecture-design/  #   设计：引脚分配、电源域、SI 分析
│   ├── spec-authoring/                #   文档：SOD、HW-SW IF Spec、Test Plan
│   ├── software-detailed-design/      #   文档：函数签名、状态机、错误处理
│   ├── hardware-detailed-design/      #   文档：原理图约束、PDN、热分析
│   ├── algorithm-design/              #   文档：信号处理、控制回路、滤波器
│   ├── design-review/                 #   验证：四视角对抗式评审
│   ├── code-static-review/            #   验证：编码规范静态审查
│   ├── test-plan-review/              #   验证：测试方案完整性审查
│   ├── test-report-review/            #   验证：测试报告正确性审查
│   ├── release-review/                #   验证：发布就绪审查
│   └── traceability-matrix/           #   验证：跨产物可追溯性分析
├── commands/                          # 6 个 /se-* 入口技能（插件注册，仅用户回路）
├── agents/                            # 5 个评审角色（插件注册，两条回路）
├── references/                        # 21 项 SE 审查清单（按需加载）
├── lib/index.js                       # 插件入口：注册 commands/ 与 agents/（零依赖）
├── mcp/
│   ├── servers.json                   # 第三方 MCP server 的唯一配方（版本 / 许可 / 入口 / 回落）
│   └── shim.mjs                       # 启动垫片：本地副本 or npx/uvx 二选一（零依赖）
├── cordis.patch.yml                   # dsh bundle patch：provider + 插件 + MCP 行（统一走垫片）
├── package.json                       # dsh.bundle.patch 声明
├── scripts/
│   ├── validate-dsh-plugin.mjs        # 结构与契约校验器（零依赖）
│   └── fetch-mcp.mjs                  # 按配方把 MCP 本地副本铺进 .mcp-vendor/（零依赖）
├── docs/
│   ├── dsh-setup.md                   # dsh 安装 / 更新 / 排错
│   ├── README.md                      # 产出物模板说明
│   └── versions.json                  # 管道状态（阶段检测的权威来源）
├── AGENTS.md                          # 仓库指南 + 运行时行为定义（Pipeline/Goal Mode）
├── CONTRIBUTING.md                    # 贡献指南
├── CHANGELOG.md                       # 变更日志
└── LICENSE                            # MIT
```

`AGENTS.md` 在 dsh 下是双重身份：它既是指南，也会被 `dsh-agent-instructions` 作为工作区指令注入 prompt ——
Pipeline Mode 的触发词、阶段检测、执行协议、Goal Mode 的自动选技能规则和自修协议都定义在那里。
这也是本仓库只有一个指令文件的原因：dsh 会同时加载两个约定文件名，两份并存等于把同一套规则注入两遍。

---

## 为什么需要 SE Skills？

AI 编程助手默认走最短路径 —— 在系统工程师的工作中，这往往意味着跳过需求分解直接开始"设计"、用 "I2C" 三个字母代替完整的接口规格、默默解决需求矛盾而不追问、或者生成充满空章节的规格文档。

芯片应用项目中的错误发现越晚，修复成本越高 —— 需求阶段的歧义用一次对话就能澄清，集成阶段才发现架构假设错误则需要数周返工。

每个技能都编码了资深 SE 来之不易的工程判断。16 个技能按职责精确拆分，每个技能专注于一个场景，上下文窗口干净、引用清单精准：

- **需求分解** — 每个需求必须可量化、可测试、有归属。模糊需求用 GUESS 模式（提出量化解释 + 推理 → 让干系人确认/纠正），比开放式提问更快更有效。
- **架构设计** — 系统级架构分解为三大专业方向：`architecture-design`（系统级模块划分）、`software-architecture-design`（固件线程/ISR 模型、内存预算、IPC 设计）、`hardware-architecture-design`（引脚分配、电源域、SI 分析、元器件选型）。每个专业方向只读自己所需的输入文档，不加载全项目上下文。
- **详细设计与规格** — 四大产出物方向：`spec-authoring`（SOD/HW-SW IF/Test Plan 系统级规格）、`software-detailed-design`（函数签名/状态机/错误处理矩阵/资源量化）、`hardware-detailed-design`（原理图约束/PDN 数学推导/热分析 T_j 计算）、`algorithm-design`（信号处理/控制回路/标定程序）。
- **多类型评审** — 六种评审覆盖全产物类型：`design-review`（四视角对抗式——纯流程）、`requirements-review`（需求文档清单审查）、`code-static-review`（编码规范合规）、`test-plan-review`（测试方案完整性）、`test-report-review`（测试报告正确性）、`release-review`（发布包就绪审查）。每个评审技能只加载自己的审查清单，不加载全量 21 项清单。
- **可追溯性矩阵** — 在全链条上运行，而不只是在最后。每个产物产出后立即检查覆盖率，晚期发现的缺口修复成本呈指数增长。

### 防幻觉设计

每个技能都内置了减少 AI 幻觉的机制：

| 机制 | 体现 |
|------|------|
| **输入门** | 每个技能的 Step 1 强制验证输入产物存在且版本对齐，不满足则停止 |
| **引用追溯** | 每个声明、函数、引脚、约束必须引用一个 ID（REQ-XXX、IF-XXX、CON-XXX） |
| **量化一切** | "≤ 500μs" 而非 "fast"；"≤ 2W" 而非 "low power"；T_j 必须写计算公式 |
| **停-问门** | "If uncertain, surface and stop — do NOT guess" 在每个技能的关键决策点 |
| **上下文边界** | 每个技能明确声明只读什么、不读什么（如 `software-detailed-design` 只读 SW 架构文档，不读硬件规格、测试方案） |
| **TBD 管理** | 每个 TBD 必须有 owner + due date，不接受裸 TBD |
| **版本检查** | 每个技能交叉验证输入产物版本一致性，版本偏移作为 CRITICAL 上报 |

这些不是泛泛的提示词 —— 它们是那种有见地的、以流程为导向的工作流，能够区分经过工程验证的系统设计和拍脑袋的原型方案。

---

## 贡献

技能应该 **具体**（可操作的步骤，而非模糊的建议）、**可验证**（明确的退出标准和证据要求）、**经过实战检验**（基于真实 SE 工作流）以及 **精简**（只包含引导 agent 所需的内容）。

```bash
npm run validate              # 校验结构、frontmatter、命名冲突、bundle patch
npm run validate -- --strict  # CI：warning 也算失败
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md) 了解完整的贡献指南、技能格式规范和 PR 流程。

---

## 许可证

MIT — 在你的项目、团队和工具中自由使用这些技能。
