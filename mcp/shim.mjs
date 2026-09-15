#!/usr/bin/env node
/**
 * se-skills MCP 启动垫片（launcher shim）。
 *
 * 每个第三方 MCP 行的 `command` 都是同一个 node（`process.execPath`），第一参数
 * 是本文件、第二参数是服务器 id。垫片按 `mcp/servers.json` 决定实际跑什么：
 *
 *   1. `.mcp-vendor/<id>/` 里有本地副本 → 直接跑本地副本（`scripts/fetch-mcp.mjs` 铺好之后）
 *   2. 没有 → 回落到声明的包运行器（npx / uvx）
 *   3. 两者都不行 → 往 stderr 打诊断并以非零码退出
 *
 * 为什么要有这一层，而不是在 cordis.patch.yml 里写 `!!js` 三元：
 *   - `!!js` 三元得把「存在性判断」抄三遍（command 一次、args 一次、每行一次），
 *     逻辑散在 YAML 里无法单测；
 *   - 子进程起不来时 MCP 侧的报错只有一句 spawn 失败，没有「为什么不走本地副本」；
 *   - 垫片提供 `--print` / `--list` 体检入口（`mcp.cmd doctor` 之类），这是可诊断性。
 *
 * 关键约束：**stdout 是 JSON-RPC 通道，本文件在转发模式下不得写 stdout**。
 * 所有日志走 stderr。子进程用 `stdio: 'inherit'`，直接继承宿主给本进程的管道 ——
 * 也就是说垫片是「透传父进程」而不是「代理」，协议消息不经过本进程内存，零拷贝。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const MANIFEST_PATH = join(HERE, 'servers.json')

// 注意：垫片不再从 PATH 上找 `python`。vendored 的 Python 服务器跑自己 venv 里的
// 解释器（见 venvPythonPath），解释器版本随环境一起被钉住；没有 venv 就直接回落
// uvx，由 uv 自己保证解释器。唯一还需要挑解释器的地方是 scripts/fetch-mcp.mjs 的
// `--python` / `SE_SKILLS_PYTHON` —— 那回答的是「用哪个 python 去建这个 venv」。

function log(message) {
  process.stderr.write(`se-skills/mcp: ${message}\n`)
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`manifest not found: ${MANIFEST_PATH}`)
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

function serverById(manifest, id) {
  const server = manifest.servers.find((entry) => entry.id === id)
  if (!server) {
    const known = manifest.servers.map((entry) => entry.id).join(', ')
    throw new Error(`unknown MCP server "${id}" — known ids: ${known}`)
  }
  return server
}

/**
 * 读 `scripts/fetch-mcp.mjs` 落下的 stamp，用于把「本地副本是用哪个解释器铺的」
 * 写进诊断行。缺失或损坏时返回 undefined —— 这只是诊断信息，不是判据。
 */
function readStamp(vendorRoot) {
  const file = join(vendorRoot, '.se-skills-vendor.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 用**运行时**解释器真的 import 一次入口模块。
 *
 * 为什么必须实测而不是比版本号：`.mcp-vendor/math/python` 里带着 cp313 的二进制
 * 扩展（pydantic_core / regex / pywin32），而 dsh spawn 用的 `python` 未必是铺副本
 * 那一个 —— 本仓库的构建机上 `python` 是 3.13，dsh 的系统 PATH 上很可能是 3.14，
 * 那种组合下 import 会直接炸。版本号对不上要拦，但真正该问的问题只有一个：
 * 「这个解释器起不起得来」。import 成功即通过；失败就回落到 uvx，并把 stderr
 * 末尾一行带进诊断，省得为一句 "spawn failed" 去猜。
 */
function probeImport(pythonPath, moduleName) {
  const outcome = spawnSync(pythonPath, ['-c', `import ${moduleName}`], {
    // 不用 -I / -E：那会连 PYTHONPATH 一起忽略，探测就失去意义。
    encoding: 'utf8',
    timeout: 20000,
  })
  if (outcome.error) return { ok: false, detail: outcome.error.message }
  if (outcome.status === 0) return { ok: true }
  const tail = String(outcome.stderr ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop()
  return { ok: false, detail: tail ?? `exit ${outcome.status}` }
}

/**
 * 决定一个服务器该怎么跑。
 * @returns 计划：mode 为 `vendored` 或 `fallback`，附 command/args/env/cwd 与诊断行。
 */
/** 本地 Python 环境的解释器路径（venv 的跨平台布局不同）。 */
function venvPythonPath(vendorRoot) {
  return process.platform === 'win32'
    ? join(vendorRoot, 'venv', 'Scripts', 'python.exe')
    : join(vendorRoot, 'venv', 'bin', 'python')
}

/**
 * 本地 Python 环境里一个 console script 的路径。
 *
 * 为什么不是所有 Python 服务器都能用 `python -m <module>` 起：pip 的 console_scripts
 * 入口点（`mcp-server-kicad-schematic` 这类）生成的是**包装脚本**，不是可 import 的模块，
 * 没有稳定的 `-m` 名字可用。Windows 上 pip 还会补 `.exe` 后缀，所以路径按平台分叉。
 */
function venvScriptPath(vendorRoot, script) {
  const isWindows = process.platform === 'win32'
  return join(vendorRoot, 'venv', isWindows ? 'Scripts' : 'bin', isWindows ? `${script}.exe` : script)
}

function resolvePlan(manifest, server) {
  const vendorRoot = join(PACKAGE_ROOT, manifest.vendorDir, server.id)
  const plan = {
    id: server.id,
    mode: 'fallback',
    command: server.fallback.command,
    args: [...server.fallback.args],
    env: {},
    cwd: '',
    vendorRoot,
    vendored: false,
    notes: [],
    problems: [],
  }

  if (server.disabledReason) plan.notes.push(server.disabledReason)

  if (!server.vendor) {
    plan.notes.push('no vendorable upstream — this row always uses its fallback runner')
    return plan
  }

  // `github` 与 `npm` 在**启动方式**上是同一件事：都是 `node <entry 文件>`，entry 相对
  // vendor 根解析。两者只在「怎么把这个副本铺下来」上有区别（registry tarball vs 按 sha
  // 浅取上游工作树），而那是 `scripts/fetch-mcp.mjs` 的事。所以这里不分支，只认 entry。
  if (server.vendor.kind === 'npm' || server.vendor.kind === 'github') {
    const entry = join(vendorRoot, server.vendor.entry)
    if (existsSync(entry)) {
      plan.mode = 'vendored'
      plan.vendored = true
      plan.command = process.execPath
      plan.args = [entry]
      // cwd 落在 vendor 根上：上游若按相对路径取自带的数据文件（mcp-svd 的
      // `svd_file: "svd/STM32F411.svd"` 就是这样），相对基准必须和它的安装布局一致。
      plan.cwd = vendorRoot
    } else {
      plan.problems.push(`vendored copy missing: ${entry}`)
    }
    return plan
  }

  if (server.vendor.kind === 'pypi') {
    // 用 venv 而不是 `pip install --target`：--target 装 pywin32 是坏的 —— pywin32
    // 靠 .pth 文件把它的 DLL 目录挂进 sys.path，而 .pth 只在解释器已知的 site 目录
    // 里才会被处理，`--target` + PYTHONPATH 不满足这个前提，于是 import 报
    // "No module named 'pywintypes'"，且报错落在 mcp SDK 深处，很难指回原因。
    // venv 的 site-packages 是真正的 site 目录，.pth 正常工作；顺带把解释器版本
    // 钉死（venv 自带解释器），ABI 不再可能对不上。
    const venvPython = venvPythonPath(vendorRoot)
    if (!existsSync(venvPython)) {
      plan.problems.push(`vendored environment missing: ${venvPython}`)
      return plan
    }
    const probe = server.vendor.probe
    if (probe) {
      const outcome = probeImport(venvPython, probe)
      if (!outcome.ok) {
        const stamp = readStamp(vendorRoot)
        const built = stamp?.python
          ? ` (built with Python ${stamp.python.version} at ${stamp.python.executable})`
          : ''
        plan.problems.push(
          `vendored environment unusable: cannot import ${probe}${built} — falling back. ` +
            `Rebuild it with \`node scripts/fetch-mcp.mjs --only ${server.id}\`. Cause: ${outcome.detail}`,
        )
        return plan
      }
    }
    // 入口有两种形态，取决于上游怎么发布：
    //   - `module`（gnomon-mcp 这类）：`python -m <module>`，模块名是上游 API 的一部分；
    //   - `script`（mcp-server-kicad 这类）：pip 生成的 console script，没有可 `-m` 的名字。
    // 声明了 script 就**检查那个文件真的在**：pip 铺完 venv 而入口点没生成（装错包、
    // 上游改了 entry point 名）时，`python -m mcp_server_kicad` 会以 AttributeError 之类的
    // 面目失败，指向不了真正的原因。存在性检查在这里比 import 探测更贴近「我们要起什么」。
    if (server.vendor.script) {
      const scriptPath = venvScriptPath(vendorRoot, server.vendor.script)
      if (!existsSync(scriptPath)) {
        plan.problems.push(
          `vendored environment has no entry point: ${scriptPath} — the console script ` +
            `"${server.vendor.script}" was not generated. Rebuild it with ` +
            `\`node scripts/fetch-mcp.mjs --only ${server.id}\`.`,
        )
        return plan
      }
      plan.mode = 'vendored'
      plan.vendored = true
      plan.command = scriptPath
      plan.args = []
    } else {
      plan.mode = 'vendored'
      plan.vendored = true
      plan.command = venvPython
      plan.args = ['-m', server.vendor.module]
    }
    plan.env.PYTHONDONTWRITEBYTECODE = '1'
    plan.cwd = vendorRoot
    return plan
  }

  plan.problems.push(`unsupported vendor kind: ${server.vendor.kind}`)
  return plan
}

function describe(plan) {
  const detail = plan.mode === 'vendored' ? 'local copy' : 'fallback runner'
  return `${plan.id}: ${plan.mode} (${detail}) -> ${plan.command} ${plan.args.join(' ')}`
}

function main() {
  const argv = process.argv.slice(2)
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
  const positional = argv.filter((arg) => !arg.startsWith('--'))

  let manifest
  try {
    manifest = loadManifest()
  } catch (error) {
    log(`cannot read servers.json: ${error.message}`)
    process.exit(78)
  }

  if (flags.has('--list')) {
    const plans = manifest.servers.map((server) => {
      try {
        return resolvePlan(manifest, server)
      } catch (error) {
        return { id: server.id, mode: 'error', notes: [error.message], problems: [] }
      }
    })
    process.stdout.write(`${JSON.stringify({ packageRoot: PACKAGE_ROOT, vendorDir: manifest.vendorDir, plans }, null, 2)}\n`)
    return
  }

  const id = positional[0]
  if (!id) {
    log('usage: node mcp/shim.mjs <server-id> [--print] | --list')
    process.exit(64)
  }

  let plan
  try {
    plan = resolvePlan(manifest, serverById(manifest, id))
  } catch (error) {
    log(error.message)
    process.exit(64)
  }

  if (flags.has('--print')) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return
  }

  for (const note of plan.notes) log(`${id}: ${note}`)
  for (const problem of plan.problems) log(`${id}: ${problem}`)
  log(describe(plan))

  const child = spawn(plan.command, plan.args, {
    stdio: 'inherit',
    // 本进程的环境已经是 dsh 净化过的父环境，叠加计划里的覆盖项。
    env: { ...process.env, ...plan.env },
    ...(plan.cwd ? { cwd: plan.cwd } : {}),
    windowsHide: true,
  })

  const forward = (signal) => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))

  child.on('error', (error) => {
    log(`${id}: cannot start "${plan.command}": ${error.message}`)
    if (error.code === 'ENOENT') {
      log(`${id}: "${plan.command}" is not on PATH — install it, or run \`node scripts/fetch-mcp.mjs --only ${id}\` to vendor a local copy`)
    }
    process.exit(127)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      log(`${id}: server terminated by ${signal}`)
      process.exit(1)
    }
    process.exit(code ?? 1)
  })
}

main()
