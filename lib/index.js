/**
 * dsh-se-skills —— SE 工作流技能的 DeepSeek Harness 插件入口。
 *
 * 双轨注册（与姊妹包 dsh-ae-team 同一设计）：
 *   - skills/ 下的 16 个 SE 工作流技能由 dsh-skill-filesystem provider 直供
 *     （providerName: se-skills），改文件即生效（live），本轮不在此注册。
 *   - 本插件负责 agents/（5 个评审角色）与 commands/（6 个 /se-* 入口）。
 *     两者改动需重启 dsh 服务后生效。
 *
 * 为什么入口零依赖（只用 node: 内建模块）：插件以 `dsh plugin add link:<dir>`
 * 安装，profile 的 node_modules 里是指向本仓库的符号链接；node 默认按 realpath
 * 解析，从 D:\tags\se-skills\lib 向上找不到 ~/.dsh/profiles 下的
 * @deepseek-ai/*，静态 import 会在加载期直接失败。除非改为 npm 发布安装，
 * 否则本文件不得引入任何外部依赖。
 *
 * 调用策略（dsh 的两条回路）：
 *   - 评审角色：modelInvocable + userInvocable —— 模型可装入作为 subagent 指令，
 *     用户也可用 /system-architect 之类显式调用。
 *   - /se-* 入口：仅 userInvocable —— 它们是人在回路的快捷入口，不进驻模型目录。
 *     用户在输入框敲 /se-goal <目标> 时，dsh 会把该技能正文注入为 user 角色指令，
 *     与 modelInvocable 无关；模型侧的路由一律交给 using-se-skills 元技能。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 稳定的 cordis 插件名。 */
export const name = 'dsh-se-skills'

/** 依赖 skills 服务，确保 apply 时 skill registry 已就绪。 */
export const inject = ['skills']

/** 仓库根目录（lib/ 的上一级）。 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 注册时打在本包技能上的 provider 标签，与 providerName 同名以便溯源。 */
const PROVIDER = 'se-skills'

/** 评审角色：模型与用户两条回路都放行。 */
const PERSONA_POLICY = { modelInvocable: true, userInvocable: true }

/** /se-* 入口：只走用户回路。 */
const ENTRY_POLICY = { modelInvocable: false, userInvocable: true }

/** 日志前缀统一，便于在 host 日志里 grep。 */
function warn(ctx, message) {
  if (ctx.logger?.warn) ctx.logger.warn(`se-skills: ${message}`)
}

/** 取 frontmatter 中某个键的值，去掉包裹引号；缺省返回 undefined。 */
function frontmatterValue(frontmatter, key) {
  const matched = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'))
  return matched?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined
}

/**
 * 解析一个技能文件的 YAML frontmatter 与正文。
 * @param file - 技能文件的绝对路径。
 * @param fallbackName - frontmatter 未声明 name 时用文件名兜底。
 */
function parseSkillFile(file, fallbackName) {
  const raw = readFileSync(file, 'utf8')
  const matched = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const frontmatter = matched?.[1] ?? ''
  return {
    name: frontmatterValue(frontmatter, 'name') ?? fallbackName,
    description: frontmatterValue(frontmatter, 'description') ?? '',
    whenToUse: frontmatterValue(frontmatter, 'whenToUse') ?? frontmatterValue(frontmatter, 'when-to-use'),
    content: (matched?.[2] ?? raw).trim(),
  }
}

/**
 * 把一个目录下的扁平 <name>.md 全部注册为技能。
 * @param ctx - cordis 上下文。
 * @param directory - 相对仓库根的目录名。
 * @param policy - 调用策略（模型/用户回路开关）。
 * @param skip - 需要跳过的文件名判定，例如各目录的 README.md。
 */
function registerSkillDirectory(ctx, directory, policy, skip) {
  const registry = ctx.get('skills')
  if (!registry) return
  const root = join(PACKAGE_ROOT, directory)
  if (!existsSync(root)) return

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    if (skip(entry.name)) continue

    const file = join(root, entry.name)
    const skill = parseSkillFile(file, entry.name.replace(/\.md$/, ''))
    if (!skill.description) {
      warn(ctx, `${directory}/${entry.name} skipped: frontmatter has no description`)
      continue
    }

    try {
      registry.register({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        content: skill.content,
        path: file,
        provider: PROVIDER,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: root },
        invocation: policy,
      })
    } catch (error) {
      warn(ctx, `skill "${skill.name}" skipped: ${error.message}`)
    }
  }
}

/** 插件入口：注册评审角色与 /se-* 入口技能。 */
export function apply(ctx) {
  const isReadme = (fileName) => fileName.toLowerCase() === 'readme.md'
  registerSkillDirectory(ctx, 'commands', ENTRY_POLICY, isReadme)
  registerSkillDirectory(ctx, 'agents', PERSONA_POLICY, isReadme)
}
