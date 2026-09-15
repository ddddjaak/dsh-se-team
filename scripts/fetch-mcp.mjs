#!/usr/bin/env node
/**
 * Vendor the third-party MCP servers this plugin ships rows for.
 *
 * Reads `mcp/servers.json` and materialises each server that declares a
 * `vendor` block into `.mcp-vendor/<id>/` (gitignored). `mcp/shim.mjs` then
 * prefers that local copy over the npx/uvx fallback, so an installed profile
 * keeps working with no network access.
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

function run(command, args) {
  const printable = [command, ...args].join(' ')
  if (DRY_RUN) {
    console.log(`  $ ${printable}`)
    return { ok: true, dryRun: true }
  }
  const outcome = spawnSync(command, args, { stdio: 'inherit', shell: false })
  if (outcome.error) return { ok: false, detail: outcome.error.message }
  if (outcome.status !== 0) return { ok: false, detail: `exited with code ${outcome.status}` }
  return { ok: true }
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

/** Where the venv interpreter lives (the layout differs across platforms). */
function venvPythonPath(vendorRoot) {
  return IS_WINDOWS ? join(vendorRoot, 'venv', 'Scripts', 'python.exe') : join(vendorRoot, 'venv', 'bin', 'python')
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

/** What the shim will test for, computed the same way the shim computes it. */
function localCopyPath(manifest, server) {
  if (!server.vendor) return undefined
  const vendorRoot = join(ROOT, manifest.vendorDir, server.id)
  if (server.vendor.kind === 'npm') return join(vendorRoot, server.vendor.entry)
  if (server.vendor.kind === 'pypi') return venvPythonPath(vendorRoot)
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
 * Verify a vendored copy the way the shim will use it: the entry must exist and,
 * for a Python server that declares a probe, the venv interpreter must be able
 * to import it. Existence alone is not enough — a copy built against a
 * different interpreter exists and is still broken.
 */
function verify(manifest, server) {
  const target = localCopyPath(manifest, server)
  if (!target) return { ok: false, detail: 'no vendor block (opt-in row)' }
  const shown = relative(ROOT, target).split(sep).join('/')
  if (!existsSync(target)) return { ok: false, detail: `missing ${shown}` }

  const probe = server.vendor.probe
  if (server.vendor.kind === 'pypi' && probe) {
    const outcome = probeImport(target, probe)
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

/** Record what the local copy was built from, so a mismatch is diagnosable. */
function writeStamp(vendorRoot, server, interpreter) {
  if (DRY_RUN) return
  const probed = spawnSync(
    interpreter,
    [
      '-c',
      "import json,sys;print(json.dumps({'executable':sys.executable,'version':sys.version,'abi':sys.implementation.cache_tag}))",
    ],
    { encoding: 'utf8', timeout: 20000 },
  )
  let python
  try {
    python = JSON.parse(String(probed.stdout ?? '').trim())
  } catch {
    python = { executable: interpreter, version: 'unknown', abi: 'unknown' }
  }
  const stamp = {
    generatedBy: 'scripts/fetch-mcp.mjs',
    kind: server.vendor.kind,
    package: server.vendor.package,
    version: server.vendor.version,
    license: server.license,
    python,
    builtAt: new Date().toISOString(),
  }
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

    const outcome = server.vendor.kind === 'npm' ? vendorNpm(manifest, server) : vendorPypi(manifest, server)
    if (outcome.dryRun) {
      report(server.id, 'dry-run', `would vendor ${server.vendor.package}@${server.vendor.version}`)
    } else if (outcome.ok) {
      report(
        server.id,
        'vendored',
        `${outcome.detail}  (${server.vendor.package}@${server.vendor.version}, ${server.license})`,
      )
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
