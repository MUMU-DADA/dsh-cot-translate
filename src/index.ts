/**
 * Host 半：provider 适配 + 翻译 HTTP 接口。
 *
 * 现状：骨架（不注册任何路由，不调用任何模型）。
 *
 * 计划提供（见 docs/ARCHITECTURE.md、docs/ROADMAP.md M2）：
 *   POST /_cotx/translate  { target, segments } -> { translations, provider }
 *   GET  /_cotx/providers  -> 当前 provider 链与可用性
 *   GET  /_cotx/models     -> 本地 Ollama 可用模型
 *
 * 约束：
 * - 只处理自然语言；剔除逻辑在 client 半完成；
 * - 不把原文/译文写进会话或日志；
 * - 密钥只从环境变量或 ~/.dsh/.credentials.yaml 运行期解析。
 */
import type { TranslateRequest, TranslateResponse } from './shared'

export const name = 'dsh-cot-translate'

/**
 * Cordis 插件入口。实现阶段把 ctx 换成 @deepseek-ai/cordis 的 Context，
 * 并在这里注册 webServer 路由与 provider 服务。
 */
export function apply(ctx: unknown): void {
  void ctx
  // 占位，确保共享类型被引用（实现时删除）。
  void (null as unknown as TranslateRequest)
  void (null as unknown as TranslateResponse)
}
