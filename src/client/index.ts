/**
 * Client 半：注册 UI、订阅思考节点、分批翻译。
 *
 * 现状：骨架（不注册任何槽位，不发起任何请求）。
 *
 * 计划（见 docs/ROADMAP.md M1/M3）：
 *   1. 通过 ChatNodeStore 订阅当前回合的 assistant-step 节点，取 reasoning 文本
 *      （含 hidden 节点；reasoning 与回答用 groupPart 区分）
 *   2. 剔除代码块/行内代码/路径/命令/URL，按段落→句子分批
 *   3. POST 同源 /_cotx/translate，逐批把译文渲染到 Think 行附近
 *   4. 设置页：目标语言、provider 顺序、翻译时机（懒加载 / 全量 / 仅展开）
 *
 * 兼容基线：DSH 0.2.0-rc.2 + cordis 4.0.4。
 */
import { LOCALES } from './locales.ts'

export const name = 'dsh-cot-translate'

/**
 * Cordis 客户端插件入口。实现阶段把 ctx 换成 @deepseek-ai/cordis 的 Context，
 * 并在 ctx.inject(['slots', ...]) 里注册 UI。
 */
export function apply(ctx: unknown): void {
  void ctx
  // 占位，确保文案表被引用（实现时删除）。
  void LOCALES
}
