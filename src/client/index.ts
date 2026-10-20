/**
 * Client 半：在 shell 的思考块展开时注入双语对照面板（左原文 / 右译文）。
 *
 * 为什么不走槽位：`conversation.chat.node` 是 keyed 槽位，注册 `assistant-step`
 * 会**替换**官方 Assistant 渲染器（shadow shipped UI）；官方也没有 reasoning
 * 级别的子槽位。所以采用「观察展开态 + 就地注入面板」，原文优先从
 * ChatNodeStore 数据层取（保证围栏代码不被当成自然语言），拿不到才退回 DOM 文本。
 * 详见 docs/DECISIONS.md ADR-011 / ADR-014。
 *
 * 兼容基线：DSH 0.2.0-rc.2 + cordis 4.0.4。
 */

import { attachBilingual } from './attach'
import type { AssistantStepData } from './chat'
import type { ClientContext } from './cordis'
import { LOCALES } from './locales'
import { installStyles } from './styles'
import { sharedTranslator } from './translate'

/** 包名，同时作为 locale 命名空间。 */
export const name = 'dsh-cot-translate'

/** 需要宿主提供的客户端服务（cordis 服务名，不是包名）。 */
export const inject = ['locale', 'sessions', 'uiConversation']

/**
 * 数据层取原文：会话 + 节点 key → 该 assistant-step 节点里第 `rowIndex` 个
 * reasoning 块的文本。拿不到返回 undefined（attach 会退回 DOM 文本）。
 */
function reasoningTextAt(
  ctx: ClientContext,
  sessionId: string,
  nodeKey: string,
  rowIndex: number,
): string | undefined {
  try {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return undefined
    const snapshot = ctx.uiConversation.binding(binding).target('chat').getSnapshot()
    if (snapshot === undefined) return undefined
    const node = snapshot.nodes.source(nodeKey).getSnapshot()
    const blocks: AssistantStepData['blocks'] = node?.data.blocks
    const reasoning = (blocks ?? []).filter((block) => block.kind === 'reasoning')
    return reasoning[rowIndex]?.text
  } catch {
    // 会话切换 / 目标未就绪时的瞬时状态：交给 DOM 文本兜底。
    return undefined
  }
}

/**
 * Cordis 客户端插件入口。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(name, LOCALES), `${name}: dictionaries`)
  ctx.effect(installStyles, `${name}: styles`)
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const handle = attachBilingual({
      document,
      translator: sharedTranslator(),
      t: ctx.locale.bind(name),
      lookup: (sessionId, nodeKey, rowIndex) => reasoningTextAt(ctx, sessionId, nodeKey, rowIndex),
    })
    return () => handle.dispose()
  }, `${name}: bilingual attach`)
}

// ── 供测试直接引用的纯逻辑（对宿主 Loader 无副作用）─────────────────────
export { attachBilingual } from './attach'
export { createBilingualPanel } from './bilingual'
export { collectReasoning, reasoningCharCount, singleLinePreview } from './chat'
export {
  MAX_CHUNK_CHARS,
  MAX_CHARS_PER_REQUEST,
  MAX_CHUNKS_PER_REQUEST,
  batchChunks,
  keepRanges,
  sentenceChunks,
  splitForTranslation,
} from './strip'
export { isTechnicalOnly, normalizeMarkdownLite, paragraphsOf, renderSpansInto } from './text'
export { TRANSLATE_ENDPOINT, TextTranslator, sharedTranslator } from './translate'
