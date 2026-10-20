/**
 * provider 适配器：把“一段英文 → 一段中文”抽象成统一的 translate()。
 *
 * 当前两个实现：
 *  1. ollama —— 本地 Hy-MT2（ADR-004），走 `/api/chat`，非流式、逐段串行；
 *  2. google —— 官方免费接口（非官方授权），仅作为最后兜底（ADR-008）。
 *
 * 红线段（AGENTS.md）：这里**不做**任何代码/路径剔除 —— 剔除是 client 半的
 * 责任，送进来的 segments 已经是自然语言。适配器也不打印原文，只报长度与耗时。
 */

import type { ProviderKind } from '../shared'
import type { CotConfig } from './config'

/** 只取 fetch 的可调用签名，便于单测注入假实现。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderProbe {
  available: boolean
  /** 不可用时的人类可读原因（不含任何密钥/原文）。 */
  detail?: string
}

export interface TranslateProvider {
  id: string
  kind: ProviderKind
  label: string
  /** 本地模型名（远程 provider 没有）。 */
  model?: string
  /**
   * 逐段翻译，返回与输入等长的数组；任何一段失败即整体抛错，
   * 由 provider 链降级到下一档（不做半成功，避免译文错位）。
   */
  translate(
    segments: readonly string[],
    target: string,
    signal: AbortSignal,
    fetchImpl: FetchLike,
  ): Promise<string[]>
  probe(signal: AbortSignal, fetchImpl: FetchLike): Promise<ProviderProbe>
  listModels?(signal: AbortSignal, fetchImpl: FetchLike): Promise<string[]>
}

/** 目标语言 → 提示词里用的语言名。 */
const TARGET_LABELS: Record<string, string> = {
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
}

/** target 的提示词写法；未知语言直接给原值。 */
export function targetLabel(target: string): string {
  return TARGET_LABELS[target] ?? target
}

/** target → Google 的 tl 参数。 */
function googleTarget(target: string): string {
  if (target === 'zh-Hans') return 'zh-CN'
  if (target === 'zh-Hant') return 'zh-TW'
  return target
}

/**
 * Hy-MT2 是翻译专用模型，指令遵循一般（RESEARCH §6）：提示词短、指令单一，
 * 不要附加解释或格式要求。
 */
function ollamaMessages(text: string, target: string): Array<{ role: string; content: string }> {
  return [
    {
      role: 'system',
      content:
        `You are a translation engine. Translate the user message into ${targetLabel(target)}. ` +
        'Output only the translation, with no explanations, no quotes and no extra lines.',
    },
    { role: 'user', content: text },
  ]
}

/** 官方推荐采样参数（1.8B / 7B 同款）。 */
const HY_MT2_OPTIONS = {
  temperature: 0.7,
  top_p: 0.6,
  top_k: 20,
  repeat_penalty: 1.05,
} as const

/** Ollama 本地 provider。 */
export function createOllamaProvider(config: CotConfig['ollama']): TranslateProvider {
  const base = config.baseURL
  return {
    id: 'ollama',
    kind: 'ollama',
    label: '本地 Hy-MT2',
    model: config.model,
    async translate(segments, target, signal, fetchImpl) {
      const out: string[] = []
      for (const text of segments) {
        const body: Record<string, unknown> = {
          model: config.model,
          messages: ollamaMessages(text, target),
          stream: false,
          options: HY_MT2_OPTIONS,
        }
        if (config.keepAlive !== '') body.keep_alive = config.keepAlive
        const response = await fetchImpl(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
        if (!response.ok) {
          throw new Error(`ollama: HTTP ${response.status}`)
        }
        const payload = (await response.json()) as { message?: { content?: unknown } }
        const content = payload.message?.content
        if (typeof content !== 'string') throw new Error('ollama: malformed response')
        out.push(stripWrapping(content))
      }
      return out
    },
    async probe(signal, fetchImpl) {
      try {
        const response = await fetchImpl(`${base}/api/tags`, { signal })
        if (!response.ok) return { available: false, detail: `HTTP ${response.status}` }
        const payload = (await response.json()) as { models?: Array<{ name?: unknown }> }
        const names = (payload.models ?? [])
          .map((model) => (typeof model.name === 'string' ? model.name : ''))
          .filter((name) => name !== '')
        if (!names.includes(config.model)) {
          return { available: true, detail: 'model-not-pulled' }
        }
        return { available: true }
      } catch (error) {
        return { available: false, detail: messageOf(error) }
      }
    },
    async listModels(signal, fetchImpl) {
      const response = await fetchImpl(`${base}/api/tags`, { signal })
      if (!response.ok) throw new Error(`ollama: HTTP ${response.status}`)
      const payload = (await response.json()) as { models?: Array<{ name?: unknown }> }
      return (payload.models ?? [])
        .map((model) => (typeof model.name === 'string' ? model.name : ''))
        .filter((name) => name !== '')
    },
  }
}

/** Google 免费接口（非官方），最后兜底。 */
export function createGoogleProvider(config: CotConfig['google']): TranslateProvider {
  const endpoint = config.endpoint
  return {
    id: 'google',
    kind: 'google',
    label: '免费 Google 翻译',
    async translate(segments, target, signal, fetchImpl) {
      const out: string[] = []
      const tl = googleTarget(target)
      for (const text of segments) {
        const url =
          `${endpoint}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}` +
          `&dt=t&q=${encodeURIComponent(text)}`
        const response = await fetchImpl(url, { signal })
        if (!response.ok) throw new Error(`google: HTTP ${response.status}`)
        const payload = (await response.json()) as unknown
        const translated = parseGooglePayload(payload)
        if (translated === '') throw new Error('google: empty translation')
        out.push(translated)
      }
      return out
    },
    async probe(signal, fetchImpl) {
      try {
        const response = await fetchImpl(
          `${endpoint}?client=gtx&sl=auto&tl=en&dt=t&q=ok`,
          { signal },
        )
        if (!response.ok) return { available: false, detail: `HTTP ${response.status}` }
        await response.json()
        return { available: true }
      } catch (error) {
        return { available: false, detail: messageOf(error) }
      }
    },
  }
}

/** Google 的响应是 `[[[译文, 原文, …], …], …]`，把首列拼起来。 */
export function parseGooglePayload(payload: unknown): string {
  if (!Array.isArray(payload)) return ''
  const first = payload[0]
  if (!Array.isArray(first)) return ''
  const parts: string[] = []
  for (const chunk of first) {
    if (!Array.isArray(chunk)) continue
    const piece = chunk[0]
    if (typeof piece === 'string') parts.push(piece)
  }
  return parts.join('').trim()
}

/** 模型偶尔会把译文包在引号或“译文：”前缀里，去掉这层壳。 */
export function stripWrapping(text: string): string {
  let value = text.trim()
  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ["'", "'"],
  ]
  for (const [open, close] of quotePairs) {
    if (value.length >= 2 && value.startsWith(open) && value.endsWith(close)) {
      value = value.slice(1, -1).trim()
      break
    }
  }
  return value.replace(/^(译文|翻译|Translation)\s*[:：]\s*/i, '').trim()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
