#!/usr/bin/env node
/**
 * SE 工具族的功能冒烟测试 —— 零依赖，不需要 dsh 在场。
 *
 * 为什么必须有这个文件：「结构正确」不等于「插件能跑」。dsh 对工具定义是强校验的
 * （register 时查 output/render/schema 子集，调用时再拿 output.schema 校验返回值），
 * 靠读代码永远确认不了。这里用 scripts/dsh-tool-rules.mjs 复刻那套规则，搭一个假 registry，
 * 真跑一遍 apply() 与三个工具，把「跑过了」变成可复现的证据。
 *
 * Usage: node scripts/smoke-tools.mjs
 */
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'
import { registerSeTools, SE_TOOL_DEFINITIONS } from '../lib/tools/index.js'
import { canonicalUnit, parseQuantity } from '../lib/tools/units.js'
import { checkToolDefinition, validateValue } from './dsh-tool-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const failures = []
const notes = []
function check(label, condition, detail) {
  if (condition) return true
  failures.push(detail === undefined ? label : `${label} — ${detail}`)
  return false
}
const close = (actual, expected, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance

/** 递归冻结，复刻 dsh 在 render 之前对返回值做的处理。 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

// ---------------------------------------------------------------------------
// 假 registry：注册时按 dsh 的硬要求校验，调用时按 output.schema 校验返回值
// ---------------------------------------------------------------------------
function createRegistry() {
  const registered = new Map()
  return {
    register(definition) {
      const violations = checkToolDefinition(definition)
      if (violations.length > 0) throw new Error(violations.join('; '))
      if (registered.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
    async call(name, args) {
      const definition = registered.get(name)
      if (!definition) throw new Error(`no such tool: ${name}`)
      const result = await definition.execute(args, { arguments: args })
      const violations = validateValue(definition.output.schema, result)
      if (violations.length > 0) throw new Error(`tool "${name}" output violates its own output.schema: ${violations.join('; ')}`)
      const value = deepFreeze(structuredClone(result))
      const content = definition.output.render(args, value)
      return { value, content, text: content.map((part) => part.text).join('\n') }
    },
    names: () => [...registered.keys()],
  }
}

// ---------------------------------------------------------------------------
// 假 ctx：skills + tools 两个服务，inject 立即回调
// ---------------------------------------------------------------------------
const warnings = []
const skills = []
const tools = createRegistry()

const skillRegistry = {
  register(skill) {
    skills.push(skill)
    return () => {}
  },
}

const ctx = {
  logger: { warn: (message) => warnings.push(message) },
  get: (name) => (name === 'skills' ? skillRegistry : name === 'tools' ? tools : undefined),
  inject: (dependencies, callback) => {
    if (!dependencies.includes('tools')) return undefined
    return callback(ctx)
  },
}

// ---------------------------------------------------------------------------
// 1. apply() 真的跑得起来，且两个注册面都到齐
// ---------------------------------------------------------------------------
apply(ctx)

const countMarkdown = (directory) =>
  readdirSync(join(ROOT, directory), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name.toLowerCase() !== 'readme.md').length

const expectedSkills = countMarkdown('commands') + countMarkdown('agents')
check('apply() registers every command and agent file', skills.length === expectedSkills, `registered ${skills.length}, expected ${expectedSkills}`)
check('no skill was skipped with a warning', warnings.length === 0, warnings.join(' | '))
check('every registered skill declares an invocation policy',
  skills.every((skill) => skill.invocation && typeof skill.invocation.modelInvocable === 'boolean' && typeof skill.invocation.userInvocable === 'boolean'))

check('every SE tool definition registered', tools.names().length === SE_TOOL_DEFINITIONS.length,
  `registered ${tools.names().length} of ${SE_TOOL_DEFINITIONS.length}`)
check('tool names are the expected three', ['se_budget_rollup', 'se_budget_check', 'se_budget_bottleneck'].every((name) => tools.names().includes(name)))

// 卸载必须真的摘掉注册，否则热重载会撞名字冲突（同层重名 register 直接抛）。
const scoped = createRegistry()
const disposeTools = registerSeTools(
  { logger: ctx.logger, get: (name) => (name === 'tools' ? scoped : undefined) },
  (_scope, message) => warnings.push(message),
)
check('registerSeTools fills the scoped registry', scoped.names().length === SE_TOOL_DEFINITIONS.length,
  `registered ${scoped.names().length} of ${SE_TOOL_DEFINITIONS.length}`)
disposeTools()
check('disposing frees every tool name again', scoped.names().length === 0, scoped.names().join(', '))

// tools 是**软**依赖。这条声明如果没人测，就只是注释里的一句好话：某个 profile 禁用了
// tools 行时，commands/agents 必须照常注册。
//
// 注意这个假 ctx 如实建模了 cordis 的 inject 语义：**依赖永远不满足时回调根本不执行**。
// （早先那版无条件回调，等于测了一个真实环境里不会发生的分支。）
const degradedSkills = []
const degradedCtx = {
  logger: { warn: () => {} },
  get: (name) => (name === 'skills' ? { register: (skill) => degradedSkills.push(skill) } : undefined),
  inject: (dependencies, callback) => (dependencies.every((name) => degradedCtx.get(name) !== undefined) ? callback(degradedCtx) : undefined),
}
apply(degradedCtx)
check('without a tools service the skills still register', degradedSkills.length === expectedSkills,
  `registered ${degradedSkills.length}, expected ${expectedSkills}`)

// 回调真的被调用、但服务仍拿不到时（例如被别的插件抢先释放），必须留下一条可诊断的告警。
const orphanWarnings = []
const orphanDispose = registerSeTools({ get: () => undefined }, (_scope, message) => orphanWarnings.push(message))
check('registerSeTools warns instead of throwing when the service is gone',
  orphanWarnings.length === 1 && orphanWarnings[0].includes('tools service is unavailable'), orphanWarnings.join(' | '))
check('the failure path still returns a usable disposer', typeof orphanDispose === 'function' && orphanDispose() === undefined)

// ---------------------------------------------------------------------------
// 2. 场景：CSCB2400 的一份真实形状的预算（flash 占用 / 功耗 / 时延）
// ---------------------------------------------------------------------------
const S = (doc, version, section) => ({ doc, version, section })

const flashItems = [
  { name: 'MCU bootloader', value: '192 KiB', source: S('SOD', 'v1.4', '4.1 Partition Layout') },
  { name: 'SIO_A slot (440 KB cap)', value: 440, unit: 'KB', source: S('FWU Handoff', 'v2026-08-15', '2.1') },
  { name: 'SPIFLASH_LOG partition', value: '1 MiB' },
  { name: 'filesystem', value: '2.5 MiB', source: S('SOD', 'v1.4', '4.1 Partition Layout') },
]
const powerItems = [
  { name: 'MCU active', value: 210, unit: 'mW', source: S('HW Spec', 'v2.0', 'Table 7') },
  { name: 'SIO active', value: '0.18 W', source: S('HW Spec', 'v2.0', 'Table 7') },
  { name: 'DDR PHY', value: '<= 90 mW' },
]
const timeItems = [
  { name: 'CABI 0x0E round trip', value: '<= 500 us', source: S('CABI Spec', 'v1.1', '3.4') },
  { name: 'QSPI sector erase', value: '45 ms' },
]
const items = [...flashItems, ...powerItems, ...timeItems]

// 2a. rollup：三个量纲各自求和，绝不混加
const rollup = await tools.call('se_budget_rollup', { items })
const byDimension = new Map(rollup.value.dimensions.map((entry) => [entry.dimension, entry]))
check('rollup groups into exactly three dimensions', rollup.value.dimensions.length === 3, rollup.value.dimensions.map((d) => d.dimension).join(', '))
check('rollup ok', rollup.value.ok === true, JSON.stringify(rollup.value.errors))

// 192 KiB + 440 KB + 1 MiB + 2.5 MiB，字节是精确整数，可以直接比。
const expectedBytes = 192 * 1024 + 440 * 1000 + 1048576 + 2.5 * 1048576
check('data total is the exact byte sum, not rounded to 6 significant digits',
  byDimension.get('data')?.totalBase === expectedBytes,
  `got ${byDimension.get('data')?.totalBase}, expected ${expectedBytes}`)
check('data picks a readable display unit', byDimension.get('data')?.displayUnit === 'MiB', byDimension.get('data')?.displayUnit)

// 210 mW + 0.18 W + 90 mW = 0.48 W，基准单位是 W。
check('power total normalizes mW into W', close(byDimension.get('power')?.totalBase ?? -1, 0.48),
  `got ${byDimension.get('power')?.totalBase}`)
// 显示单位规则：白名单里「系数不超过量级、且尽可能大」的那个。
// 0.48 W 落在 1 以下、1e-3 以上，所以读作 480 mW —— 这也是这份预算里上限所用的单位。
check('power reads as 480 mW, not 0.48 W and not 480000 uW',
  byDimension.get('power')?.displayUnit === 'mW' && byDimension.get('power')?.totalText === '480 mW',
  `${byDimension.get('power')?.displayUnit} / ${byDimension.get('power')?.totalText}`)

// 500 us + 45 ms = 0.0455 s。
check('time total normalizes us into s', close(byDimension.get('time')?.totalBase ?? -1, 0.0455),
  `got ${byDimension.get('time')?.totalBase}`)

check('rollup counts qualified (<=) lines', byDimension.get('power')?.qualifiedCount === 1 && byDimension.get('time')?.qualifiedCount === 1)
check('rollup counts unprovenanced lines', byDimension.get('data')?.unprovenancedCount === 1 && byDimension.get('time')?.unprovenancedCount === 1)
check('rollup warns that a total nobody can trace is not a budget', rollup.value.notes.some((note) => note.includes('no source')))

// 2b. check：三顶帽子都在头上时应当是 pass
const caps = [
  { name: 'MCU private QSPI (W25Q256)', limit: '8 MiB', source: S('SOD', 'v1.4', '4.1') },
  { name: 'Board power envelope', limit: '500 mW', source: S('HW Spec', 'v2.0', 'Table 3') },
  { name: 'Flash update deadline', limit: '2 s' },
]
const passing = await tools.call('se_budget_check', { items, caps })
check('check passes when every cap has headroom', passing.value.verdict === 'pass', JSON.stringify(passing.value.verdicts.map((v) => [v.capName, v.verdict])))
check('check reports one verdict per cap', passing.value.verdicts.length === 3)

const powerVerdict = passing.value.verdicts.find((entry) => entry.dimension === 'power')
check('power sits at 96% of its envelope', powerVerdict?.utilizationPercent === 96, String(powerVerdict?.utilizationPercent))
check('power headroom is quoted in the cap unit (mW)', powerVerdict?.headroomText === '20 mW', powerVerdict?.headroomText)
check('bottleneck warning fires at >= 90% utilization',
  passing.value.notes.some((note) => note.includes('no room for the next requirement')), passing.value.notes.join(' | '))

// 2c. check：把功耗帽子收到 400 mW，必须 FAIL 并给出精确的负余量
const failing = await tools.call('se_budget_check', { items, caps: [{ name: 'Tight power envelope', limit: '400 mW' }, ...caps.slice(0, 1)] })
check('check fails when a cap is broken', failing.value.verdict === 'fail', failing.value.verdict)
const tight = failing.value.verdicts.find((entry) => entry.capName === 'Tight power envelope')
check('broken cap reports the exact negative headroom', tight?.headroom === -80, String(tight?.headroom))
check('broken cap headroom reads as -80 mW', tight?.headroomText === '-80 mW', tight?.headroomText)
check('rendered text surfaces the FAIL', failing.text.includes('FAIL'))

// 2d. 没有被任何帽子覆盖的量纲必须被点出来
const partial = await tools.call('se_budget_check', { items, caps: [caps[0]] })
check('uncapped dimensions are reported', partial.value.uncappedDimensions.includes('power') && partial.value.uncappedDimensions.includes('time'),
  partial.value.uncappedDimensions.join(', '))
check('uncapped dimensions produce a note', partial.value.notes.some((note) => note.includes('unfinished one')))

// 2e. bottleneck：该点名的是「谁最吃紧、最吃紧的那条线是谁」
const bottleneck = await tools.call('se_budget_bottleneck', { items, caps, top: 2 })
check('tightest dimension is power', bottleneck.value.tightest?.dimension === 'power', JSON.stringify(bottleneck.value.tightest))
check('tightest carries its utilization', bottleneck.value.tightest?.utilizationPercent === 96, String(bottleneck.value.tightest?.utilizationPercent))
check('single bottleneck is the largest line in the tightest dimension', bottleneck.value.singleBottleneck?.name === 'MCU active',
  JSON.stringify(bottleneck.value.singleBottleneck))
check('single bottleneck share of cap is 42%', bottleneck.value.singleBottleneck?.shareOfCapPercent === 42, String(bottleneck.value.singleBottleneck?.shareOfCapPercent))
check('top consumers honour the requested count', bottleneck.value.topConsumers.length === 3 * 2, String(bottleneck.value.topConsumers.length))
check('bottleneck also flags the near-full cap',
  bottleneck.value.notes.some((note) => note.includes('no room for the next requirement')), bottleneck.value.notes.join(' | '))

const uncapped = await tools.call('se_budget_bottleneck', { items: powerItems })
check('without caps the ranking still works', uncapped.value.tightest === null && uncapped.value.topConsumers.length === 3)
check('without caps shares are null, never a fabricated percentage', uncapped.value.topConsumers.every((entry) => entry.shareOfCapPercent === null))

// ---------------------------------------------------------------------------
// 3. 错误路径：坏输入必须报错，而不是算出一个看起来正常的数
// ---------------------------------------------------------------------------
const noUnit = await tools.call('se_budget_rollup', { items: [{ name: 'mystery sink', value: 300 }] })
check('a line with no unit is an error, not a silent omission', noUnit.value.ok === false && noUnit.value.errors.length === 1, JSON.stringify(noUnit.value.errors))
check('the unparsable line is excluded from the totals', noUnit.value.dimensions.length === 0)

const badUnit = await tools.call('se_budget_rollup', { items: [{ name: 'widget', value: 5, unit: 'furlongs' }] })
check('an unknown unit is rejected with the known set', badUnit.value.ok === false && badUnit.value.errors[0].includes('unknown unit'), JSON.stringify(badUnit.value.errors))

// 小写 b 是 bit / byte 的真实 8 倍陷阱，必须拒绝而不是替调用方猜。
const ambiguous = await tools.call('se_budget_rollup', { items: [{ name: 'link', value: '1 b' }] })
check('lowercase "b" is rejected as ambiguous', ambiguous.value.ok === false && ambiguous.value.errors[0].includes('ambiguous'), JSON.stringify(ambiguous.value.errors))

const conflicting = await tools.call('se_budget_rollup', { items: [{ name: 'mixed', value: '512 MiB', unit: 'MB' }] })
check('a unit that contradicts the value text is an error', conflicting.value.ok === false, JSON.stringify(conflicting.value.errors))

const crossDimension = await tools.call('se_budget_check', { items, caps: [{ name: 'nonsense', limit: '1 s', dimension: 'data' }] })
check('a cap whose unit and dimension disagree is an error', crossDimension.value.ok === false, JSON.stringify(crossDimension.value.errors))

// ---------------------------------------------------------------------------
// 4. 单位层自身的规则
// ---------------------------------------------------------------------------
check('MB is decimal, MiB is binary', canonicalUnit('MB').canonical === 'MB' && canonicalUnit('MiB').canonical === 'MiB')
check('lowercase "mb" resolves to MB (unambiguous in this table)', canonicalUnit('mb').canonical === 'MB', JSON.stringify(canonicalUnit('mb')))
check('the MICRO SIGN and GREEK MU both normalize to us',
  canonicalUnit('µs').canonical === 'us' && canonicalUnit('μs').canonical === 'us')
check('a microsecond qualifier string parses end to end',
  parseQuantity('≤ 500 μs').ok && parseQuantity('≤ 500 μs').value === 500 && parseQuantity('≤ 500 μs').unit === 'μs')
check('a comparison prefix is captured, not dropped', parseQuantity('<= 500 us').qualifier === '<=')
check('an unreadable quantity is refused', parseQuantity('about 500 microseconds or so').ok === false)

// 表里目前没有第二种「同一小写、两个规范单位」的写法，所以那条歧义分支只由 AMBIGUOUS 兜底触发；
// 这是一个已知覆盖缺口，不是靠编造用例填上的。
notes.push('the lowercase-collision ambiguity branch has no trigger in the current unit table (only the explicit "b" guard reaches it)')

// ---------------------------------------------------------------------------
// 5. 复刻器自身的对照：一个只会说 PASS 的检查器等于没有检查器
// ---------------------------------------------------------------------------
const control = (overrides) => ({
  name: 'control_tool', description: 'control', execute() {},
  parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'object', properties: {}, additionalProperties: false }, render: () => [] },
  ...overrides,
})

const bannedKeyword = checkToolDefinition(control({
  parameters: { type: 'object', properties: { a: { type: 'string', minimum: 1 } } },
}))
check('control: a banned keyword (minimum) is caught', bannedKeyword.some((entry) => entry.includes('not a supported keyword')), bannedKeyword.join('; '))

const missingRender = checkToolDefinition(control({ output: { schema: { type: 'object', properties: {} } } }))
check('control: a missing output.render is caught', missingRender.some((entry) => entry.includes('render must be a function')), missingRender.join('; '))

const reservedName = checkToolDefinition(control({ name: 'run_code' }))
check('control: the reserved name run_code is caught', reservedName.some((entry) => entry.includes('reserved')), reservedName.join('; '))

const circular = { type: 'object', properties: {} }
circular.properties.self = circular
check('control: a genuinely circular schema is caught', checkToolDefinition(control({ parameters: circular })).some((entry) => entry.includes('circular')))

// 共用同一个 schema 对象**不是**环 —— 这一条是写这一版时真实误报过的坑，必须锁住。
const shared = { type: 'string' }
check('control: a schema object shared across positions is not reported as circular',
  checkToolDefinition(control({ parameters: { type: 'object', properties: { a: shared, b: shared } } })).length === 0)

// 返回值校验必须真的生效：故意让一个工具返回 schema 之外的键。
const leaky = {
  name: 'leaky_tool', description: 'returns an undeclared key', execute: async () => ({ ok: true, extra: 1 }),
  parameters: { type: 'object', properties: {} },
  output: { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, render: () => [] },
}
const leakyViolations = validateValue(leaky.output.schema, await leaky.execute())
check('control: an undeclared output key is caught', leakyViolations.some((entry) => entry.includes('additionalProperties')), leakyViolations.join('; '))

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`SE tool smoke test — ${SE_TOOL_DEFINITIONS.length} tool(s), ${skills.length} skill(s) registered through apply()`)
for (const note of notes) console.log(`  note:    ${note}`)
for (const failure of failures) console.log(`  FAILED:  ${failure}`)

if (failures.length > 0) {
  console.log(`\nFAIL — ${failures.length} assertion(s) failed`)
  process.exit(1)
}
console.log(`\nPASS — all assertions held (keys exercised: rollup normalizes mW/us/KiB, check gates, bottleneck names the line)`)
