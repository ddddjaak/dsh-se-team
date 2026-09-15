#!/usr/bin/env node
/**
 * Vendor the third-party MCP servers this plugin ships rows for.
 *
 * Reads `mcp/servers.json` and materialises each server that declares a
 * `vendor` block into `.mcp-vendor/<id>/` (gitignored). `mcp/shim.mjs` then
 * prefers that local copy over the npx/uvx fallback, so an installed profile
 * keeps working with no network access.
 *
 * Three vendor kinds, one per way an upstream is distributed:
 *
 *   - `npm`     registry tarball at an exact version (`--prefix` + `pkg@1.2.3`).
 *   - `github`  a shallow `git fetch` of one pinned commit, for upstreams that
 *               publish nowhere else, followed by a registry install of that
 *               tree's own runtime dependencies. Launches as `node <entry>`, so
 *               the shim does not distinguish it from `npm`.
 *   - `pypi`    a venv at an exact version, launched either as `-m <module>` or
 *               as a pip-generated console `script`.
 *
 * Dependency-free on purpose: node: builtins only, so it runs from a fresh
 * clone with nothing installed. The heavy lifting is delegated to npm and pip,
 * which the caller already needs to have.
 *
 * Two mechanisms worth knowing about:
 *
 *   - npm is invoked as `node <npm-cli.js>` rather than through a shell.
 *     `shell: true` would let cmd.exe read the `<` in a constraint like `mcp<2`
 *     as a redirection operator, silently mangling the command line.
 *
 *   - Python servers get a venv, NOT `pip install --target`. pywin32 (pulled in
 *     by the MCP SDK on Windows) registers its DLL directory through `.pth`
 *     files, and `.pth` files are only processed for site directories the
 *     interpreter knows about — a `--target` directory on PYTHONPATH does not
 *     qualify, so the install "succeeds" and then fails at import with
 *     "No module named 'pywintypes'". A venv is a real site directory, and it
 *     also pins the interpreter, so the ABI cannot drift from what was built.
 *
 * Usage:
 *   node scripts/fetch-mcp.mjs                 # vendor every server, verify each
 *   node scripts/fetch-mcp.mjs --only math     # one server
 *   node scripts/fetch-mcp.mjs --check         # verify only, never run npm/pip
 *   node scripts/fetch-mcp.mjs --clean         # remove the vendored copies first
 *   node scripts/fetch-mcp.mjs --python <exe>  # interpreter used to build the venv
 *   node scripts/fetch-mcp.mjs --dry-run       # print the commands, run nothing
 *
 * Timeouts are explicit: installs get SE_SKILLS_INSTALL_TIMEOUT_MS (default
 * 600000), git gets SE_SKILLS_GIT_TIMEOUT_MS (default 300000). Generous on
 * purpose — a premature kill reports a network problem that does not exist —
 * but they exist because npm was observed to stall forever without one.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'))
const MANIFEST_PATH = join(ROOT, 'mcp', 'servers.json')
const IS_WINDOWS = process.platform === 'win32'
const STAMP_NAME = '.se-skills-vendor.json'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

const ONLY = valueOf('--only')
const CHECK_ONLY = has('--check')
const CLEAN = has('--clean')
const DRY_RUN = has('--dry-run')
const PYTHON = valueOf('--python') || process.env.SE_SKILLS_PYTHON || 'python'

const results = []
const missing = []

function report(id, status, detail) {
  results.push({ id, status, detail })
  console.log(`  ${id.padEnd(8)} ${status.padEnd(10)} ${detail}`)
}

// A package manager that has stopped making progress must not become this
// script's problem. `spawnSync` without a timeout waits forever, and npm was
// observed to stall indefinitely — no output, no error, no exit — on its GitHub
// route. The budget is explicit rather than implied by whoever is watching.
const INSTALL_TIMEOUT_MS = Number(process.env.SE_SKILLS_INSTALL_TIMEOUT_MS) || 600000

/**
 * Run a command with our stdio inherited. Returns a bounded outcome: a command
 * that stops responding is killed and reported, never waited on forever.
 */
function run(command, args, timeoutMs = INSTALL_TIMEOUT_MS) {
  const printable = [command, ...args].join(' ')
  if (DRY_RUN) {
    console.log(`  $ ${printable}`)
    return { ok: true, dryRun: true }
  }
  const outcome = spawnSync(command, args, { stdio: 'inherit', shell: false, timeout: timeoutMs })
  if (outcome.error) {
    // spawnSync reports a timeout as an ETIMEDOUT error, not a signal, so a
    // stall would otherwise be indistinguishable from a launch failure.
    return {
      ok: false,
      detail:
        outcome.error.code === 'ETIMEDOUT'
          ? `killed after ${Math.round(timeoutMs / 1000)}s with no progress`
          : outcome.error.message,
    }
  }
  if (outcome.status !== 0) return { ok: false, detail: `exited with code ${outcome.status}` }
  return { ok: true }
}

// git process startup on the reference machine is measured in seconds, and a
// shallow fetch took 22s. Generous on purpose: a premature timeout would report
// "clone failed" for a clone that was merely slow, and the caller would go
// looking for a network problem that does not exist.
const GIT_TIMEOUT_MS = Number(process.env.SE_SKILLS_GIT_TIMEOUT_MS) || 300000

/**
 * Run a command and capture its output instead of inheriting our stdio.
 *
 * Used for the git plumbing, where what matters is the exit status and one line
 * of stdout (the resolved commit). git writes progress to stderr, which would
 * otherwise bury this script's own report; the last stderr line is kept for the
 * failure message, which is where git puts the actual reason.
 */
function runCapture(command, args) {
  if (DRY_RUN) {
    console.log(`  $ ${[command, ...args].join(' ')}`)
    return { ok: true, dryRun: true, stdout: '', stderr: '' }
  }
  const outcome = spawnSync(command, args, { encoding: 'utf8', shell: false, timeout: GIT_TIMEOUT_MS })
  const stdout = String(outcome.stdout ?? '')
  const stderr = String(outcome.stderr ?? '')
  if (outcome.error) return { ok: false, detail: outcome.error.message, stdout, stderr }
  if (outcome.status !== 0) {
    const tail = stderr.trim().split('\n').filter(Boolean).pop()
    return { ok: false, detail: tail ?? `exited with code ${outcome.status}`, stdout, stderr }
  }
  return { ok: true, stdout, stderr }
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

/** Where the venv interpreter lives (the layout differs across platforms). */
function venvPythonPath(vendorRoot) {
  return IS_WINDOWS ? join(vendorRoot, 'venv', 'Scripts', 'python.exe') : join(vendorRoot, 'venv', 'bin', 'python')
}

/**
 * Where a pip-generated console script lives. Some upstreams (mcp-server-kicad)
 * publish their sub-servers as entry points rather than importable modules, so
 * there is no `-m` name to use — the entry point file IS the server.
 */
function venvScriptPath(vendorRoot, script) {
  return join(vendorRoot, 'venv', IS_WINDOWS ? 'Scripts' : 'bin', IS_WINDOWS ? `${script}.exe` : script)
}

/**
 * How to invoke npm without a shell: prefer npm's own entry script, run by the
 * same node that is running this script. Anything the user overrides with
 * `--npm` is either a script (run with node) or an executable (run directly).
 */
function npmInvocation() {
  const override = valueOf('--npm') || process.env.SE_SKILLS_NPM
  if (override) {
    return override.endsWith('.js')
      ? { command: process.execPath, args: [override] }
      : { command: override, args: [] }
  }
  const nodeDir = dirname(process.execPath)
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: process.execPath, args: [candidate] }
  }
  return { command: IS_WINDOWS ? 'npm.cmd' : 'npm', args: [] }
}

/**
 * The file whose absence means "this row is not vendored", computed the same way
 * the shim computes it. Deliberately the *launch target*, not "the directory
 * exists" — a directory that is present but has no usable entry point is the
 * failure mode this whole machinery exists to catch.
 */
function localCopyPath(manifest, server) {
  if (!server.vendor) return undefined
  const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
  if (server.vendor.kind === 'npm' || server.vendor.kind === 'github') {
    return join(vendorRoot, server.vendor.entry)
  }
  if (server.vendor.kind === 'pypi') {
    return server.vendor.script
      ? venvScriptPath(vendorRoot, server.vendor.script)
      : venvPythonPath(vendorRoot)
  }
  return undefined
}

/** Probe an import with the venv's own interpreter. */
function probeImport(pythonPath, moduleName) {
  const outcome = spawnSync(pythonPath, ['-c', `import ${moduleName}`], { encoding: 'utf8', timeout: 20000 })
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
 * Verify a vendored copy the way the shim will use it. Two layers, because
 * existence alone is not enough:
 *
 *   1. the launch target must exist (entry file / venv script / venv python);
 *   2. for a Python row declaring a `probe`, the venv interpreter must really be
 *      able to import it. A tree built against a different interpreter exists
 *      and is still broken, so the probe is run with the venv's own python —
 *      never the one that built it, and never the bare `python` on PATH.
 */
function verify(manifest, server) {
  const target = localCopyPath(manifest, server)
  if (!target) return { ok: false, detail: 'no vendor block (opt-in row)' }
  const shown = relative(ROOT, target).split(sep).join('/')
  if (!existsSync(target)) return { ok: false, detail: `missing ${shown}` }

  const probe = server.vendor.probe
  if (server.vendor.kind === 'pypi' && probe) {
    const venvPython = venvPythonPath(join(ROOT, manifest.vendorDir, server.id))
    if (!existsSync(venvPython)) return { ok: false, detail: `missing ${relative(ROOT, venvPython).split(sep).join('/')}` }
    const outcome = probeImport(venvPython, probe)
    if (!outcome.ok) return { ok: false, detail: `${shown} exists but cannot import ${probe} — ${outcome.detail}` }
  }
  return { ok: true, detail: shown }
}

/** Refuse to delete anything outside <root>/<vendorDir>/<id>. */
function assertInsideVendorRoot(target, vendorDirName) {
  const vendorRoot = resolve(ROOT, vendorDirName)
  const rel = relative(vendorRoot, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to touch ${target}: outside ${vendorRoot}`)
  }
}

/** Ask a Python interpreter to describe itself, for the stamp. */
function describePython(interpreter) {
  const probed = spawnSync(
    interpreter,
    [
      '-c',
      "import json,sys;print(json.dumps({'executable':sys.executable,'version':sys.version,'abi':sys.implementation.cache_tag}))",
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  try {
    return JSON.parse(String(probed.stdout ?? '').trim())
  } catch {
    return { executable: interpreter, version: 'unknown', abi: 'unknown' }
  }
}

/**
 * Record what the local copy was built from, so a mismatch is diagnosable later.
 *
 * The Python self-description is only collected for Python rows. Asking a node
 * executable to run `import sys` returns a parse failure, which previously got
 * written out as a fake `python: {version: "unknown"}` block — a stamp that lies
 * is worse than no stamp.
 */
function writeStamp(vendorRoot, server, interpreter) {
  if (DRY_RUN) return
  const stamp = {
    generatedBy: 'scripts/fetch-mcp.mjs',
    kind: server.vendor.kind,
    package: server.vendor.package,
    version: server.vendor.version,
    license: server.license,
    interpreter,
    builtAt: new Date().toISOString(),
  }
  if (server.vendor.kind === 'github') {
    stamp.repo = server.vendor.repo
    stamp.commit = server.vendor.commit
  }
  if (server.vendor.kind === 'pypi') stamp.python = describePython(interpreter)
  else stamp.node = process.version
  writeFileSync(join(vendorRoot, STAMP_NAME), `${JSON.stringify(stamp, null, 2)}\n`, 'utf8')
}

function vendorNpm(manifest, server) {
  const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
  if (!DRY_RUN) mkdirSync(vendorRoot, { recursive: true })
  // --prefix keeps the install inside our tree; --omit=dev because an MCP
  // server never needs its devDependencies at runtime; --no-save because there
  // is no package.json of ours to record it in (servers.json is the record).
  const invocation = npmInvocation()
  const args = [
    ...invocation.args,
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--no-save',
    '--prefix',
    vendorRoot,
    `${server.vendor.package}@${server.vendor.version}`,
  ]
  const outcome = run(invocation.command, args)
  if (!outcome.ok) return outcome
  if (outcome.dryRun) return outcome
  writeStamp(vendorRoot, server, process.execPath)
  return verify(manifest, server)
}

/**
 * Vendor a server that publishes nowhere except GitHub.
 *
 * Deliberately NOT `npm install github:owner/repo#<sha>`, even though that is the
 * documented upstream route and npm accepts the spec. On the reference toolchain
 * it stalls: npm resolves a GitHub spec by downloading a codeload tarball (that
 * request succeeds, ~2s) and then makes no further progress — no registry
 * request, no dependency resolution, no error — for as long as you are willing
 * to wait. Observed at over four minutes and killed, with `--loglevel=verbose`
 * showing nothing after the successful tarball fetch. Nothing about that failure
 * is visible from outside npm, so it is not something this script can diagnose.
 *
 * So the fetch is done here with git, where every step is a separate command
 * with a checkable exit status, and the pinned sha is verified against the
 * checkout afterwards. The result is a plain working tree, so the runtime
 * dependencies are then installed in place from the registry — the same
 * `npm install` path the other rows already use, and the one that works.
 *
 * Cloning to the vendor root rather than nesting under `node_modules/` also
 * reproduces upstream's own layout, so relative paths a server takes as arguments
 * (mcp-svd's `svd_file: "svd/STM32F411.svd"`) resolve the way its README says.
 */
function vendorGithub(manifest, server) {
  const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
  const { repo, commit } = server.vendor

  if (!DRY_RUN) mkdirSync(vendorRoot, { recursive: true })

  // `fetch --depth 1 origin <sha>` is the only way to land on a single commit
  // without downloading history, and it works on a freshly `init`ed tree — which
  // is why this is not just `git clone --branch` (that takes a branch or tag
  // name, and this upstream has neither).
  const steps = [
    ['init', vendorRoot],
    ['-C', vendorRoot, 'remote', 'add', 'origin', `https://github.com/${repo}.git`],
    ['-C', vendorRoot, 'fetch', '--depth', '1', 'origin', commit],
    ['-C', vendorRoot, 'checkout', '--detach', 'FETCH_HEAD'],
  ]
  for (const args of steps) {
    const outcome = runCapture('git', args)
    if (!outcome.ok) return { ok: false, detail: `git ${args.join(' ')} failed: ${outcome.detail}` }
    if (outcome.dryRun) return outcome
  }

  // The receipt. "I asked for this sha" is not the same claim as "this tree is
  // that sha", and only the second one is worth putting in the stamp.
  const head = runCapture('git', ['-C', vendorRoot, 'rev-parse', 'HEAD'])
  if (!head.ok) return { ok: false, detail: `cannot read the checked-out commit: ${head.detail}` }
  const actual = head.stdout.trim()
  if (actual !== commit) {
    return { ok: false, detail: `checked out ${actual}, expected ${commit} — refusing to vendor the wrong revision` }
  }

  const invocation = npmInvocation()
  const installed = run(invocation.command, [
    ...invocation.args,
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--prefix',
    vendorRoot,
  ])
  if (!installed.ok) {
    return { ok: false, detail: `dependency install failed: ${installed.detail ?? 'see the npm output above'}` }
  }
  if (installed.dryRun) return installed

  // Drop the fetched history. At this point the tree is build output, and a
  // nested .git inside a gitignored directory is a foot-gun that buys nothing.
  rmSync(join(vendorRoot, '.git'), { recursive: true, force: true })

  writeStamp(vendorRoot, server, process.execPath)
  return verify(manifest, server)
}

/** How a row's pin is shown in reports: `pkg@1.2.3`, or `owner/repo@<sha12>` for GitHub sources. */
function pinLabel(server) {
  const v = server.vendor
  return v.kind === 'github' ? `${v.repo}@${String(v.commit).slice(0, 12)}` : `${v.package}@${v.version}`
}

function vendorPypi(manifest, server) {
  const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
  const venvRoot = join(vendorRoot, 'venv')
  const venvPython = venvPythonPath(vendorRoot)
  if (!DRY_RUN) mkdirSync(vendorRoot, { recursive: true })

  const created = run(PYTHON, ['-m', 'venv', venvRoot])
  if (!created.ok) return created
  if (created.dryRun) return created

  const installed = run(venvPython, [
    '-m',
    'pip',
    'install',
    '--upgrade',
    '--no-compile',
    '--no-warn-script-location',
    '--disable-pip-version-check',
    ...(server.vendor.constraints ?? []),
    `${server.vendor.package}==${server.vendor.version}`,
  ])
  if (!installed.ok) return installed
  if (installed.dryRun) return installed

  writeStamp(vendorRoot, server, venvPython)
  return verify(manifest, server)
}

function main() {
  const manifest = readManifest()
  console.log(`Vendoring MCP servers into ${manifest.vendorDir}/ under ${ROOT}`)
  if (DRY_RUN) console.log('(dry run — no commands will be executed)')
  if (CHECK_ONLY) console.log('(check only — npm and pip will not be invoked)')

  const targets = ONLY ? manifest.servers.filter((server) => server.id === ONLY) : manifest.servers
  if (targets.length === 0) {
    console.error(`\nunknown --only "${ONLY}" — known ids: ${manifest.servers.map((s) => s.id).join(', ')}`)
    process.exit(2)
  }

  for (const server of targets) {
    console.log(`\n[${server.id}] ${server.summary}`)

    if (!server.vendor) {
      report(server.id, 'opt-in', server.disabledReason ?? 'no vendor block declared')
      continue
    }

    const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
    assertInsideVendorRoot(vendorRoot, manifest.vendorDir)

    if (CLEAN && existsSync(vendorRoot)) {
      console.log(`  removing ${relative(ROOT, vendorRoot).split(sep).join('/')}`)
      if (!DRY_RUN) rmSync(vendorRoot, { recursive: true, force: true })
    }

    if (CHECK_ONLY) {
      const state = verify(manifest, server)
      report(server.id, state.ok ? 'present' : 'missing', state.detail)
      if (!state.ok) missing.push(server.id)
      continue
    }

    const vendoring = { npm: vendorNpm, github: vendorGithub, pypi: vendorPypi }[server.vendor.kind]
    const outcome = vendoring
      ? vendoring(manifest, server)
      : { ok: false, detail: `unsupported vendor kind "${server.vendor.kind}"` }
    if (outcome.dryRun) {
      report(server.id, 'dry-run', `would vendor ${pinLabel(server)}`)
    } else if (outcome.ok) {
      report(server.id, 'vendored', `${outcome.detail}  (${pinLabel(server)}, ${server.license})`)
    } else {
      report(server.id, 'FAILED', outcome.detail)
    }
  }

  console.log('\nSummary')
  for (const entry of results) console.log(`  ${entry.id.padEnd(8)} ${entry.status.padEnd(10)} ${entry.detail}`)

  const failed = results.filter((entry) => entry.status === 'FAILED')
  if (failed.length > 0) {
    console.log(
      `\nFAIL — ${failed.length} server(s) could not be vendored. Those rows still work through the npx/uvx fallback when the network is up.`,
    )
    process.exit(1)
  }
  if (missing.length > 0) {
    console.log(`\nMISSING — ${missing.length} server(s) are not vendored yet: ${missing.join(', ')}`)
    console.log('Run `node scripts/fetch-mcp.mjs` with no flags to fetch them, or ignore this — the rows fall back to npx/uvx while online.')
    process.exit(1)
  }
  console.log('\nOK — the shim now prefers the local copies. Restart the dsh service to pick them up.')
}

main()
