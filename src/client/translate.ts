/**
 * Client 半的翻译流水线：切分 → 分批 → 同源请求 → 按原位拼回。
 *
 * 语义（ARCHITECTURE“翻译流水线”）：
 * - 只翻自然语言，技术片段由 strip.ts 分段保留；
 * - 失败 fail-open：返回原文与 ok=false，界面显示原文；
 * - 进程内缓存：同一段思考重渲染不重复请求（host 侧还有一层 LRU）。
 *
 * 不写 localStorage、不碰会话数据；译文只进组件状态。
 */

import type { TranslateResponse } from '../shared'
import { batchChunks, sentenceChunks, splitForTranslation } from './strip'

/** 同源路由（host 半注册，见 src/host/routes.ts）。 */
export const TRANSLATE_ENDPOINT = '/_cotx/translate'

/** 单次请求超时：本地模型首次加载可能几秒，给足余量。 */
const REQUEST_TIMEOUT_MS = 20000

/** client 侧缓存条数上限。 */
const CACHE_LIMIT = 500

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface TranslateOutcome {
  /** 是否拿到了可信译文；false 表示应显示原文。 */
  ok: boolean
  /** 拼好的整段文本（成功为译文，失败为原文）。 */
  text: string
  /** 实际 provider（"ollama" / "google" / "cache" / "" / "none"）。 */
  provider: string
}

export interface TextTranslatorOptions {
  endpoint?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
}

/** 一段文本 → 中文（同源 HTTP）。 */
export class TextTranslator {
  private readonly cache = new Map<string, TranslateOutcome>()
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly fetchImpl: FetchLike | undefined

  constructor(options: TextTranslatorOptions = {}) {
    this.endpoint = options.endpoint ?? TRANSLATE_ENDPOINT
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl
  }

  /** 清空 client 缓存（设置变更时用）。 */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 翻译一段文本。
   * 没有可翻内容（纯代码/路径）时原样返回且 ok=true。
   */
  async translate(text: string): Promise<TranslateOutcome> {
    const cached = this.cache.get(text)
    if (cached !== undefined) {
      this.cache.delete(text)
      this.cache.set(text, cached)
      return cached
    }
    const outcome = await this.translateUncached(text)
    this.remember(text, outcome)
    return outcome
  }

  private remember(text: string, outcome: TranslateOutcome): void {
    this.cache.set(text, outcome)
    if (this.cache.size <= CACHE_LIMIT) return
    const oldest = this.cache.keys().next()
    if (!oldest.done) this.cache.delete(oldest.value)
  }

  private async translateUncached(text: string): Promise<TranslateOutcome> {
    const spans = splitForTranslation(text)
    const translating = spans.filter((span) => span.translate && span.text.trim() !== '')
    if (translating.length === 0) return { ok: true, text, provider: 'none' }

    // 每个要翻的片段切成句子块；块与片段按下标对应，便于回填。
    const perSpanChunks: Array<string[] | undefined> = spans.map((span) =>
      span.translate ? sentenceChunks(span.text) : undefined,
    )
    const flat: Array<{ span: number; chunk: number }> = []
    perSpanChunks.forEach((chunks, spanIndex) => {
      chunks?.forEach((_chunk, chunkIndex) => {
        flat.push({ span: spanIndex, chunk: chunkIndex })
      })
    })
    if (flat.length === 0) return { ok: true, text, provider: 'none' }

    const texts = flat.map(({ span, chunk }) => perSpanChunks[span]![chunk])
    const translations: string[] = new Array(flat.length).fill('')
    let provider = ''

    try {
      const batches = batchChunks(texts)
      let offset = 0
      for (const batch of batches) {
        const result = await this.request(batch)
        result.translations.forEach((translation, index) => {
          translations[offset + index] = translation
        })
        offset += batch.length
        if (result.provider !== '') provider = result.provider
      }
    } catch {
      // fail-open：整段退回原文，避免半中半英的错位显示。
      return { ok: false, text, provider: '' }
    }

    if (translations.some((translation) => translation.trim() === '')) {
      return { ok: false, text, provider: '' }
    }

    // 按原顺序拼回：保留片段原样，译文块之间用空格连接。
    const filled: string[][] = []
    let cursor = 0
    const assembled = spans
      .map((span, spanIndex) => {
        if (!span.translate) return span.text
        const chunks = perSpanChunks[spanIndex]
        if (chunks === undefined || chunks.length === 0) return span.text
        const values: string[] = []
        for (let index = 0; index < chunks.length; index += 1) {
          values.push(translations[cursor].trim())
          cursor += 1
        }
        filled.push(values)
        return values.join(' ')
      })
      .join('')

    return { ok: true, text: assembled, provider: provider === '' ? 'cache' : provider }
  }

  private async request(segments: string[]): Promise<TranslateResponse> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch
    const response = await fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ segments }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`translate: HTTP ${response.status}`)
    const payload = (await response.json()) as TranslateResponse
    if (
      !Array.isArray(payload.translations) ||
      payload.translations.length !== segments.length ||
      typeof payload.provider !== 'string'
    ) {
      throw new Error('translate: malformed response')
    }
    return payload
  }
}

/** 组件共用的默认实例（懒创建，避免模块加载时就摸 fetch）。 */
let shared: TextTranslator | undefined

export function sharedTranslator(): TextTranslator {
  shared ??= new TextTranslator()
  return shared
}
