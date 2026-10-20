/**
 * 「用当前对话的 API 模型翻译」这一档 provider。
 *
 * 宿主侧的 `ctx.llm.stream()` 是 DSH 自己模型的统一入口：给它 provider/model、
 * 消息和 system 提示词，它就把 provider 适配、密钥、计费、重试都处理掉。
 * 这里把「当前会话上一次请求用的 provider/model」从 sessions 服务里读出来，
 * 再交给 ctx.llm 执行 —— 不复制密钥、不自己发 HTTP（红线：不落密钥）。
 */

import type { ProviderKind } from '../shared'
import type { TranslateContext, FetchLike, TranslateProvider } from './providers'
import { mapConcurrent, stripWrapping, targetLabel } from './providers'

/** 宿主注入的会话模型能力（由 index.ts 接到 cordis 服务上）。 */
export interface SessionModelHooks {
  /** 会话上一次请求的 provider/model；拿不到返回 undefined。 */
  resolveRoute: (sessionId: string | undefined) => { provider: string; model: string } | undefined
  /** 调一次模型并取回完整文本（CTX 内部 stream 聚合）。 */
  call: (request: {
    provider: string
    model: string
    system: string
    user: string
    maxTokens: number
    sessionId?: string
    signal: AbortSignal
  }) => Promise<string>
}

/** 翻译提示词（与本地模型共用同一套措辞）。 */
function translationSystem(target: string): string {
  return (
    `You are a translation engine. Translate the user message into ${targetLabel(target)}. ` +
    'Output only the translation, with no explanations, no quotes and no extra lines.'
  )
}

/** 输出 token 上限，避免模型写小作文。 */
function maxTokensFor(text: string): number {
  return Math.min(2048, Math.max(256, Math.ceil(text.length * 2)))
}

/** 构造「用对话模型翻译」的 provider。 */
export function createSessionModelProvider(hooks: SessionModelHooks): TranslateProvider {
  return {
    id: 'session',
    kind: 'session' as ProviderKind,
    label: 'Conversation API model',
    labelKey: 'provider.session',
    async translate(segments, target, signal, _fetchImpl: FetchLike, context?: TranslateContext) {
      const route = hooks.resolveRoute(context?.sessionId)
      if (route === undefined) {
        throw new Error('session: no provider/model for this conversation')
      }
      const system = translationSystem(target)
      return mapConcurrent(segments, 2, async (text) => {
        const raw = await hooks.call({
          provider: route.provider,
          model: route.model,
          system,
          user: text,
          maxTokens: maxTokensFor(text),
          ...(context?.sessionId === undefined ? {} : { sessionId: context.sessionId }),
          signal,
        })
        return stripWrapping(raw)
      })
    },
    async probe() {
      // 会话模型的实际可用性只有调用时才知道；这里乐观返回，失败会让链降级。
      return { available: true, detail: 'session model' }
    },
  }
}
