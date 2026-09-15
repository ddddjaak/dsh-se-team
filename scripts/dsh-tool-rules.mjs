#!/usr/bin/env node
/**
 * dsh tool registry 的规则复刻 —— 零依赖，供静态校验器与冒烟测试共用。
 *
 * 为什么要有这个文件：`ctx.tools.register()` 是强校验的，schema 用了子集外的关键字、
 * output 少了 render、返回值与 output.schema 不符，都是**运行期**才抛。把规则在本地复刻一份，
 * 就能在 `npm run validate` 里把这些问题拦下来，而不必先起一个 dsh 才看到报错。
 *
 * 复刻来源（dsh 安装内，逐条比对过）：
 *   - CONSTRAINT_KEYWORDS / ANNOTATION_KEYWORDS / SCHEMA_TYPES  → dsh-tools/lib/index.js:33-57
 *   - ONE_OF_SIBLING_KEYWORDS                                    → dsh-tools/lib/index.js:142-149
 *   - checkSchemaNode / checkObjectSchemaTail                     → dsh-tools/lib/index.js:151-314
 *   - output 必须有 { schema, render }                            → dsh-tools/lib/index.js:2776
 *   - run_code 是保留名                                           → dsh-tools/lib/index.js:2780
 *   - execute 的返回值按 output.schema 校验后才交给 render        → dsh-tools/lib/index.js:3415-3422
 *
 * 复刻不等于等价。这里只覆盖上面那张子集；dsh 版本升级后**必须回来对齐**，比对方法见
 * 本仓库 docs/dsh-setup.md 的「工具定义规则」一节。
 */

export const CONSTRAINT_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
])

export const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples'])

export const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']

const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean', 'null']

/** 每个字段只允许出现在这些 type 上。 */
const FIELD_TYPES = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: SCALAR_TYPES,
  const: SCALAR_TYPES,
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 一个标量是否属于某个 schema type。 */
function scalarMatches(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return false
  }
}

/**
 * 检查一个 schema 是否只用了 dsh 支持的子集。
 * @returns 违规描述数组；空数组表示通过。
 */
export function checkSchemaSubset(schema) {
  const violations = []
  // 环的判定是「节点出现在自己的**祖先链**上」，而不是「这个节点访问过」。
  // 同一个 schema 对象被多个位置共用是合法的 —— dsh 自己的实现就是按祖先栈进出
  // （dsh-tools 的 leave 任务会 seen.delete）。记成「访问过就跳过」会把共用 schema
  // 误报成环，这个坑在写这一版时真实踩到过：SOURCE_SCHEMA 在 items 与 caps 两处共用。
  const ancestors = new Set()

  const visit = (node, path) => {
    if (!isRecord(node)) {
      violations.push(`${path} must be a schema object`)
      return
    }
    if (ancestors.has(node)) {
      violations.push(`${path} is circular`)
      return
    }
    ancestors.add(node)
    try {
      walkNode(node, path)
    } finally {
      ancestors.delete(node)
    }
  }

  /** 单个节点自身的检查。递归子节点一律走 visit，由它维护祖先链。 */
  const walkNode = (node, path) => {
    for (const key of Object.keys(node)) {
      if (CONSTRAINT_KEYWORDS.has(key)) continue
      if (ANNOTATION_KEYWORDS.has(key)) continue
      violations.push(`${path}.${key} is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`)
    }

    if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
      violations.push(`${path}.description must be a string`)
    }
    if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
      violations.push(`${path}.title must be a string`)
    }

    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')

    if (hasType && hasOneOf) {
      violations.push(`${path} cannot declare both type and oneOf`)
      return
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`)
      }
      return
    }
    if (hasOneOf) {
      for (const key of ONE_OF_SIBLING_KEYWORDS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} is not supported beside oneOf`)
      }
      if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
        violations.push(`${path}.oneOf must be an array of at least two schemas`)
      } else {
        for (const [index, arm] of node.oneOf.entries()) visit(arm, `${path}.oneOf[${index}]`)
      }
      return
    }

    const type = node.type
    if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
      violations.push(Array.isArray(type)
        ? `${path}.type must be a single type string (type arrays are not supported)`
        : `${path}.type must be one of ${SCHEMA_TYPES.join('/')}`)
      return
    }

    for (const [key, allowed] of Object.entries(FIELD_TYPES)) {
      if (Object.hasOwn(node, key) && !allowed.includes(type)) {
        violations.push(`${path}.${key} is not supported on type "${type}"`)
      }
    }

    switch (type) {
      case 'object': {
        const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined
        if (Object.hasOwn(node, 'properties')) {
          if (!isRecord(properties)) {
            violations.push(`${path}.properties must be an object of schemas`)
          } else {
            for (const [key, child] of Object.entries(properties)) visit(child, `${path}.properties.${key}`)
          }
        }
        if (Object.hasOwn(node, 'required')) {
          const required = node.required
          if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
            violations.push(`${path}.required must be an array of strings`)
          } else {
            const declared = isRecord(properties) ? properties : {}
            for (const key of required) {
              if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`)
            }
          }
        }
        if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
          violations.push(`${path}.additionalProperties must be a boolean`)
        }
        break
      }
      case 'array':
        if (Object.hasOwn(node, 'items')) visit(node.items, `${path}.items`)
        break
      default: {
        if (Object.hasOwn(node, 'enum')) {
          const allowed = node.enum
          const valid = Array.isArray(allowed) && allowed.length > 0 && allowed.every((entry) => scalarMatches(type, entry))
          if (!valid) violations.push(`${path}.enum must be a non-empty array of ${type} values`)
        }
        if (Object.hasOwn(node, 'const')) {
          const declared = node.const
          const valid = scalarMatches(type, declared)
          if (!valid) violations.push(`${path}.const must be a ${type} value`)
          else if (Array.isArray(node.enum) && !node.enum.includes(declared)) {
            violations.push(`${path}.const must be one of ${path}.enum when both are declared`)
          }
        }
        break
      }
    }
  }

  visit(schema, 'schema')
  return violations
}

/**
 * 按 schema 校验一个值 —— 复刻 dsh 对 execute 返回值的校验（violations 非空即 ToolOutputError）。
 * @returns 违规描述数组；空数组表示通过。
 */
export function validateValue(schema, value, path = 'value') {
  if (!isRecord(schema)) return []

  if (Object.hasOwn(schema, 'oneOf')) {
    const matching = schema.oneOf.filter((arm) => validateValue(arm, value, path).length === 0)
    if (matching.length === 1) return []
    return [`${path} must match exactly one oneOf arm (matched ${matching.length})`]
  }

  const type = schema.type
  if (type === undefined) return []
  if (!scalarMatchesSchemaType(type, value)) {
    return [`${path} must be ${type}, got ${describe(value)}`]
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => entry === value)) {
    return [`${path} must be one of ${JSON.stringify(schema.enum)}`]
  }
  if (Object.hasOwn(schema, 'const') && schema.const !== value) {
    return [`${path} must equal ${JSON.stringify(schema.const)}`]
  }

  if (type === 'object') {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const violations = []
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) violations.push(`${path}.${key} is required`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) violations.push(`${path}.${key} is not declared in properties (additionalProperties: false)`)
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) violations.push(...validateValue(child, value[key], `${path}.${key}`))
    }
    return violations
  }

  if (type === 'array' && schema.items !== undefined) {
    return value.flatMap((entry, index) => validateValue(schema.items, entry, `${path}[${index}]`))
  }

  return []
}

function scalarMatchesSchemaType(type, value) {
  if (type === 'object') return isRecord(value)
  if (type === 'array') return Array.isArray(value)
  return scalarMatches(type, value)
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/**
 * 检查一个工具定义是否符合 registry 的硬要求。
 * @returns 违规描述数组；空数组表示可以 register。
 */
export function checkToolDefinition(definition) {
  const violations = []
  const name = definition?.name

  if (typeof name !== 'string' || name === '') {
    violations.push('tool definition has no "name"')
    return violations
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    violations.push(`tool "${name}": name must be snake_case starting with a letter`)
  }
  if (name === 'run_code') {
    violations.push('tool "run_code" is reserved for the PTC presentation transport')
  }
  if (typeof definition.description !== 'string' || definition.description === '') {
    violations.push(`tool "${name}" has no description`)
  }
  if (typeof definition.execute !== 'function') {
    violations.push(`tool "${name}" has no execute function`)
  }

  violations.push(...checkSchemaSubset(definition.parameters).map((entry) => `tool "${name}" parameters: ${entry}`))

  // output 这一条是 register() 里最先抛的：{ schema, render } 缺一不可。
  const output = definition.output
  if (!isRecord(output)) {
    violations.push(`tool "${name}" must declare output { schema, render }`)
  } else {
    if (typeof output.render !== 'function') {
      violations.push(`tool "${name}" output.render must be a function`)
    }
    violations.push(...checkSchemaSubset(output.schema).map((entry) => `tool "${name}" output.schema: ${entry}`))
  }

  return violations
}
