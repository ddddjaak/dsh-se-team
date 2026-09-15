# Contributing to dsh-se-skills

感谢你对 dsh-se-skills 的关注！本指南说明如何贡献新技能、改进现有技能或修复问题。

本仓库是 **dsh 专用**插件。新增内容必须在 DeepSeek Harness 的注册机制下可被发现：`skills/` 由
dsh-skill-filesystem provider 直供，`commands/` 与 `agents/` 由 `lib/index.js` 注册。不要引入其他
平台的资产（插件清单、hooks、平台专有的指令文件等）—— `npm run validate` 会把它们判为错误。

## 技能质量标准

每个技能必须满足以下标准才能被接受：

### 具体（Specific）

技能必须包含**可操作的步骤**，而非模糊的建议。好的步骤："打开数据手册 §3.2，逐个确认每个引脚的复用功能分配"。不好的步骤："检查引脚分配是否正确"。

### 可验证（Verifiable）

每个技能必须以**验证检查清单**结尾，清单中的每一条都必须有明确的通过/失败条件。"看起来没问题"永远不够。所有检查项必须能够客观确认。

### 经过实战检验（Battle-Tested）

技能必须基于**真实的 SE 工作流**。如果你从未在实际芯片项目中做过某件事，不要为它写技能。反合理化表（Common Rationalizations）尤其重要 — 它应该包含你在实际项目中听到过的真实借口和相应的反驳。

### 精简（Minimal）

`SKILL.md` 应控制在 **500 行以内**。如果内容超了：
- 将长篇参考材料移到技能文件自身的详细步骤中（渐进式披露）
- 不要创建外部参考文件（除非内容超过 100 行）
- 多余的段落删掉 — 每个段落必须服务一个明确的引导目的

## 添加新技能

### 1. 确定技能属于哪个阶段

| 阶段 | 现有技能 | 新技能应在何时添加 |
|------|---------|-----------------|
| Define | requirements-decompose | 当有新的需求处理方式（不同于现有的分解流程） |
| Design | architecture-design | 当有新的设计方法论需要编码 |
| Document | spec-authoring | 当需要生成新类型的规格文档 |
| Verify | design-review, traceability-matrix | 当有新的验证或审查方法 |

### 2. 创建技能文件

```
skills/<kebab-case-name>/
  SKILL.md
```

### 3. SKILL.md 格式

```markdown
---
name: <kebab-case-name>
description: <what the skill does, third person>. Use when <trigger conditions>.
---

# <Skill Title>

## Overview
[这个技能做什么，为什么重要]

## When to Use
[触发条件列表]

**When NOT to use:**
[排除条件 — 什么时候不该用这个技能]

## The Process
[分步流程 — 每个步骤要有明确的输入/输出]

## Interaction with Other Skills
[与其他 SE 技能的关系：上游依赖、下游消费者、互补关系]

## Common Rationalizations
| Rationalization | Reality |
|---|---|
| [常见借口] | [为什么这个借口站不住脚] |

## Red Flags
[出问题的迹象 — 如果看到这些，说明你没有正确执行技能]

## Verification
[验证检查清单 — 每一项都要可客观确认]
```

### 4. 更新元技能

如果新增技能属于现有 SE 工作流的一部分：
1. 更新 `using-se-skills/SKILL.md`：在 Skill Discovery 流程图中添加新分支，在 Quick Reference 表中添加新条目
2. 如果新技能是现有技能的上下游依赖，更新相关技能的 "Interaction with Other Skills" 章节

### 5. 验证

```bash
npm run validate              # 结构、frontmatter、命名冲突、bundle patch
npm run validate -- --strict  # CI：warning 也算失败
```

校验器覆盖：`name` 与目录名是否一致、`name` 是否为 kebab-case、`description` 是否存在、必需章节
是否齐全（`skills/` 为 Overview / When to Use / Verification / After This Skill；`commands/` 为
Overview / Verification；`agents/` 为 Review Framework / Output Format / Rules）、三个目录之间是否
重名、`using-se-skills` 的 Quick Reference 是否仍反映技能全集、bundle patch 里的 `!!js` 表达式能否
编译。

人工复查：

- [ ] `description` 以第三人称描述技能功能开头，后跟 "Use when..." 触发条件
- [ ] 所有交叉引用指向存在的技能名称
- [ ] 若新增或删除技能，`using-se-skills` 的 Skill Discovery 流程图与 Quick Reference 表已同步

## 添加入口技能或评审角色

入口技能放在 `commands/<se-名称>.md`，评审角色放在 `agents/<角色名>.md`，两者都需要 frontmatter 的
`name` 与 `description`：

| 类型 | 目录 | 章节结构 | 注册策略 |
|------|------|---------|---------|
| `/se-*` 入口 | `commands/` | Overview → 流程 → Verification → After This Skill | `modelInvocable: false`，仅用户回路 |
| 评审角色 | `agents/` | Review Framework → Output Format → Rules → Composition | 两条回路都放行 |

写入口技能时把它当成「选一个技能 + 预先锁定该技能流程」的短文件 —— 不要在入口里复述技能正文，
用技能名引用即可。改动 `commands/`、`agents/`、`lib/` 后需要**重启 dsh 服务**才生效；`skills/` 下的
改动由 provider 实时提供。

`lib/index.js` 必须保持**零依赖**（只允许 `node:` 内建模块）：插件以 `link:` 方式安装，node 按 realpath
解析模块，静态 import `@deepseek-ai/*` 会在加载期直接失败。除非本包改为发布到 registry 安装，否则不要
破坏这条约束。

## 改进现有技能

### 改进流程

1. 先阅读目标技能和相关上下游技能的完整 SKILL.md
2. 在 PR 中说明：改了什么、为什么改、怎么验证
3. 检查改动是否影响 `using-se-skills` 元技能中的流程图或快速参考表

### 常见改进类型

| 类型 | 示例 |
|------|------|
| 新增步骤 | 在 architecture-design 的 Process 中增加一步 |
| 补充反合理化 | 添加你在项目中听到的新借口及其反驳 |
| 新增红旗信号 | 添加你发现技能被错误执行时的特征信号 |
| 更新交叉引用 | 随着技能增删更新交互章节 |
| 修复流程漏洞 | 发现某一步遗漏了关键检查点 |

## 报告问题

如果你发现技能中的错误（不正确的指导、过时的引用、缺失的步骤），请开 Issue 并包含：
- 哪个技能
- 哪个章节/步骤
- 问题是什么
- 建议的修复（如适用）

## 代码审查标准

对技能 PR 的审查应关注：
1. **正确性** — 流程在 SE 实践中是否正确？
2. **完整性** — 是否遗漏了关键步骤或检查点？
3. **可操作性** — 每个步骤是否足够具体，能够被 agent 执行？
4. **精简性** — 是否有可以删除的冗余内容？
5. **一致性** — 术语、格式、交叉引用是否与现有技能一致？
