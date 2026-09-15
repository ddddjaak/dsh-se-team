# DeepSeek Harness (dsh) Setup

安装本包，把 16 个 SE 工作流技能 + 6 个 `/se-*` 入口 + 5 个评审角色挂进 **dsh web GUI**。
`skills/` 由 provider 原地直供（不复制文件），因此在这里 `git pull` 就能更新技能目录。

## 前置

- dsh web GUI（DeepSeek Harness，profile `web`）
- PATH 上有 pnpm —— `dsh plugin` 命令会转发给 pnpm
- （可选）`npx` / `uvx` / `python` —— 只有**没有** vendor 本地副本时才需要，见下文
  「第三方 MCP server 本地化」
- （可选）`git` —— 只有 `regmap` 那一行需要：它的上游只在 GitHub 发布，没有 registry 包

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
| `lib/tools/`（插件注册） | 3 个原生工具：`se_budget_rollup`、`se_budget_check`、`se_budget_bottleneck` | 模型按需调用；不需要任何 MCP server 在场 |
| `cordis.patch.yml` | 5 个 MCP server（drawio / math / regmap 默认启用；kicad / visio 默认禁用） | 模型按需调用其工具 |

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

五个第三方 MCP server **不直接**把 `npx` / `uvx` 写死成 `command`，而是统一经由 `mcp/shim.mjs` 启动：

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

**这一步要在没有文件写入限制的终端里跑。** 它会往 `.mcp-vendor/` 里解包成百上千个文件，受限沙箱下
npm 解包会报 `EPERM: operation not permitted`，然后**挂在原地不动**（没有进一步输出、没有报错，
实测 5 分钟以上无进展）。同一操作在不受限终端里是几十秒的事 —— 所以看到 `EPERM` + 长时间静止，
先怀疑写入被拦，别去查网络。`regmap` 那一行还需要 `git`（见下）。

| server | 上游 | 钉住的版本 | 许可 | 默认 | 可 vendor |
|--------|------|-----------|------|------|-----------|
| drawio | npm `@drawio/mcp` | 1.5.0 | Apache-2.0 | 启用 | 是 |
| math | PyPI `gnomon-mcp` | 0.1.2 | MIT | 启用 | 是 |
| regmap | GitHub `pkt-lab/mcp-svd` | commit `9e3956bf` | MIT（声称） | 启用 | 是（需 `git`） |
| kicad | PyPI `mcp-server-kicad` | 0.20.1 | MIT | **禁用** | 是 |
| visio | PyPI `visio-mcp` | — | 未标注 | **禁用** | **否** |

配方里的 `vendor.kind` 有三种，对应上游三种发布方式。垫片只区分「怎么起」，不区分「怎么铺」，
所以 `npm` 与 `github` 在启动上是同一件事（都是 `node <entry>`）：

| kind | 铺法 | 启动 |
|------|------|------|
| `npm` | registry tarball，钉精确版本 | `node <entry>` |
| `github` | 按 commit sha 浅取上游工作树，再就地从 registry 装它自己的 runtime 依赖 | `node <entry>` |
| `pypi` | venv，钉精确版本 | `<venv python> -m <module>` 或 venv 里的 console `script` |

### regmap：唯一一个按 commit 钉的行

上游 `pkt-lab/mcp-svd` **不在 npm registry 上**（`registry.npmjs.org/mcp-svd` 是 404），也没有任何
tag，所以「钉版本」只能钉 commit sha。三个必须知道的事实：

- **`dist/` 已入库，没有 `prepare` 脚本。** 作者的最后一个 commit 就是专门这么改的，理由是
  `prepare` 会在 `npm install` 时跑 `tsc` —— 等于任何从 GitHub 安装的人都能执行代码。所以铺它
  不需要 build 步骤，安装期也不会执行任何东西。这条对我们「本地 vendoring」的威胁模型正好对症。
- **它的 runtime 依赖是真的**，`@modelcontextprotocol/sdk` + `express` + `fast-xml-parser` 三个都要装；
  入库的 `dist/` 不自足，裸 checkout 上 `node dist/index.js` 会失败。所以 `github` kind 铺完克隆后
  还要装一次依赖。
- **MIT 是「声称」而非「提供」**：`package.json` 和几个目录站都写了 MIT，但仓库里没有 LICENSE 文件。

铺这一行**不要走 npm 的 GitHub 路径**（`npm install github:pkt-lab/mcp-svd#<sha>`），尽管那是上游
README 的写法。实测 npm 会去 `codeload.github.com` 拉 tarball（这一步成功，约 2s），然后**再无任何
进展** —— 没有 registry 请求、没有依赖解析、没有报错，`--loglevel=verbose` 也只停在那一行；
挂了 4 分钟以上仍无变化。这个卡死发生在 npm 内部，外部看不到原因，不是这个脚本能诊断或恢复的东西。
所以 `scripts/fetch-mcp.mjs` 自己用 git 分步取（每一步都是独立命令、退出码可查），取完**用
`git rev-parse HEAD` 反查实际 HEAD 是否真等于钉住的 sha** —— 「我要求了这个 sha」和「这棵树就是这个
sha」是两个不同的断言，只有后者值得写进 stamp。

克隆落在 vendor 根而不是嵌在 `node_modules/` 下，顺带复现了上游自己的目录布局，于是它 README 里
那套相对路径写法（`svd_file: "svd/STM32F411.svd"`）在这里就是对的。自带的 SVD 在
`.mcp-vendor/regmap/svd/`（STM32F411 / nRF52840 / rp2040）；**每次调用都必须显式给 `svd_file`，
没有默认值**，换成自己芯片的 CMSIS-SVD 即可。

### kicad：默认禁用，且它**不是** pin 工具族

上游 `mcp-server-kicad` 统一入口注册 109 个工具，但可以拆成 5 个子服务器；本行只起
`mcp-server-kicad-schematic`（42 个），因为工具面越小，占的上下文越少。

- 42 个里 **38 个直接读写 `.kicad_sch`，完全不需要装 KiCad**；只有 ERC / DRC / 导出那 4 个会去调
  `kicad-cli`，需要 KiCad 9.x 或 10.x。
- **它没有 pin 冲突检测**。schematic 子服务器里不存在 `detect_pin_conflicts` 或
  `analyze_pin_functions` —— 这两个名字一度被当作该仓库的工具写进评估，属于误信二手摘要，核对上游
  README 后已证伪。它是一个原理图**捕获层**工具（放置元件、连线、标网名、导出 BOM），和
  architecture 阶段的 pin 规划不是同一层的工件：那时手里还没有 `.kicad_sch`。
- 所以该行 `disabled: true`，**仅仅**在项目真的有一张 KiCad 原理图要处理时才启用。

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
| `cordis.patch.yml` | 仓库根 | ① 插入 `se-skills` provider（id `se-skills`）到 host plane 的全局技能层；② 插入 `dsh-se-skills` 插件；③ 插入五个 MCP server 行 |
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

## 工具定义规则

`lib/tools/` 里的工具走**原生注册**（`ctx.tools.register()`），不经过 MCP。理由是 dsh 内部
所有工具最终都落在同一张注册表里 —— `dsh-mcp-client` 桥接 MCP 工具时用的也是它
（该包的 `inject = ["tools"]`）。为自研工具再套一层 MCP，只会多一个进程、一次 JSON-RPC 跳转
和一套与 SE 无关的 schema 方言，换不到任何东西。

代价是必须遵守 `register()` 的强校验。以下每一条都是**运行期**才生效的，违反即抛：

| 要求 | 说明 |
|------|------|
| `output` 必须是 `{ schema, render }` 且 `render` 是函数 | 缺了直接 `TypeError`（`dsh-tools` register 的第一道校验） |
| `output.schema` 只能用受限子集 | 关键字：`type` / `oneOf` / `properties` / `required` / `additionalProperties` / `items` / `enum` / `const` + 注解 `description` / `title` / `default` / `examples` |
| 子集之外一概不支持 | 没有 `$ref` / `anyOf` / `allOf` / `minimum` / `maximum` / `pattern` / `format`；`type` 必须是单个字符串（不接受 type 数组） |
| `oneOf` 至少两项，且不能与 `properties`/`required`/`items`/`enum`/`const` 同级 | 与 `description` 同级是允许的 |
| `required` 必须都是已声明的 `properties` | `additionalProperties` 只能写布尔 |
| `execute()` 的返回值会按 `output.schema` 校验 | 不符即 `ToolOutputError`。所以声明了 `additionalProperties: false` 就必须**逐键对齐** |
| 返回值在 `render` 之前被 deepFreeze | `render` 里不得改动 `value` |
| 工具名不能是 `run_code` | 保留给 PTC 模式的呈现通道 |

**怎么确认这些规则还对得上。** `${APPDATA}/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`
是权威来源：`CONSTRAINT_KEYWORDS` / `ANNOTATION_KEYWORDS` / `SCHEMA_TYPES` 在文件头部，
`checkSchemaNode` 与 `register()` 在其后。本仓库把规则复刻在 `scripts/dsh-tool-rules.mjs`，
dsh 升级后回来比一遍，两边不一致就更新复刻器（复刻不等于等价，它只覆盖上面那张表）。

### 单位与量纲的约定

`se_budget_*` 三兄弟共用一个横切层 `lib/tools/units.js`，其中两条是刻意的取舍：

- **字节与比特按书写方式区分**：`B/KB/MB/GB` 是十进制，`KiB/MiB/GiB` 是二进制；
  速率一律把斜杠写全（`MB/s` 是字节、`Mbps` 是比特）。**不提供 `MBps` 这类缩写别名**，
  因为它与 `Mbps` 只差大小写，收进来就等于替调用方在 8 倍上赌一把。小写 `b` 直接报歧义。
- **温度不参与换算**：°C↔K 是仿射关系，用「乘系数」处理会静默算错。要温度就写文本。

另外，别名的解析必须落到**规范名**而不是停在别名上：`µs` 若只映射到「time 量纲」却不到 `us`，
下游按 `units['µs']` 查系数会拿到 `undefined`，再被「拿不到系数就当 1」的兜底吞掉 ——
`500 µs` 会静默变成 `500 s`。这个坑真实踩到过，所以 `unitFactor()` 现在拿不到系数就直接抛。

## 校验

```bash
npm run validate              # 结构、frontmatter、命名冲突、bundle patch、MCP 配方、工具定义
npm run validate -- --strict  # CI：warning 也算失败
npm run smoke                 # 功能冒烟：真跑一遍 apply() 与三个工具，含反向对照
npm run verify                # 上面两步串起来
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
| `--only <id>` 报 unknown | id 只有 `drawio` / `math` / `regmap` / `kicad` / `visio`，清单在 `mcp/servers.json` |
| 同一个技能名出现两次 | `skills/`、`commands/`、`agents/` 三处共用一套命名空间；`npm run validate` 会报重名 |
| 某个 `se_budget_*` 工具不见了 | 单个工具注册失败不会带走整个插件，host 日志里会有 `se-skills: tool "..." was not registered: ...`。先跑 `npm run validate`，它按同样的规则静态查一遍 |
| 工具调用报 `ToolOutputError` | 返回结构与 `output.schema` 对不上（多一个键就会被 `additionalProperties: false` 逮到）。`npm run smoke` 会用真 registry 复现 |
| `fetch-mcp` 报 `EPERM` 后长时间无输出 | 写入被拦。换一个没有文件写入限制的终端重跑；这不是网络问题，也不是版本问题 |
| `regmap` 报 `checked out <x>, expected <sha>` | 取到的 HEAD 与钉住的 commit 不一致，脚本主动拒绝铺这份副本（宁可失败也不铺错的版本）。通常是镜像/代理改写了内容，或 `servers.json` 里的 commit 被改过 |
| `kicad` 报 `has no entry point` | venv 里没生成 `mcp-server-kicad-schematic` 这个 console script —— 上游改了 entry point 名，或装到了别的包。重铺：`node scripts/fetch-mcp.mjs --only kicad --clean` |
| `regmap` 的工具调用说找不到 SVD | 每次调用都要显式给 `svd_file`，没有默认值。自带的在 `.mcp-vendor/regmap/svd/`；自己的芯片要另外给路径。上游没有 SVD 的芯片，这一行帮不上 |
