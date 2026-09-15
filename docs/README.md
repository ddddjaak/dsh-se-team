# SE Skills — 文档目录

本目录存放 SE 工作流产出的产物模板、版本清单和发布说明。

## 目录结构

SE 技能会将产出物保存到以下子目录（由技能在工作流中自动创建）：

```
docs/
├── README.md                        # 本文件
├── versions.json                    # 产物版本清单（跨会话恢复）
├── dsh-setup.md                     # dsh 安装 / 更新 / 排错
├── requirements/                    # requirements-decompose 产出
│   └── [project]-system-requirements.md
├── architecture/                    # architecture-design / software-architecture-design / hardware-architecture-design 产出
│   ├── [project]-architecture-design.md
│   ├── [project]-software-architecture.md
│   └── [project]-hardware-architecture.md
├── spec/                            # spec-authoring / software-detailed-design / hardware-detailed-design / algorithm-design 产出
│   ├── [project]-software-outline-design.md
│   ├── [project]-hw-sw-interface-spec.md
│   ├── [project]-test-plan.md
│   ├── [project]-software-detailed-design.md
│   ├── [project]-hardware-detailed-design.md
│   └── [project]-algorithm-design.md
├── reviews/                         # design-review / requirements-review / code-static-review / test-plan-review / test-report-review / release-review 产出
│   ├── [project]-[artifact]-review-report.md
│   ├── [project]-requirements-review.md
│   ├── [project]-code-static-review.md
│   ├── [project]-test-plan-review.md
│   ├── [project]-test-report-review.md
│   └── [project]-release-review.md
└── traceability/                    # traceability-matrix 产出
    └── [project]-traceability-matrix.md
```

## versions.json

`docs/versions.json` 是管道的**版本清单和状态文件**，由 Pipeline Mode 和 Goal Mode 自动维护：

- **15 个 artifact 条目** — 每个技能对应一个产出物，声明 `depends_on` 上游依赖
- **14 条依赖关系** — 下游技能运行前可验证上游产物是否已产出
- **5 个阶段检查点** — define / design / document / verify / validate
- **跨会话恢复** — 新会话自动读取，恢复上次进度

## 两种工作模式

| | Pipeline Mode（引导式） | Goal Mode（自主式） |
|---|---|---|
| 触发 | "帮我做需求分解" | `/se-goal` 或 "端到端走完全流程" |
| 阶段切换 | 展示选项，你选 | AI 自动决定 |
| 进度追踪 | 手动 | versions.json 自动更新 |

安装与配置见 [dsh-setup.md](dsh-setup.md)，变更历史见 [../CHANGELOG.md](../CHANGELOG.md)。
