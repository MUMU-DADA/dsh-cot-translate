/**
 * Client 半的翻译流水线：切分 → 分批 → 同源请求 → 按原位拼回。
 *
 * 语义（ARCHITECTURE“翻译流水线”）：
 * - 只翻自然语言，技术片段由 strip.ts 分段保留；
 * - 多段（双语面板的每个段落）**合并成批**请求，避免一段一个请求；
 * - 失败 fail-open：返回原文与 ok=false，界面显示原文；
 * - 进程内缓存：同一段思考重渲染不重复请求（host 侧还有一层 LRU）。
 *
 * 不写 localStorage、不碰会话数据；译文只进组件状态。
 */

import type { TranslateResponse } from '../shared'
import type { TextSpan } from './strip'
import {
  MAX_CHARS_PER_REQUEST,
  MAX_CHUNKS_PER_REQUEST,
  sentenceChunks,
  splitForTranslation,
} from './strip'

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

/** 一个待翻文本的翻译计划。 */
interface Plan {
  readonly original: string
  readonly spans: TextSpan[]
  readonly perSpan: Array<string[] | undefined>
  /** 该文本的块在全局 chunks 里的下标，按 (span, chunk) 顺序。 */
  readonly chunkIds: number[]
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

  /** 翻译一段文本；没有可翻内容时原样返回且 ok=true。 */
  async translate(text: string): Promise<TranslateOutcome> {
    const [only] = await this.translateMany([text])
    return only ?? { ok: false, text, provider: '' }
  }

  /**
   * 批量翻译多段文本，返回顺序与入参一致。
   * 所有文本的自然语言块合并成批发送（每批 ≤8 块 / ≤1200 字符）。
   */
  async translateMany(texts: readonly string[]): Promise<TranslateOutcome[]> {
    const outcomes: Array<TranslateOutcome | undefined> = new Array(texts.length)
    const plans: Plan[] = []
    const chunks: string[] = []
    const owners: number[] = []
    const failedTexts = new Set<number>()

    for (let index = 0; index < texts.length; index += 1) {
      const original = texts[index]
      const cached = this.cache.get(original)
      if (cached !== undefined) {
        this.remember(original, cached)
        outcomes[index] = cached
        continue
      }
      const spans = splitForTranslation(original)
      // 只有含自然语言的片段才切块；纯空白片段（技术片段之间的缝隙）保持原样。
      const perSpan = spans.map((span) =>
        span.translate && span.text.trim() !== '' ? sentenceChunks(span.text) : undefined,
      )
      const chunkIds: number[] = []
      perSpan.forEach((batch, spanIndex) => {
        batch?.forEach((_chunk, chunkIndex) => {
          chunkIds.push(chunks.length)
          chunks.push(perSpan[spanIndex]![chunkIndex])
          owners.push(index)
        })
      })
      if (chunkIds.length === 0) {
        outcomes[index] = { ok: true, text: original, provider: 'none' }
        continue
      }
      plans.push({ original, spans, perSpan, chunkIds })
    }

    if (plans.length === 0) {
      return outcomes.map(
        (outcome, index) => outcome ?? { ok: false, text: texts[index], provider: '' },
      )
    }

    const translations: string[] = new Array(chunks.length).fill('')
    let provider = ''
    const ranges = batchRanges(chunks.map((chunk) => chunk.length))
    for (const [start, end] of ranges) {
      try {
        const result = await this.request(chunks.slice(start, end))
        result.translations.forEach((translation, offset) => {
          translations[start + offset] = translation
        })
        if (result.provider !== '') provider = result.provider
      } catch {
        for (let index = start; index < end; index += 1) failedTexts.add(owners[index])
      }
    }

    for (const plan of plans) {
      const index = owners[plan.chunkIds[0]]
      if (failedTexts.has(index)) {
        outcomes[index] = { ok: false, text: plan.original, provider: '' }
        continue
      }
      const missing = plan.chunkIds.some((id) => translations[id].trim() === '')
      if (missing) {
        outcomes[index] = { ok: false, text: plan.original, provider: '' }
        continue
      }
      const assembled = assemble(plan, translations)
      const outcome: TranslateOutcome = { ok: true, text: assembled, provider: provider === '' ? 'cache' : provider }
      this.remember(plan.original, outcome)
      outcomes[index] = outcome
    }

    return outcomes.map(
      (outcome, index) => outcome ?? { ok: false, text: texts[index], provider: '' },
    )
  }

  private remember(text: string, outcome: TranslateOutcome): void {
    this.cache.delete(text)
    this.cache.set(text, outcome)
    if (this.cache.size <= CACHE_LIMIT) return
    const oldest = this.cache.keys().next()
    if (!oldest.done) this.cache.delete(oldest.value)
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

/** 按全局块下标分批：每批 ≤8 块、≤1200 字符。 */
function batchRanges(lengths: readonly number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let start = 0
  let chars = 0
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (
      index > start &&
      (index - start >= MAX_CHUNKS_PER_REQUEST || chars + length > MAX_CHARS_PER_REQUEST)
    ) {
      ranges.push([start, index])
      start = index
      chars = 0
    }
    chars += length
  }
  if (start < lengths.length) ranges.push([start, lengths.length])
  return ranges
}

/** 按原顺序拼回：技术片段原样，译文块之间用空格连接。 */
function assemble(plan: Plan, translations: readonly string[]): string {
  let cursor = 0
  return plan.spans
    .map((span, spanIndex) => {
      if (!span.translate) return span.text
      const chunks = plan.perSpan[spanIndex]
      if (chunks === undefined || chunks.length === 0) return span.text
      const values: string[] = []
      for (let index = 0; index < chunks.length; index += 1) {
        values.push(translations[plan.chunkIds[cursor]].trim())
        cursor += 1
      }
      return values.join(' ')
    })
    .join('')
}

/** 组件共用的默认实例（懒创建，避免模块加载时就摸 fetch）。 */
let shared: TextTranslator | undefined

export function sharedTranslator(): TextTranslator {
  shared ??= new TextTranslator()
  return shared
}
