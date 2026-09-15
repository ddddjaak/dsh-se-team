/**
 * SE 工具族的注册入口。
 *
 * 这些是**第一方原生工具**，直接进 dsh 的 tool registry（`ctx.tools.register()`），
 * 不经过 MCP 子进程 —— dsh-mcp-client 桥接 MCP 工具时用的就是同一张注册表
 * （它的 `inject = ["tools"]`），所以为自研工具再套一层 MCP 只会多一个进程、
 * 一次 JSON-RPC 跳转和一套无关的 schema 方言，换不到任何东西。
 *
 * 本文件零依赖（只允许相对引用本包文件与 node: 内建模块）。
 */
import { BUDGET_TOOL_DEFINITIONS } from './budget.js'

/** 本包注册的全部原生工具定义。校验器与冒烟测试都读这份清单。 */
export const SE_TOOL_DEFINITIONS = [...BUDGET_TOOL_DEFINITIONS]

/**
 * 把本包的工具族注册进 dsh 的 tool registry。
 * @param ctx - 带 `tools` 服务的 cordis 上下文。
 * @param warn - 本包的告警函数 `(ctx, message) => void`。
 * @returns 卸载函数：注销本次全部注册。`register()` 返回的就是精确的注销函数，
 *   dsh 自己的 mcp-client 也照这个契约做代际交换，所以必须留着而不是丢掉。
 */
export function registerSeTools(ctx, warn) {
  const tools = ctx.get?.('tools') ?? ctx.tools
  if (!tools) {
    warn(ctx, 'the tools service is unavailable — the SE tool families were not registered')
    return () => {}
  }

  const disposers = []
  for (const definition of SE_TOOL_DEFINITIONS) {
    try {
      disposers.push(tools.register(definition))
    } catch (error) {
      // 单个工具被注册表拒绝（名字冲突、schema 不在子集内…）不该带走整个插件。
      warn(ctx, `tool "${definition.name}" was not registered: ${error.message}`)
    }
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载路径上的失败无处上报，也不该再抛。
      }
    }
  }
}
