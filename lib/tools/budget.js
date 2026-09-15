/**
 * SE 预算工具族 —— budget / constraint 校验。
 *
 * 为什么是原生工具而不是 MCP：dsh 的 tool registry 本来就是 MCP 工具最终落地的那张表
 * （见 dsh-mcp-client 的 inject = ["tools"]）。第一方工具直接 register 进同一张表，
 * 省掉一个进程、一次 JSON-RPC 跳转，以及一套与本仓库无关的 schema 方言。
 *
 * 硬约束（dsh-tools 的 register() 逐条强校验，猜错就是加载期/调用期抛错）：
 *   - definition.output 必须是对象且**带 render 函数**，否则 TypeError；
 *   - output.schema 只允许 JSON Schema 子集：
 *       关键字 type / oneOf / properties / required / additionalProperties / items / enum / const
 *       + 注解 description / title / default / examples
 *     没有 $ref / anyOf / allOf / minimum / maximum / pattern / format；type 必须是单个字符串；
 *     oneOf 至少两项，且不能与 properties/required/items/enum/const 同级。
 *   - execute() 的返回值会被 output.schema 校验，不符直接抛 ToolOutputError，
 *     所以下面的 schema 与返回结构是**逐键对齐**的（含 additionalProperties: false）。
 *   - 返回值在 render 之前会被 deepFreeze，render 里不得改动 value。
 *   - 工具名不能是保留名 run_code。
 *
 * 本文件零依赖（只允许 node: 内建模块）。
 */
import { baseUnit, canonicalUnit, convert, formatQuantity, parseQuantity, pickDisplayUnit, tidy } from './units.js'

/** 出处：每一个进入文档的数字都该能指回它的来源。 */
const SOURCE_SCHEMA = {
  type: 'object',
  description: 'Provenance of a number: which document, which revision, which section.',
  properties: {
    doc: { type: 'string', description: 'Document or register name, e.g. "CSCB2400 SOD".' },
    version: { type: 'string', description: 'Revision or date, e.g. "v1.4" or "2026-08-15".' },
    section: { type: 'string', description: 'Section or table, e.g. "3.2 Power Budget".' },
  },
  required: ['doc'],
  additionalProperties: false,
}

/** 一条预算分配项。`value` 可以是数字（配 `unit`），也可以是 "≤ 500us" 这类文本。 */
const ITEM_SCHEMA = {
  type: 'object',
  description: 'One allocation or consumption line in a budget.',
  properties: {
    name: { type: 'string', description: 'Human label shown in the report, e.g. "DDR PHY active".' },
    value: {
      oneOf: [{ type: 'number' }, { type: 'string' }],
      description: 'A number (pair it with `unit`), or a quantity string like "512 MiB" or "<= 500 us".',
    },
    unit: { type: 'string', description: 'Unit for a numeric `value`; ignored when `value` already carries one.' },
    source: SOURCE_SCHEMA,
  },
  required: ['name', 'value'],
  additionalProperties: false,
}

/** 一个上限。量纲来自 `dimension`，或从 `unit` 推断。 */
const CAP_SCHEMA = {
  type: 'object',
  description: 'A ceiling for one dimension of the budget.',
  properties: {
    name: { type: 'string', description: 'Label for the ceiling, e.g. "MCU QSPI flash footprint".' },
    limit: {
      oneOf: [{ type: 'number' }, { type: 'string' }],
      description: 'The ceiling itself: a number (with `unit`) or a quantity string like "8 MiB".',
    },
    unit: { type: 'string', description: 'Unit for a numeric `limit`.' },
    dimension: { type: 'string', description: 'Explicit dimension (power, time, data, ...); inferred from the unit when omitted.' },
    source: SOURCE_SCHEMA,
  },
  required: ['name', 'limit'],
  additionalProperties: false,
}

const ITEMS_ARG = {
  type: 'array',
  description: 'The allocations to roll up. Items of different dimensions are grouped, never mixed.',
  items: ITEM_SCHEMA,
}

/** 把字符串数组描述成一个数组 schema（dsh 的 schema 子集没有 $ref，只能重复写）。 */
const stringArray = (description) => ({ type: 'array', description, items: { type: 'string' } })

// ---------------------------------------------------------------------------
// 解析与计算
// ---------------------------------------------------------------------------

/**
 * 把原始 items 解析成带量纲的分配项。
 * 解析失败的行不会被静默丢弃 —— 它们进入 `errors`，因为一条读不出来的预算行
 * 正是最该被人看见的那一行。
 */
function parseItems(rawItems) {
  const items = []
  const errors = []

  for (const [index, raw] of (rawItems ?? []).entries()) {
    const label = typeof raw?.name === 'string' && raw.name ? raw.name : `items[${index}]`
    if (!raw || typeof raw !== 'object') {
      errors.push(`${label}: entry is not an object`)
      continue
    }

    const quantity = parseQuantity(raw.value)
    if (!quantity.ok) {
      errors.push(`${label}: ${quantity.error}`)
      continue
    }

    // 文本里带的单位与独立的 `unit` 字段：两者都有且不一致时按矛盾报错，不替调用方选。
    // 只有一边出现而解析不了时也必须报出来 —— 一个拼错的 unit 字段读起来像「已经有单位了」，
    // 静默忽略它正是让错数字混进文档的方式。
    const fromText = quantity.unit === undefined ? undefined : canonicalUnit(quantity.unit)
    const fromField = raw.unit === undefined ? undefined : canonicalUnit(raw.unit)

    if (fromText && !fromText.ok) {
      errors.push(`${label}: ${fromText.error}`)
      continue
    }
    if (fromField && !fromField.ok) {
      errors.push(`${label}: unit: ${fromField.error}`)
      continue
    }
    if (fromText && fromField && fromText.canonical !== fromField.canonical) {
      errors.push(`${label}: value says "${quantity.unit}" but unit says "${raw.unit}" — pick one`)
      continue
    }

    const resolved = fromText ?? fromField
    if (!resolved) {
      errors.push(`${label}: no unit — a budget line without a unit cannot be summed`)
      continue
    }

    items.push({
      name: label,
      dimension: resolved.dimension,
      canonicalUnit: resolved.canonical,
      baseValue: quantity.value * unitFactor(resolved.dimension, resolved.canonical),
      qualifier: quantity.qualifier,
      source: raw.source,
    })
  }

  return { items, errors }
}

function unitFactor(dimension, canonical) {
  const converted = convert(1, canonical, baseUnit(dimension))
  if (!Number.isFinite(converted)) {
    // 走不到这里；走到就是内部 bug（例如别名没归一到规范名，或量纲对不上）。
    // **绝不兜底成 1** —— 那个兜底正是「500 µs 静默变成 500 s」的成因：NaN 被当成 1，
    // 结果错 10^6 倍还一路算到底、写进文档。宁可在这里炸掉。
    throw new Error(`units: no conversion factor for "${canonical}" in dimension "${dimension}"`)
  }
  return converted
}

/** 解析一个 cap，得到它的量纲、上限（基准单位下）与单位。 */
function parseCap(raw, index) {
  const label = typeof raw?.name === 'string' && raw.name ? raw.name : `caps[${index}]`
  if (!raw || typeof raw !== 'object') return { error: `${label}: entry is not an object` }

  const quantity = parseQuantity(raw.limit)
  if (!quantity.ok) return { error: `${label}: ${quantity.error}` }

  const unitText = quantity.unit ?? raw.unit
  const unit = unitText ? canonicalUnit(unitText) : undefined
  if (unit && !unit.ok) return { error: `${label}: ${unit.error}` }

  const dimension = raw.dimension ?? unit?.dimension
  if (!dimension) return { error: `${label}: cannot tell the dimension — give a unit or a dimension` }
  if (!baseUnit(dimension)) return { error: `${label}: unknown dimension "${dimension}"` }
  if (unit && unit.dimension !== dimension) {
    return { error: `${label}: unit "${unit.canonical}" is a ${unit.dimension} unit but dimension says "${dimension}"` }
  }
  if (quantity.value < 0) return { error: `${label}: a ceiling cannot be negative` }

  // 没给单位就按量纲基准单位理解，并在 note 里说清，避免读者猜。
  const limitUnit = unit?.canonical ?? baseUnit(dimension)
  const factor = unitFactor(dimension, limitUnit)

  return {
    cap: {
      name: label,
      dimension,
      limitUnit,
      limitBase: quantity.value * factor,
      unitAssumed: unit === undefined,
      source: raw.source,
    },
  }
}

/** 按量纲分组求和。 */
function groupByDimension(items) {
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.dimension)) {
      groups.set(item.dimension, { dimension: item.dimension, total: 0, items: [] })
    }
    const group = groups.get(item.dimension)
    group.total += item.baseValue
    group.items.push(item)
  }
  return groups
}

// ---------------------------------------------------------------------------
// se_budget_rollup
// ---------------------------------------------------------------------------

const ROLLUP_DIMENSION_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    displayUnit: { type: 'string' },
    total: { type: 'number', description: 'Total in `displayUnit`.' },
    totalBase: { type: 'number', description: 'Total in the dimension base unit.' },
    totalText: { type: 'string' },
    itemCount: { type: 'integer' },
    unprovenancedCount: { type: 'integer', description: 'Items carrying no source.' },
    qualifiedCount: { type: 'integer', description: 'Items written with a comparison prefix such as "<=".' },
  },
  required: ['dimension', 'displayUnit', 'total', 'totalBase', 'totalText', 'itemCount', 'unprovenancedCount', 'qualifiedCount'],
  additionalProperties: false,
}

const ROLLUP_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    dimensions: { type: 'array', items: ROLLUP_DIMENSION_SCHEMA },
    errors: stringArray('Lines that could not be parsed; each one is excluded from the totals.'),
    notes: stringArray('Caveats worth carrying into the document.'),
  },
  required: ['ok', 'dimensions', 'errors', 'notes'],
  additionalProperties: false,
}

const rollupTool = {
  name: 'se_budget_rollup',
  description:
    'Sum a list of budget allocations by dimension. Units are normalized (W/mW/uW, s/ms/us/ns, B/KiB/MiB, B/s vs Mbps, ...) and items of different dimensions are never mixed. Every total reports how many lines carried a provenance `source` and how many were written with a comparison prefix such as "<= 500 us" (which understates a total). Lines that cannot be parsed are returned in `errors`, never dropped silently.',
  parameters: {
    type: 'object',
    properties: {
      items: ITEMS_ARG,
      displayUnit: { type: 'string', description: 'Force one display unit; only valid when every item shares a dimension.' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  output: {
    schema: ROLLUP_SCHEMA,
    render(_args, value) {
      const lines = [`[rollup] ok=${value.ok}, ${value.dimensions.length} dimension(s)`]
      for (const entry of value.dimensions) {
        lines.push(
          `  ${entry.dimension}: ${entry.totalText} (${entry.itemCount} item(s), ` +
            `unprovenanced ${entry.unprovenancedCount}, qualified ${entry.qualifiedCount})`,
        )
      }
      lines.push(...prefixed('error', value.errors), ...prefixed('note', value.notes))
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args) {
    const { items, errors } = parseItems(args.items)
    const notes = []

    if (args.displayUnit !== undefined) {
      const forced = canonicalUnit(args.displayUnit)
      if (!forced.ok) errors.push(`displayUnit: ${forced.error}`)
    }

    const groups = groupByDimension(items)
    const dimensions = []
    for (const group of groups.values()) {
      let forcedUnit
      if (args.displayUnit !== undefined) {
        const forced = canonicalUnit(args.displayUnit)
        if (forced.ok && forced.dimension === group.dimension) forcedUnit = forced.canonical
        else if (forced.ok) notes.push(`displayUnit "${forced.canonical}" does not apply to "${group.dimension}" — auto-picked`)
      }
      // 自动挑显示单位时直接问 units 层，不要从格式化文本里反解单位（那是解析顺序依赖的脆弱做法）。
      const displayUnit = forcedUnit ?? pickDisplayUnit(group.dimension, group.total)
      const factor = unitFactor(group.dimension, displayUnit)
      dimensions.push({
        dimension: group.dimension,
        displayUnit,
        total: tidy(group.total / factor),
        totalBase: tidy(group.total),
        totalText: formatQuantity(group.total, group.dimension, forcedUnit),
        itemCount: group.items.length,
        unprovenancedCount: group.items.filter((item) => !item.source).length,
        qualifiedCount: group.items.filter((item) => item.qualifier).length,
      })
    }

    const unprovenanced = items.filter((item) => !item.source).length
    if (unprovenanced > 0) {
      notes.push(`${unprovenanced} of ${items.length} line(s) have no source — a total nobody can trace is not a budget`)
    }
    if (errors.length > 0) {
      notes.push(`totals exclude ${errors.length} unparsable line(s) — fix the input before quoting these numbers`)
    }

    return { ok: errors.length === 0, dimensions, errors, notes }
  },
}

// ---------------------------------------------------------------------------
// se_budget_check
// ---------------------------------------------------------------------------

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    capName: { type: 'string' },
    dimension: { type: 'string' },
    limitUnit: { type: 'string' },
    limitText: { type: 'string' },
    allocatedText: { type: 'string' },
    headroomText: { type: 'string', description: 'limit - allocated. Negative means the cap is broken.' },
    headroom: { type: 'number', description: 'Headroom in `limitUnit`.' },
    utilizationPercent: {
      oneOf: [{ type: 'number' }, { type: 'null' }],
      description: 'allocated / limit, in percent. Null when the limit is zero.',
    },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    unprovenancedCount: { type: 'integer' },
  },
  required: [
    'capName', 'dimension', 'limitUnit', 'limitText', 'allocatedText', 'headroomText',
    'headroom', 'utilizationPercent', 'verdict', 'unprovenancedCount',
  ],
  additionalProperties: false,
}

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    verdicts: { type: 'array', items: VERDICT_SCHEMA },
    uncappedDimensions: stringArray('Dimensions present in the items but covered by no cap.'),
    errors: stringArray('Caps or items that could not be evaluated.'),
    notes: stringArray('Caveats worth carrying into the document.'),
  },
  required: ['ok', 'verdict', 'verdicts', 'uncappedDimensions', 'errors', 'notes'],
  additionalProperties: false,
}

const checkTool = {
  name: 'se_budget_check',
  description:
    'Check a set of allocations against explicit ceilings and return a per-dimension PASS/FAIL verdict with the exact headroom. This is the gate the Verify phase should call instead of asserting a budget is fine by eye. Also reports dimensions that have allocations but no ceiling at all, and how many lines lacked provenance.',
  parameters: {
    type: 'object',
    properties: {
      items: ITEMS_ARG,
      caps: { type: 'array', description: 'The ceilings to check against.', items: CAP_SCHEMA },
    },
    required: ['items', 'caps'],
    additionalProperties: false,
  },
  output: {
    schema: CHECK_SCHEMA,
    render(_args, value) {
      const lines = [`[check] verdict=${value.verdict.toUpperCase()}, ${value.verdicts.length} cap(s)`]
      for (const entry of value.verdicts) {
        const percent = entry.utilizationPercent === null ? 'n/a' : `${entry.utilizationPercent}%`
        lines.push(
          `  ${entry.capName} [${entry.dimension}] limit ${entry.limitText}  allocated ${entry.allocatedText}  ` +
            `headroom ${entry.headroomText}  ${percent}  ${entry.verdict.toUpperCase()}`,
        )
      }
      if (value.uncappedDimensions.length > 0) {
        lines.push(`  uncapped dimensions: ${value.uncappedDimensions.join(', ')}`)
      }
      lines.push(...prefixed('error', value.errors), ...prefixed('note', value.notes))
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args) {
    const { items, errors } = parseItems(args.items)
    const notes = []

    const caps = []
    for (const [index, raw] of (args.caps ?? []).entries()) {
      const parsed = parseCap(raw, index)
      if (parsed.error) errors.push(parsed.error)
      else caps.push(parsed.cap)
    }

    const groups = groupByDimension(items)
    const verdicts = []
    for (const cap of caps) {
      const group = groups.get(cap.dimension)
      const allocatedBase = group?.total ?? 0
      const factor = unitFactor(cap.dimension, cap.limitUnit)
      const allocated = allocatedBase / factor
      const headroom = cap.limitBase / factor - allocated
      const utilization = cap.limitBase === 0 ? null : tidy((allocatedBase / cap.limitBase) * 100)

      verdicts.push({
        capName: cap.name,
        dimension: cap.dimension,
        limitUnit: cap.limitUnit,
        limitText: formatQuantity(cap.limitBase, cap.dimension, cap.limitUnit),
        allocatedText: formatQuantity(allocatedBase, cap.dimension, cap.limitUnit),
        headroomText: formatQuantity(headroom * factor, cap.dimension, cap.limitUnit),
        headroom: tidy(headroom),
        utilizationPercent: utilization,
        verdict: allocatedBase > cap.limitBase ? 'fail' : 'pass',
        unprovenancedCount: (group?.items ?? []).filter((item) => !item.source).length,
      })

      if (cap.unitAssumed) {
        notes.push(`cap "${cap.name}": no unit given, read as ${cap.limitUnit} (the ${cap.dimension} base unit)`)
      }
      if (!group) notes.push(`cap "${cap.name}": nothing was allocated against it`)
    }

    // 「过了但没有余量」是 Verify 阶段最该被看见的一类结果：它今天过，下一个需求来就不过。
    for (const entry of verdicts) {
      if (entry.verdict === 'pass' && entry.utilizationPercent !== null && entry.utilizationPercent >= 90) {
        notes.push(`"${entry.capName}" passes at ${entry.utilizationPercent}% — no room for the next requirement`)
      }
    }

    const cappedDimensions = new Set(caps.map((cap) => cap.dimension))
    const uncappedDimensions = [...groups.keys()].filter((dimension) => !cappedDimensions.has(dimension))
    if (uncappedDimensions.length > 0) {
      notes.push(`no ceiling declared for ${uncappedDimensions.join(', ')} — an uncapped budget is an unfinished one`)
    }

    const verdict = verdicts.some((entry) => entry.verdict === 'fail') || errors.length > 0 ? 'fail' : 'pass'
    return { ok: errors.length === 0, verdict, verdicts, uncappedDimensions, errors, notes }
  },
}

// ---------------------------------------------------------------------------
// se_budget_bottleneck
// ---------------------------------------------------------------------------

const CONSUMER_SCHEMA = {
  type: 'object',
  properties: {
    dimension: { type: 'string' },
    name: { type: 'string' },
    valueText: { type: 'string' },
    shareOfCapPercent: {
      oneOf: [{ type: 'number' }, { type: 'null' }],
      description: 'This item as a percentage of its dimension ceiling. Null when the dimension is uncapped.',
    },
  },
  required: ['dimension', 'name', 'valueText', 'shareOfCapPercent'],
  additionalProperties: false,
}

const TIGHTEST_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        capName: { type: 'string' },
        dimension: { type: 'string' },
        utilizationPercent: {
          oneOf: [{ type: 'number' }, { type: 'null' }],
          description: 'Null when the ceiling is zero.',
        },
        headroomText: { type: 'string' },
      },
      required: ['capName', 'dimension', 'utilizationPercent', 'headroomText'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
  description: 'The ceiling under the most pressure, or null when no ceiling was given.',
}

const BOTTLENECK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    tightest: TIGHTEST_SCHEMA,
    singleBottleneck: {
      oneOf: [
        {
          type: 'object',
          properties: {
            dimension: { type: 'string' },
            name: { type: 'string' },
            valueText: { type: 'string' },
            shareOfCapPercent: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          },
          required: ['dimension', 'name', 'valueText', 'shareOfCapPercent'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
      description: 'The single largest consumer inside the tightest dimension. This is the line to quote when arguing for a design change.',
    },
    topConsumers: { type: 'array', items: CONSUMER_SCHEMA },
    errors: stringArray('Lines that could not be parsed.'),
    notes: stringArray('Caveats worth carrying into the document.'),
  },
  required: ['ok', 'tightest', 'singleBottleneck', 'topConsumers', 'errors', 'notes'],
  additionalProperties: false,
}

const bottleneckTool = {
  name: 'se_budget_bottleneck',
  description:
    'Rank budget lines to answer "which one hurts most": the ceiling under the most pressure (tightest), the single largest consumer inside it, and the top consumers per dimension as a share of their ceiling. Use it when a budget passes but has no room left, to name the line a design change must move. With no caps it ranks by absolute size and reports shareOfCapPercent as null.',
  parameters: {
    type: 'object',
    properties: {
      items: ITEMS_ARG,
      caps: { type: 'array', description: 'Optional ceilings; supplying them turns the ranking into a share-of-cap ranking.', items: CAP_SCHEMA },
      top: { type: 'integer', description: 'How many consumers to list per dimension (1-10, default 3).' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  output: {
    schema: BOTTLENECK_SCHEMA,
    render(_args, value) {
      const lines = []
      if (value.tightest) {
        const percent = value.tightest.utilizationPercent === null ? 'n/a' : `${value.tightest.utilizationPercent}%`
        lines.push(`[bottleneck] tightest=${value.tightest.dimension} "${value.tightest.capName}" at ${percent}, headroom ${value.tightest.headroomText}`)
      } else {
        lines.push('[bottleneck] no ceilings given — ranked by absolute size')
      }
      if (value.singleBottleneck) {
        const percent = value.singleBottleneck.shareOfCapPercent === null ? 'n/a' : `${value.singleBottleneck.shareOfCapPercent}%`
        lines.push(`  single bottleneck: "${value.singleBottleneck.name}" ${value.singleBottleneck.valueText} (${percent} of the cap)`)
      }
      for (const consumer of value.topConsumers) {
        const percent = consumer.shareOfCapPercent === null ? 'n/a' : `${consumer.shareOfCapPercent}%`
        lines.push(`  ${consumer.dimension}: ${consumer.name} ${consumer.valueText} (${percent})`)
      }
      lines.push(...prefixed('error', value.errors), ...prefixed('note', value.notes))
      return [{ type: 'text', text: lines.join('\n') }]
    },
  },
  async execute(args) {
    const { items, errors } = parseItems(args.items)
    const notes = []

    let top = 3
    if (args.top !== undefined) {
      if (!Number.isInteger(args.top) || args.top < 1 || args.top > 10) {
        errors.push(`top: must be an integer between 1 and 10, got ${JSON.stringify(args.top)}`)
      } else {
        top = args.top
      }
    }

    const caps = []
    for (const [index, raw] of (args.caps ?? []).entries()) {
      const parsed = parseCap(raw, index)
      if (parsed.error) errors.push(parsed.error)
      else caps.push(parsed.cap)
    }
    if (caps.length === 0 && args.caps !== undefined && args.caps.length > 0) {
      notes.push('no usable ceiling, so shares fall back to null')
    }

    const groups = groupByDimension(items)
    const capByDimension = new Map(caps.map((cap) => [cap.dimension, cap]))

    const topConsumers = []
    for (const group of groups.values()) {
      const cap = capByDimension.get(group.dimension)
      const sorted = [...group.items].sort((a, b) => b.baseValue - a.baseValue).slice(0, top)
      for (const item of sorted) {
        topConsumers.push({
          dimension: group.dimension,
          name: item.name,
          valueText: formatQuantity(item.baseValue, group.dimension, cap?.limitUnit),
          shareOfCapPercent: cap && cap.limitBase > 0 ? tidy((item.baseValue / cap.limitBase) * 100) : null,
        })
      }
    }

    // tightest：利用率最高的那个 cap。limit 为 0 时用绝对占用兜底排序。
    const ranked = caps
      .map((cap) => {
        const allocated = groups.get(cap.dimension)?.total ?? 0
        return { cap, allocated, utilization: cap.limitBase > 0 ? allocated / cap.limitBase : Number.POSITIVE_INFINITY }
      })
      .sort((a, b) => b.utilization - a.utilization)

    let tightest = null
    let singleBottleneck = null
    if (ranked.length > 0) {
      const winner = ranked[0]
      tightest = {
        capName: winner.cap.name,
        dimension: winner.cap.dimension,
        utilizationPercent: winner.cap.limitBase === 0 ? null : tidy((winner.allocated / winner.cap.limitBase) * 100),
        headroomText: formatQuantity(winner.cap.limitBase - winner.allocated, winner.cap.dimension, winner.cap.limitUnit),
      }
      const group = groups.get(winner.cap.dimension)
      const largest = group ? [...group.items].sort((a, b) => b.baseValue - a.baseValue)[0] : undefined
      if (largest) {
        singleBottleneck = {
          dimension: winner.cap.dimension,
          name: largest.name,
          valueText: formatQuantity(largest.baseValue, winner.cap.dimension, winner.cap.limitUnit),
          shareOfCapPercent: winner.cap.limitBase > 0 ? tidy((largest.baseValue / winner.cap.limitBase) * 100) : null,
        }
      }
    }

    if (tightest && tightest.utilizationPercent !== null && tightest.utilizationPercent >= 90 && tightest.utilizationPercent <= 100) {
      notes.push(`"${tightest.capName}" is at ${tightest.utilizationPercent}% — passing but with no room for the next requirement`)
    }

    // 注意：output.schema 声明了 additionalProperties: false，返回对象必须**恰好**是
    // 声明的那几个键 —— 多一个下划线字段就会被 dsh 判为 ToolOutputError。
    return {
      ok: errors.length === 0,
      tightest,
      singleBottleneck,
      topConsumers,
      errors,
      notes,
    }
  },
}

/** 把一组字符串渲染成带前缀的行。 */
function prefixed(prefix, entries) {
  return (entries ?? []).map((entry) => `  ${prefix}: ${entry}`)
}

/** 本工具族的全部定义。 */
export const BUDGET_TOOL_DEFINITIONS = [rollupTool, checkTool, bottleneckTool]
