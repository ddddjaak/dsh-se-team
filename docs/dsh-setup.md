# DeepSeek Harness (dsh) Setup

安装本包，把 16 个 SE 工作流技能 + 6 个 `/se-*` 入口 + 5 个评审角色挂进 **dsh web GUI**。
`skills/` 由 provider 原地直供（不复制文件），因此在这里 `git pull` 就能更新技能目录。

## 前置

- dsh web GUI（DeepSeek Harness，profile `web`）
- PATH 上有 pnpm —— `dsh plugin` 命令会转发给 pnpm
- （可选）`npx` / `uvx` / `python` —— 只有**没有** vendor 本地副本时才需要，见下文
  「第三方 MCP server 本地化」

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
| `cordis.patch.yml` | drawio / math 两个 MCP server（visio 默认禁用） | 模型按需调用其工具 |

`/se-*` 入口与评审角色都注册为 `modelInvocable: false` / `true` 两种策略：入口只走用户回路，不进驻模型
技能目录（模型侧的路由交给 `using-se-skills`）；角色两条回路都放行。

## 更新

```powershell
git -C D:/tags/se-skills pull
```

- `skills/` 下的改动：provider 有 watcher，运行中的 host 察觉后即生效，或下次 GUI 重启生效
- `commands/`、`agents/`、`lib/`、`mcp/`、`cordis.patch.yml` 下的改动：需要**重启 dsh 服务**

## 卸载

```powershell
dsh plugin --profile web remove dsh-se-skills
# 本地 vendor 出来的副本（体积不小，且不会自己消失）
node scripts/fetch-mcp.mjs --clean
```

## 第三方 MCP server 本地化（离线可用）

三个第三方 MCP server **不直接**把 `npx` / `uvx` 写死成 `command`，而是统一经由 `mcp/shim.mjs` 启动：

```yaml
command: !!js "process.execPath"          # 跑 dsh 的那个 node，必然存在
args:
  - !!js "...fileURLToPath(new URL('node_modules/dsh-se-skills/mcp/shim.mjs', baseUrl))"
  - drawio                                 # 只传一个 id
```

垫片读 `mcp/servers.json`，按顺序决定实际启动什么：

1. `.mcp-vendor/<id>/` 里有本地副本 → **跑本地副本**，完全离线，不碰 npx / uvx
2. 没有 → 回落到声明好的包运行器（`npx -y @drawio/mcp@1.5.0` / `uvx --with 'mcp<2' gnomon-mcp==0.1.2`）
3. 两者都不可用 → 往 stderr 打诊断后非零退出；该行因 `failOnStartupError: false` 被**单独**禁用，不拖垮 host

把本地副本铺出来（可选，但推荐：它把「首次启动需要联网」这个不确定性消掉）：

```bash
node scripts/fetch-mcp.mjs           # 拉取并钉版本，落到 .mcp-vendor/（已 gitignore）
node scripts/fetch-mcp.mjs --check   # 只看状态，不运行 npm / pip
node scripts/fetch-mcp.mjs --only math
node scripts/fetch-mcp.mjs --clean   # 先清掉再重铺
node scripts/fetch-mcp.mjs --dry-run # 只打印将要执行的命令
npm run mcp:status                   # 打印每行最终会启动什么（= shim --list）
```

| server | 上游 | 钉住的版本 | 许可 | 可 vendor |
|--------|------|-----------|------|-----------|
| drawio | npm `@drawio/mcp` | 1.5.0 | Apache-2.0 | 是 |
| math | PyPI `gnomon-mcp` | 0.1.2 | MIT | 是 |
| visio | PyPI `visio-mcp` | — | 未标注 | **否** |

**visio 为什么默认禁用且不 vendor**：上游 `visio-mcp` 要求 Python ≥3.14，并且要通过 COM 驱动一个
**装了授权许可的 Microsoft Visio**。这两条都不能在贡献者机器上假定成立，所以该行 `disabled: true`，
也不参与 vendor 流程。有 Visio 的机器上把 `disabled` 改成 `false` 即可启用。
（顺带说明：`main` 分支的 v2 `.mcp.json` 里那行 visio 引用的是 `visio_mcp_server` 模块，该名字在 PyPI
上不存在 —— 无法安装，也无法审计。）

`.mcp-vendor/` 是**构建产物不是源码**：配方（包名、版本、许可、入口）在 `mcp/servers.json` 里，
所以它不进版本库。重装或换机器后跑一次 `npm run fetch:mcp` 即可重建。

### 为什么 Python 用 venv 而不是 `pip install --target`

这是实际踩出来的，不是偏好：

- **`--target` 装不了 pywin32。** Windows 上 `mcp<2` 会依赖 pywin32，而 pywin32 靠 `.pth` 文件把它的
  DLL 目录挂进 `sys.path`；`.pth` **只在解释器已知的 site 目录里**才会被处理，`--target` 目录挂在
  `PYTHONPATH` 上不满足这个前提。结果是 pip 报成功、import 报
  `No module named 'pywintypes'`，且报错落在 mcp SDK 深处，很难指回原因。
- **ABI 会被钉死在构建机上。** `--target` 装出来的是 cp313 的二进制扩展；如果 dsh spawn 的
  `python` 是 3.14，`pydantic_core._pydantic_core` 直接 import 失败。
- venv 的 site-packages 是真正的 site 目录（`.pth` 正常工作），而且 venv 自带解释器，
  版本随环境一起被钉住，ABI 不可能漂移。

即便如此，垫片**不信任存在性**：每个 Python 条目在 `servers.json` 里声明了 `probe`
（math 是 `gnomon_mcp.server`，正好覆盖 FastMCP / pydantic / pint 这整条 C 扩展链），
启动前用该环境的解释器真的 import 一次。失败就回落到 uvx，并把 stderr 末尾一行写进诊断 ——
比 MCP 侧那句 "spawn failed" 有用得多。`node scripts/fetch-mcp.mjs --check` 跑的是同一个探测。

想用别的解释器建 venv（例如 dsh 实际 spawn 的那个）：

```bash
node scripts/fetch-mcp.mjs --only math --python C:/Python314/python.exe --clean
```

### 为什么不把 `!!js` 三元直接写在 YAML 里

存在性判断要写在 `command` 和每个 `args` 条目上，三行 × 若干处，重复且无法单测；而且子进程起不来时
MCP 侧只有一句「spawn 失败」，不会告诉你「本来可以走本地副本」。垫片把这件事收进一个可测的文件，并
提供 `--list` / `--print` 体检入口。代价是多一层进程 —— 但它是**透传父进程**（子进程 `stdio: 'inherit'`，
直接继承宿主给的管道），协议消息不经过垫片内存，没有逐条消息的转发开销。

## 工作原理

| 部件 | 位置 | 作用 |
|------|------|------|
| `package.json` | 仓库根 | 声明 `dsh.bundle.patch`，使本包成为一个 profile bundle |
| `cordis.patch.yml` | 仓库根 | ① 插入 `se-skills` provider（id `se-skills`）到 host plane 的全局技能层；② 插入 `dsh-se-skills` 插件；③ 插入三个 MCP server 行 |
| `skills/` | 仓库根 | 16 个技能，由 provider 发现，原地服务 |
| `commands/` `agents/` | 仓库根 | 由 `lib/index.js` 注册进 skill registry |
| `lib/index.js` | `lib/` | 零依赖插件入口（见下方约束） |
| `mcp/servers.json` | `mcp/` | 第三方 MCP server 的**唯一**配方记录（版本、许可、入口、回落命令） |
| `mcp/shim.mjs` | `mcp/` | 启动垫片：本地副本 / 包运行器二选一，stdout 保持干净 |
| `scripts/fetch-mcp.mjs` | `scripts/` | 按配方把本地副本铺进 `.mcp-vendor/` |

provider 配置了 `includeDefaultRoots: false`，因此它**只**贡献本包的 `skills/`，不会连带扫入项目的
`.dsh/skills` 或用户的 `~/.dsh/skills`。`!!js` 表达式把 `node_modules/dsh-se-skills/...` 相对
profile 目录解析，落到指回本仓库的符号链接上。

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

`mcp/shim.mjs` 与 `scripts/fetch-mcp.mjs` 出于同样的理由只用 `node:` 内建模块。

## 校验

```bash
npm run validate              # 结构、frontmatter、命名冲突、bundle patch、MCP 配方
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
| 某个 MCP 的工具不见了 | 该行被单独禁用了。`npm run mcp:status` 看它解析成什么；`node scripts/fetch-mcp.mjs --check` 看本地副本在不在 |
| 想确认走的是本地副本还是 npx | 垫片启动时往 stderr 打 `se-skills/mcp: <id>: vendored (local copy) -> ...`，在 host 日志里 grep `se-skills/mcp:` |
| `--only <id>` 报 unknown | id 只有 `drawio` / `math` / `visio`，清单在 `mcp/servers.json` |
| 同一个技能名出现两次 | `skills/`、`commands/`、`agents/` 三处共用一套命名空间；`npm run validate` 会报重名 |
