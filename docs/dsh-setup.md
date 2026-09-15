# DeepSeek Harness (dsh) Setup

安装本包，把 16 个 SE 工作流技能 + 6 个 `/se-*` 入口 + 5 个评审角色挂进 **dsh web GUI**。
`skills/` 由 provider 原地直供（不复制文件），因此在这里 `git pull` 就能更新技能目录。

## 前置

- dsh web GUI（DeepSeek Harness，profile `web`）
- PATH 上有 pnpm —— `dsh plugin` 命令会转发给 pnpm
- （可选）`npx` / `python` / `uvx`，分别对应 drawio / visio / math 三个 MCP server

## 安装

```powershell
dsh plugin --profile web add link:D:/tags/se-skills
```

这一步会把 `dsh-se-skills` 以符号链接形式加进 `~/.dsh/profiles/web/package.json`，并追加到
`dsh.profile.bundles`。随后 **重启 dsh web GUI（host 进程）**，开一个新会话，技能即出现在会话的技能目录里。

## 安装后你会得到什么

| 来源 | 内容 | 调用方式 |
|------|------|---------|
| `skills/`（provider 直供） | 16 个 SE 工作流技能（含 `using-se-skills` 元技能） | 模型按阶段自动路由；用户也可直接引用 |
| `commands/`（插件注册） | `/se-goal`、`/se-requirements`、`/se-architecture`、`/se-spec`、`/se-review`、`/se-traceability` | 输入框敲 `/` 从菜单选，或直接打 `/se-goal <目标>` |
| `agents/`（插件注册） | `system-architect`、`hw-domain-expert`、`fw-domain-expert`、`verification-engineer`、`compliance-reviewer` | 直接装入，或作为 subagent 角色名委派 |
| `cordis.patch.yml` | drawio / visio / math 三个 MCP server | 模型按需调用其工具 |

`/se-*` 入口与评审角色都注册为 `modelInvocable: false` / `true` 两种策略：入口只走用户回路，不进驻模型
技能目录（模型侧的路由交给 `using-se-skills`）；角色两条回路都放行。

## 更新

```powershell
git -C D:/tags/se-skills pull
```

- `skills/` 下的改动：provider 有 watcher，运行中的 host 察觉后即生效，或下次 GUI 重启生效
- `commands/`、`agents/`、`lib/`、`cordis.patch.yml` 下的改动：需要**重启 dsh 服务**

## 卸载

```powershell
dsh plugin --profile web remove dsh-se-skills
```

## 工作原理

| 部件 | 位置 | 作用 |
|------|------|------|
| `package.json` | 仓库根 | 声明 `dsh.bundle.patch`，使本包成为一个 profile bundle |
| `cordis.patch.yml` | 仓库根 | ① 插入 `se-skills` provider（id `se-skills`）到 host plane 的全局技能层；② 插入 `dsh-se-skills` 插件；③ 插入三个 MCP server 行 |
| `skills/` | 仓库根 | 16 个技能，由 provider 发现，原地服务 |
| `commands/` `agents/` | 仓库根 | 由 `lib/index.js` 注册进 skill registry |
| `lib/index.js` | `lib/` | 零依赖插件入口（见下方约束） |

provider 配置了 `includeDefaultRoots: false`，因此它**只**贡献本包的 `skills/`，不会连带扫入项目的
`.dsh/skills` 或用户的 `~/.dsh/skills`。`!!js` 表达式把 `node_modules/dsh-se-skills/skills/` 相对
profile 目录解析，落到指回本仓库的 pnpm 符号链接上。

### 两条注册轨道的取舍

`skills/` 走 provider、`commands/` 与 `agents/` 走插件，不是随手分的：

- provider 只认 `<root>/<name>/SKILL.md` 和 `<root>/<name>.md` 两种形态，且嵌套的 `**/SKILL.md` 不会被发现。
  `skills/` 正好是前者。
- `agents/README.md` 没有 frontmatter，若把 `agents/` 也当成 provider 根，它每轮扫描都会被 warn 一次。
  由插件注册可以干净地跳过。
- 代价是插件层改动需要重启。作者高频改的 `skills/` 保持了 live。

### `lib/index.js` 必须零依赖

插件以 `link:` 方式安装，profile 的 `node_modules` 里只是指向本仓库的符号链接。node 默认按 **realpath**
解析模块，因此从 `D:/tags/se-skills/lib` 向上查找时，**找不到** `~/.dsh/profiles` 下的
`@deepseek-ai/*` —— 任何静态 import 都会在加载期直接失败。所以该文件只允许使用 `node:` 内建模块。
除非将来把本包发布到 registry 改为常规安装，否则不要引入外部依赖。

## 校验

```bash
npm run validate              # 结构、frontmatter、命名冲突、bundle patch
npm run validate -- --strict  # CI：warning 也算失败
```

校验器在能定位到 dsh profile 时，会用 profile 自带的 YAML 解析器真正解析一遍 `cordis.patch.yml`，
并编译其中每个 `!!js` 表达式（只编译、不求值，因为它依赖 host 作用域）。

想直接看 dsh 眼中的最终配置：

```powershell
dsh --profile web --dump-config
```

## 排错

| 现象 | 处理 |
|------|------|
| 技能目录里看不到 16 个技能 | 确认 `dsh.profile.bundles` 里有 `dsh-se-skills`；重启 host；用 `--dump-config` 看 provider 行是否在 |
| 看不到 `/se-*` 入口 | 它们由插件注册，改动或首次安装后必须重启 dsh 服务 |
| drawio MCP 起不来（Windows） | `command: npx` 在某些 spawn 路径下解析不到 `.cmd` shim，改成 `npx.cmd` |
| math / visio MCP 起不来 | 确认 `uvx` / `python` 在 PATH 上；这三个 server 都设了 `failOnStartupError: false`，单个 server 起不来不会拖垮 host |
| 同一个技能名出现两次 | `skills/`、`commands/`、`agents/` 三处共用一套命名空间；`npm run validate` 会报重名 |
