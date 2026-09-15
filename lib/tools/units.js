/**
 * 单位与量纲横切层 —— SE 预算工具族共用。
 *
 * 设计取舍（都是刻意的，改动前请先读）：
 *
 * 1. **只做线性换算**。温度被有意排除：°C↔K 是仿射（带偏移）关系，用「乘系数」的表
 *    去处理会静默算错；而且把几个温度相加本身也没有工程意义。要温度就写 text，不要写 unit。
 *
 * 2. **字节与比特按书写方式区分，不猜**。B/KB/MB/GB 是十进制（IEC 80000-13 的 SI 记法），
 *    KiB/MiB/GiB 是二进制。速率一律把斜杠写全：`MB/s` 是字节速率，`Mbps` 是比特速率。
 *    不提供 `MBps` 这类缩写别名 —— 它与 `Mbps` 只差大小写，收进来就等于在 8 倍上赌一把。
 *
 * 3. **大小写先精确匹配，再退化为「大小写不敏感且唯一」**。退化的前提是唯一性：如果某个
 *    小写形式能映射到多个规范单位，解析直接报歧义并把候选列出来，绝不替调用方选一个。
 *
 * 4. **别名必须解析到规范名，而不是停在别名上**。这一条是踩过的坑：如果 `µs` 只映射到
 *    「time 量纲」却不映射到 `us`，下游按 `units['µs']` 查系数会拿到 undefined，
 *    再被「拿不到系数就当 1」的兜底吞掉 —— `500 µs` 会静默变成 `500 s`。所以
 *    `canonicalUnit()` 对别名一律返回**规范名**；系数表里只有规范名一种键。
 *
 * 5. 每个量纲带一个 `display` 白名单，用于「自动挑一个读数好看的显示单位」。全表参与挑选
 *    会挑出 `5000 ppm` 这种没人这么写的结果。
 *
 * 本文件零依赖（只允许 node: 内建模块）—— 见 lib/index.js 顶部的零依赖硬约束说明。
 */

/** 规范单位表：量纲 → { 规范单位 → 相对该量纲基准单位的系数 }。键必须全是规范名。 */
const DIMENSIONS = {
  power: { base: 'W', display: ['W', 'mW', 'uW'], units: { W: 1, mW: 1e-3, uW: 1e-6, kW: 1e3 } },
  energy: { base: 'J', display: ['J', 'mJ', 'Wh', 'mWh'], units: { J: 1, mJ: 1e-3, uJ: 1e-6, kJ: 1e3, Wh: 3600, mWh: 3.6, kWh: 3.6e6 } },
  time: { base: 's', display: ['h', 'min', 's', 'ms', 'us', 'ns'], units: { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, min: 60, h: 3600 } },
  frequency: { base: 'Hz', display: ['Hz', 'kHz', 'MHz', 'GHz'], units: { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 } },
  data: {
    base: 'B',
    display: ['B', 'KiB', 'MiB', 'GiB', 'KB', 'MB', 'GB', 'TB'],
    units: {
      B: 1,
      KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12,
      KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776,
    },
  },
  dataRate: {
    base: 'B/s',
    display: ['B/s', 'KiB/s', 'MiB/s', 'KB/s', 'MB/s', 'GB/s', 'Mbps', 'Gbps'],
    units: {
      'B/s': 1, 'KB/s': 1e3, 'MB/s': 1e6, 'GB/s': 1e9,
      'KiB/s': 1024, 'MiB/s': 1048576, 'GiB/s': 1073741824,
      // 1 bit = 1/8 byte；换算到 B/s 后与字节速率可比。
      bit: 0.125, bps: 0.125, kbps: 125, Mbps: 125000, Gbps: 125000000,
    },
  },
  voltage: { base: 'V', display: ['V', 'mV', 'uV'], units: { V: 1, mV: 1e-3, uV: 1e-6 } },
  current: { base: 'A', display: ['A', 'mA', 'uA'], units: { A: 1, mA: 1e-3, uA: 1e-6 } },
  ratio: { base: '%', display: ['%'], units: { '%': 1, ppm: 1e-4 } },
  count: { base: 'count', display: ['count'], units: { count: 1, pcs: 1, x: 1, pins: 1, pin: 1, cycles: 1, entries: 1, lines: 1 } },
}

/**
 * 受认可的等价写法 → **规范单位名**。微秒的两种码位（U+00B5 MICRO SIGN、U+03BC GREEK MU）
 * 都要收 —— 文档里两种都会出现，肉眼分不出来。
 *
 * 有意不收 `*ps` 缩写：`MBps` 与 `Mbps` 只差大小写，收进来就等于替调用方在 8 倍上做选择。
 */
const ALIASES = {
  'µs': 'us', 'μs': 'us',
  'µA': 'uA', 'μA': 'uA',
  'µW': 'uW', 'μW': 'uW',
  'µV': 'uV', 'μV': 'uV',
  'µJ': 'uJ', 'μJ': 'uJ',
  second: 's', seconds: 's', sec: 's', secs: 's',
  millisecond: 'ms', milliseconds: 'ms', msec: 'ms', msecs: 'ms',
  microsecond: 'us', microseconds: 'us', usec: 'us', usecs: 'us',
  nanosecond: 'ns', nanoseconds: 'ns', nsec: 'ns',
  minute: 'min', minutes: 'min', mins: 'min',
  hour: 'h', hours: 'h', hr: 'h', hrs: 'h',
  percent: '%', pct: '%',
}

/**
 * 明确拒绝的写法。这些不是「不认识」，而是**同一串字符能指两个相差 8 倍的单位**。
 * 小写 `b`：`B` 是字节，`bit` 是比特。既然字节走 B/KB/MB、比特走 bps/kbps/Mbps，
 * 那 `1 b` 就没法替调用方定夺 —— 猜错是 8 倍，必须报错。
 */
const AMBIGUOUS = {
  b: 'bits or bytes — write "bit" for a bit, or "B" for a byte (1 B = 8 bit)',
}

/** 规范单位 → 量纲。 */
const UNIT_INDEX = new Map()
/** 别名 → 规范单位名。 */
const ALIAS_INDEX = new Map()
/** 小写形式 → 它能到达的规范单位集合（规范名与别名都计入），用于退化匹配与歧义检出。 */
const LOWER_INDEX = new Map()

function index(key, canonical) {
  const lower = key.toLowerCase()
  if (!LOWER_INDEX.has(lower)) LOWER_INDEX.set(lower, new Set())
  LOWER_INDEX.get(lower).add(canonical)
}

for (const [dimension, spec] of Object.entries(DIMENSIONS)) {
  for (const canonical of Object.keys(spec.units)) {
    UNIT_INDEX.set(canonical, dimension)
    index(canonical, canonical)
  }
}

for (const [alias, canonical] of Object.entries(ALIASES)) {
  if (!UNIT_INDEX.has(canonical)) {
    throw new Error(`units.js: alias "${alias}" points at unknown unit "${canonical}"`)
  }
  ALIAS_INDEX.set(alias, canonical)
  index(alias, canonical)
}

/** 量纲基准单位。 */
export function baseUnit(dimension) {
  return DIMENSIONS[dimension]?.base
}

/** 全部量纲名，供调用方校验。 */
export function dimensions() {
  return Object.keys(DIMENSIONS)
}

/** 某个规范单位在量纲内的系数。别名先归一到规范名，永远不会拿到 undefined。 */
function factorOf(dimension, unit) {
  const resolved = ALIAS_INDEX.get(unit) ?? unit
  return DIMENSIONS[dimension]?.units[resolved]
}

/** 同一量纲内把值从 `from` 换算到 `to`。跨量纲（或单位不认识）返回 undefined。 */
export function convert(value, from, to) {
  const fromSpec = specOf(from)
  const toSpec = specOf(to)
  if (!fromSpec || !toSpec || fromSpec.dimension !== toSpec.dimension) return undefined
  return (value * fromSpec.factor) / toSpec.factor
}

function specOf(unit) {
  const canonical = canonicalUnit(unit)
  if (!canonical.ok) return undefined
  const factor = factorOf(canonical.dimension, canonical.canonical)
  return Number.isFinite(factor) ? { dimension: canonical.dimension, factor } : undefined
}

/**
 * 把一个书写形式的单位解析成**规范单位名**（别名归一到规范名，不是原样返回）。
 * @returns `{ ok: true, canonical, dimension }`，或 `{ ok: false, error }`。
 */
export function canonicalUnit(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'unit is empty' }
  const text = raw.trim().replace(/\s+/g, '')

  if (UNIT_INDEX.has(text)) {
    return { ok: true, canonical: text, dimension: UNIT_INDEX.get(text) }
  }
  if (ALIAS_INDEX.has(text)) {
    const canonical = ALIAS_INDEX.get(text)
    return { ok: true, canonical, dimension: UNIT_INDEX.get(canonical) }
  }

  // 歧义写法必须在大小写退化**之前**拦下，否则小写 `b` 会静默变成字节。
  if (AMBIGUOUS[text]) {
    return { ok: false, error: `unit "${raw}" is ambiguous — ${AMBIGUOUS[text]}` }
  }

  const lowered = LOWER_INDEX.get(text.toLowerCase())
  if (lowered?.size === 1) {
    const [canonical] = [...lowered]
    return { ok: true, canonical, dimension: UNIT_INDEX.get(canonical) }
  }
  if (lowered && lowered.size > 1) {
    // 大小写敏感的单位在这个表里（B/MB/MiB/Mbps）语义不同，绝不替调用方挑一个。
    return { ok: false, error: `unit "${raw}" is ambiguous — write one of: ${[...lowered].sort().join(', ')}` }
  }
  return { ok: false, error: `unknown unit "${raw}" (known: ${[...new Set([...UNIT_INDEX.keys(), ...ALIAS_INDEX.keys()])].sort().join(', ')})` }
}

/** 比较符前缀：`≤ 500us` 这类写法。 */
const QUALIFIER = /^(?:<=|≤|<|>=|≥|>|~|=)?/

/** 数量文本：`≤ 500 us`、`2W`、`1.5GiB`、`12.5 MB/s`、`-40`、`3e6`。 */
const QUANTITY = /^\s*(<=|≥|≤|>=|<|>|~|=)?\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([%µμA-Za-z][A-Za-z0-9%µμ/·^-]*)?\s*$/

/**
 * 解析一个数量输入：数字，或「比较符 + 数值 + 单位」文本。
 * @returns 成功时 `{ ok: true, value, unit, qualifier }`（`unit` 可能为 undefined）。
 */
export function parseQuantity(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: `number ${input} is not finite` }
    return { ok: true, value: input, unit: undefined, qualifier: undefined }
  }
  if (typeof input !== 'string') {
    return { ok: false, error: `value must be a number or a string, got ${typeof input}` }
  }

  const matched = QUANTITY.exec(input)
  if (!matched) return { ok: false, error: `cannot read a quantity from "${input}"` }

  const [, qualifier, number, unit] = matched
  const value = Number(number)
  if (!Number.isFinite(value)) return { ok: false, error: `cannot read a number from "${input}"` }

  // 这里只负责把比较符规范化并透传；「必须有单位」是调用方的约束，不在这层强加
  // —— 裸数字配 `unit` 字段是合法输入，本函数不该替调用方判断。
  const qualifierToken = qualifier ? QUALIFIER.exec(qualifier)?.[0] : undefined
  return { ok: true, value, unit: unit || undefined, qualifier: qualifierToken || undefined }
}

/**
 * 收敛浮点噪声。
 *
 * **整数原样返回**：字节数是精确整数，`toPrecision(6)` 会把 4306624 B 变成 4306620 B ——
 * 一个分区表上少 4 字节的分区方案。只有非整数才需要压掉 `0.30000000000000004` 这类尾巴。
 */
export function tidy(number) {
  if (!Number.isFinite(number)) return number
  if (Number.isInteger(number)) return number
  return Number(number.toPrecision(6))
}

/**
 * 在量纲的显示白名单里挑一个读数最自然的单位：系数不超过量级、且尽可能大的那个。
 * 量级小于白名单里所有单位时回落到最小的那个（例如 0.5% 仍是 %）。
 */
export function pickDisplayUnit(dimension, baseMagnitude) {
  const spec = DIMENSIONS[dimension]
  if (!spec) return undefined
  const candidates = spec.display
    .map((unit) => ({ unit, factor: spec.units[unit] }))
    .filter((entry) => Number.isFinite(entry.factor))
    .sort((a, b) => b.factor - a.factor)

  const magnitude = Math.abs(baseMagnitude)
  if (magnitude > 0) {
    const fit = candidates.find((entry) => magnitude / entry.factor >= 1)
    if (fit) return fit.unit
  }
  return candidates[candidates.length - 1]?.unit
}

/** 把「基准单位下的数值」格式化成带单位的可读文本。 */
export function formatQuantity(baseMagnitude, dimension, forcedUnit) {
  const unit = forcedUnit ?? pickDisplayUnit(dimension, baseMagnitude)
  const factor = factorOf(dimension, unit)
  if (!Number.isFinite(factor)) return `${tidy(baseMagnitude)} ${baseUnit(dimension)}`
  return `${tidy(baseMagnitude / factor)} ${unit}`
}
