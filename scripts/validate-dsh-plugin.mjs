#!/usr/bin/env node
/**
 * Validate the dsh plugin surface of this package.
 *
 * Runs with zero dependencies (node: builtins only) so it works from a fresh
 * clone without an install step. The one optional check — a real parse of
 * cordis.patch.yml — uses the `yaml` parser from a dsh profile when one is
 * resolvable, and is skipped with a notice otherwise.
 *
 * Usage: node scripts/validate-dsh-plugin.mjs [--strict]
 *   --strict  treat warnings as failures (use in CI)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STRICT = process.argv.includes('--strict')

const errors = []
const warnings = []
const fail = (message) => errors.push(message)
const warn = (message) => warnings.push(message)
const rel = (path) => relative(ROOT, path).replace(/\\/g, '/')

/** Read a file as UTF-8, or undefined when it does not exist. */
function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** Split a skill-like markdown file into frontmatter and body. */
function splitFrontmatter(text) {
  const matched = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  return { frontmatter: matched?.[1] ?? '', body: matched?.[2] ?? text }
}

/** Read one frontmatter scalar, stripping wrapping quotes. */
function field(frontmatter, key) {
  const matched = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))
  return matched?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined
}

const isKebabCase = (value) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)

/** `.md` files directly inside a directory, excluding README. */
function markdownFiles(directory) {
  const abs = join(ROOT, directory)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return []
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md')
    .map((entry) => join(abs, entry.name))
}

// ---------------------------------------------------------------------------
// 1. Package manifest and bundle patch wiring
// ---------------------------------------------------------------------------
const manifestPath = join(ROOT, 'package.json')
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (error) {
  fail(`package.json is not valid JSON: ${error.message}`)
}

if (manifest) {
  for (const key of ['name', 'version', 'type', 'main']) {
    if (!manifest[key]) fail(`package.json is missing "${key}"`)
  }
  if (manifest.type !== 'module') fail('package.json must declare "type": "module" (the plugin entry is ESM)')
  if (!manifest.dsh?.bundle?.patch) {
    fail('package.json is missing dsh.bundle.patch — the package would not be loadable as a dsh profile bundle')
  } else {
    const patchPath = join(ROOT, manifest.dsh.bundle.patch)
    if (!existsSync(patchPath)) fail(`dsh.bundle.patch points at a missing file: ${manifest.dsh.bundle.patch}`)
  }
  if (manifest.main && !existsSync(join(ROOT, manifest.main))) {
    fail(`"main" points at a missing file: ${manifest.main}`)
  }
  for (const entry of manifest.files ?? []) {
    if (!existsSync(join(ROOT, entry))) warn(`package.json "files" lists a missing path: ${entry}`)
  }
}

// ---------------------------------------------------------------------------
// 2. Skill frontmatter across the three registered surfaces
// ---------------------------------------------------------------------------
const skillsRoot = join(ROOT, 'skills')
const skillEntries = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, file: join(skillsRoot, entry.name, 'SKILL.md') }))
  : []
if (skillEntries.length === 0) fail('skills/ contains no skill directories')

const collected = []
for (const entry of skillEntries) {
  if (!existsSync(entry.file)) {
    fail(`skills/${entry.name}/ has no SKILL.md`)
    continue
  }
  collected.push({ file: entry.file, surface: 'skills', expectedName: entry.name })
}
for (const file of markdownFiles('commands')) collected.push({ file, surface: 'commands' })
for (const file of markdownFiles('agents')) collected.push({ file, surface: 'agents' })

const byName = new Map()
for (const item of collected) {
  const text = readFileSync(item.file, 'utf8')
  const { frontmatter, body } = splitFrontmatter(text)
  const name = field(frontmatter, 'name')
  const description = field(frontmatter, 'description')

  if (!name) fail(`${rel(item.file)} has no "name" in its frontmatter`)
  else if (!isKebabCase(name)) fail(`${rel(item.file)}: name "${name}" is not kebab-case`)

  if (!description) fail(`${rel(item.file)} has no "description" in its frontmatter`)

  if (item.expectedName && name && name !== item.expectedName) {
    fail(`${rel(item.file)}: directory "${item.expectedName}" and frontmatter name "${name}" disagree`)
  }

  if (name) {
    const previous = byName.get(name)
    if (previous) fail(`skill name "${name}" is claimed twice: ${rel(previous.file)} and ${rel(item.file)}`)
    else byName.set(name, item)
  }

  // Section anatomy differs per surface by design: workflow skills carry the
  // full SKILL.md anatomy, /se-* entry commands use task-shaped headings, and
  // review personas carry a review-oriented structure instead. Each surface is
  // checked against its own required set — never one shared list, or half the
  // catalog reports as broken.
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim())
  const has = (pattern) => headings.some((heading) => pattern.test(heading))
  const requiredSections = {
    skills: [
      ['Overview', /^Overview/i],
      ['When to Use', /^When to Use/i],
      ['Verification', /^Verification/i],
      ['After This Skill', /^After This Skill/i],
    ],
    commands: [
      ['Overview', /^Overview/i],
      ['Verification', /^Verification/i],
    ],
    agents: [
      ['Review Framework', /^Review Framework/i],
      ['Output Format', /^Output Format/i],
      ['Rules', /^Rules/i],
    ],
  }[item.surface] ?? []
  for (const [label, pattern] of requiredSections) {
    if (!has(pattern)) fail(`${rel(item.file)} has no "## ${label}" section`)
  }

  if (body.trim().length < 200) warn(`${rel(item.file)} body is very short (${body.trim().length} chars)`)
}

// ---------------------------------------------------------------------------
// 3. The meta-skill must reflect the current skill set
// ---------------------------------------------------------------------------
const meta = readIfPresent(join(skillsRoot, 'using-se-skills', 'SKILL.md'))
if (meta) {
  for (const entry of skillEntries) {
    if (!meta.includes(entry.name)) {
      warn(`using-se-skills does not mention the skill "${entry.name}" — its Quick Reference is stale`)
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The dsh-only contract: no multi-platform leftovers
// ---------------------------------------------------------------------------
const forbidden = ['CLAUDE.md', '.claude', '.claude-plugin', '.codex-plugin', 'hooks', '.mcp.json']
for (const path of forbidden) {
  if (existsSync(join(ROOT, path))) fail(`${path} still exists — this package ships as a dsh-only plugin`)
}

const TEXT_EXTENSIONS = ['.md', '.json', '.yml', '.yaml', '.js', '.mjs', '.py', '.sh', '.ps1']
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.codegraph', '.workbuddy', 'site'])

/** Every tracked-looking text file under the repo, excluding vendor/tool dirs. */
function walk(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.isDirectory() && entry.name !== '.github') continue
    if (SKIP_DIRECTORIES.has(entry.name)) continue
    const abs = join(directory, entry.name)
    if (entry.isDirectory()) walk(abs, found)
    else if (TEXT_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) found.push(abs)
  }
  return found
}

const CLAUDE_CODE_PATTERNS = [
  [/\$\{CLAUDE_PLUGIN_ROOT\}/, '${CLAUDE_PLUGIN_ROOT}'],
  [/\bCLAUDE\.md\b/, 'CLAUDE.md'],
  [/se-skills:[a-z-]+/, 'the Claude Code plugin namespace "se-skills:<skill>"'],
]
for (const file of walk(ROOT)) {
  // CHANGELOG is history — it must keep the record of what was removed.
  // This script is skipped because it defines the patterns below as literals.
  if (rel(file).startsWith('CHANGELOG') || rel(file) === 'scripts/validate-dsh-plugin.mjs') continue
  const text = readFileSync(file, 'utf8')
  for (const [pattern, label] of CLAUDE_CODE_PATTERNS) {
    if (pattern.test(text)) fail(`${rel(file)} still references ${label}`)
  }
}

// ---------------------------------------------------------------------------
// 5. Bundle patch: structure, and the !!js expressions inside it
// ---------------------------------------------------------------------------
const patchName = manifest?.dsh?.bundle?.patch
const patchPath = patchName ? join(ROOT, patchName) : undefined
if (patchPath && existsSync(patchPath)) {
  const text = readFileSync(patchPath, 'utf8')
  const ids = [...text.matchAll(/^\s*-?\s*id:\s*(\S+)/gm)].map((match) => match[1])
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  for (const id of new Set(duplicates)) fail(`${patchName} declares duplicate row id "${id}"`)

  // Anchor to a real YAML node position (`- !!js ...` or `key: !!js ...`) so a
  // comment that merely mentions the tag is not mistaken for an expression.
  const expressions = [...text.matchAll(/^[ \t]*(?:-[ \t]+|[\w-]+:[ \t]*)!!js[ \t]+(.+)$/gm)]
    .map((match) => match[1].trim().replace(/^["']|["']$/g, ''))
  if (expressions.length === 0) warn(`${patchName} contains no !!js expression — is the skills provider wired up?`)
  for (const expression of expressions) {
    try {
      // Compile only — never call it; the value depends on the dsh host scope.
      new Function('baseUrl', 'process', `return (${expression})`)
    } catch (error) {
      fail(`${patchName}: !!js expression does not compile: ${expression} (${error.message})`)
    }
  }

  const providerRow = text.includes('@deepseek-ai/dsh-skill-filesystem')
  const isolated = /includeDefaultRoots:\s*false/.test(text)
  if (!providerRow) fail(`${patchName} does not insert a dsh-skill-filesystem provider — skills/ would never be served`)
  if (providerRow && !isolated) {
    warn(`${patchName}: the skills provider does not set includeDefaultRoots: false, so it will also pick up the user's own skill roots`)
  }

  // Deep check: parse the YAML when a dsh profile's parser is reachable.
  const profileCandidates = [
    process.env.DSH_PROFILE,
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles', 'web') : undefined,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh', 'profiles', 'web') : undefined,
    process.env.HOME ? join(process.env.HOME, '.dsh', 'profiles', 'web') : undefined,
  ].filter(Boolean)

  const profile = profileCandidates.find((candidate) => existsSync(join(candidate, 'node_modules')))
  if (!profile) {
    warn('no dsh profile with node_modules found — skipped the full YAML parse of the bundle patch')
  } else {
    try {
      const { createRequire } = await import('node:module')
      const { pathToFileURL } = await import('node:url')
      const require = createRequire(join(profile, 'noop.js'))
      const YAML = await import(pathToFileURL(require.resolve('yaml')).href)
      // dsh evaluates !!js as a JS expression; keep it as a string here so the
      // surrounding YAML structure is what gets validated. The `!!` handle
      // expands to the yaml.org namespace, so the full URI is required here —
      // a bare '!!js' silently fails to resolve and emits a warning instead.
      const parsed = YAML.parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }] })
      const rows = parsed.flatMap((entry) => entry.insert ?? [])
      if (rows.length === 0) fail(`${patchName} parsed to zero insert rows`)
      for (const row of rows) {
        if (!row.id || !row.name) fail(`${patchName}: an insert row is missing id or name`)
      }
    } catch (error) {
      fail(`${patchName} does not parse as YAML: ${error.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 6. MCP manifest, launcher shim, and the patch rows that must agree with them
// ---------------------------------------------------------------------------
const mcpManifestPath = join(ROOT, 'mcp', 'servers.json')
const shimPath = join(ROOT, 'mcp', 'shim.mjs')
if (!existsSync(shimPath)) fail('mcp/shim.mjs is missing — every MCP row spawns it')

let mcpManifest
if (!existsSync(mcpManifestPath)) {
  fail('mcp/servers.json is missing — the MCP rows would have nothing to resolve against')
} else {
  try {
    mcpManifest = JSON.parse(readFileSync(mcpManifestPath, 'utf8'))
  } catch (error) {
    fail(`mcp/servers.json is not valid JSON: ${error.message}`)
  }
}

const serverIds = []
if (mcpManifest) {
  if (!mcpManifest.vendorDir) fail('mcp/servers.json has no "vendorDir"')
  if (!Array.isArray(mcpManifest.servers) || mcpManifest.servers.length === 0) {
    fail('mcp/servers.json declares no servers')
  }
  for (const server of mcpManifest.servers ?? []) {
    const label = `mcp/servers.json: "${server.id ?? '(no id)'}"`
    if (!server.id) {
      fail('mcp/servers.json: a server entry has no "id"')
      continue
    }
    serverIds.push(server.id)
    if (!isKebabCase(server.id)) fail(`${label}: id is not kebab-case`)
    if (!server.summary) warn(`${label} has no summary`)
    if (!server.license) warn(`${label} does not record its license`)
    if (!server.fallback?.command) fail(`${label} has no fallback command`)
    if (!['node', 'python'].includes(server.runtime)) fail(`${label}: runtime must be "node" or "python"`)

    if (server.vendor) {
      const version = server.vendor.version
      if (!version) fail(`${label}: vendor block has no pinned version`)
      else if (/[\^~><*]/.test(version)) fail(`${label}: version "${version}" is a range — pin an exact version`)
      if (server.vendor.kind === 'npm' && !server.vendor.entry) {
        fail(`${label}: npm vendor block has no "entry" (the shim resolves it)`)
      }
      // Without a probe the shim trusts the local copy on mere existence, which
      // is exactly how an ABI-mismatched or half-installed tree slips through.
      if (server.vendor.kind === 'pypi' && !server.vendor.probe) {
        warn(`${label}: Python vendor has no "probe" — the local copy is trusted on existence alone`)
      }
    } else if (!server.disabledReason) {
      warn(`${label} has no vendor block and no disabledReason explaining why`)
    }
  }
  const duplicateIds = serverIds.filter((id, index) => serverIds.indexOf(id) !== index)
  for (const id of new Set(duplicateIds)) fail(`mcp/servers.json declares "${id}" twice`)
}

// The patch rows and the manifest are two halves of one contract: a row whose
// serverName is not in the manifest makes the shim exit 64 at spawn time, and a
// manifest entry no row uses is dead weight. Neither is visible from one file.
if (mcpManifest && patchPath && existsSync(patchPath)) {
  const text = readFileSync(patchPath, 'utf8')
  const serverNames = [...text.matchAll(/^\s*serverName:\s*(\S+)\s*$/gm)].map((match) => match[1])
  const duplicateNames = serverNames.filter((name, index) => serverNames.indexOf(name) !== index)
  for (const name of new Set(duplicateNames)) {
    fail(`${patchName}: serverName "${name}" is used twice — dsh rejects the duplicate at activation`)
  }
  for (const name of new Set(serverNames)) {
    if (!serverIds.includes(name)) {
      fail(`${patchName}: serverName "${name}" has no entry in mcp/servers.json — the shim would refuse to start it`)
    }
  }
  for (const id of serverIds) {
    if (!serverNames.includes(id)) warn(`${patchName}: mcp/servers.json declares "${id}" but no patch row uses it`)
  }

  // Count only live YAML: the header comments also discuss mcp/shim.mjs, and
  // counting those would make the reference count permanently outrun the rows.
  const shimRefs = text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .reduce((total, line) => total + (line.match(/mcp\/shim\.mjs/g)?.length ?? 0), 0)
  if (serverNames.length > 0 && shimRefs === 0) {
    fail(`${patchName}: MCP rows exist but none routes through mcp/shim.mjs — the local-copy preference would never apply`)
  } else if (shimRefs !== serverNames.length) {
    warn(`${patchName}: ${serverNames.length} MCP row(s) but ${shimRefs} reference(s) to mcp/shim.mjs`)
  }
}

// ---------------------------------------------------------------------------
// 7. 原生工具定义：registry 的硬要求，在本地先查一遍
// ---------------------------------------------------------------------------
// 这些要求在本机 dsh 里是**运行期**才生效的：register() 时查 output/render/schema 子集，
// 调用时再拿 output.schema 校验 execute 的返回值。放在这里先查，就不必先起一个 dsh 才看到报错。
// 规则复刻的来源、以及 dsh 升级后怎么回来对齐，见 scripts/dsh-tool-rules.mjs 与
// docs/dsh-setup.md 的「工具定义规则」一节。
const toolDefinitions = []
let toolRules
try {
  toolRules = await import(pathToFileURL(join(ROOT, 'scripts', 'dsh-tool-rules.mjs')).href)
} catch (error) {
  fail(`scripts/dsh-tool-rules.mjs is not importable: ${error.message}`)
}

if (toolRules) {
  try {
    const toolsModule = await import(pathToFileURL(join(ROOT, 'lib', 'tools', 'index.js')).href)
    toolDefinitions.push(...(toolsModule.SE_TOOL_DEFINITIONS ?? []))
  } catch (error) {
    fail(`lib/tools/index.js is not importable: ${error.message}`)
  }

  if (toolDefinitions.length === 0) {
    fail('lib/tools/index.js exports no tool definitions — the tool families would register nothing')
  }
  for (const definition of toolDefinitions) {
    for (const violation of toolRules.checkToolDefinition(definition)) fail(violation)
  }

  const toolNames = toolDefinitions.map((definition) => definition.name).filter(Boolean)
  for (const name of new Set(toolNames)) {
    if (toolNames.filter((entry) => entry === name).length > 1) fail(`tool name "${name}" is declared twice`)
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(
  `Checked ${collected.length} skill files (${skillEntries.length} skills, ${markdownFiles('commands').length} commands, ${markdownFiles('agents').length} agents), ` +
    `${toolDefinitions.length} native tool definition(s), and ${serverIds.length} MCP server entr${serverIds.length === 1 ? 'y' : 'ies'}`,
)
for (const message of warnings) console.log(`  warning: ${message}`)
for (const message of errors) console.log(`  ERROR:   ${message}`)

if (errors.length > 0 || (STRICT && warnings.length > 0)) {
  console.log(`\nFAIL — ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`\nPASS — 0 errors, ${warnings.length} warning(s)`)
