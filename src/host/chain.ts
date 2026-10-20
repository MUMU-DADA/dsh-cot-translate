/**
 * provider 链 + 缓存 + 超时（ADR-008 的落地）。
 *
 * 语义：
 * - 逐段查 LRU / 负缓存，只剩没缓存的段才去打模型；
 * - 按配置顺序逐个 provider 尝试，**单个段失败即整批换下一档**（不做半成功，
 *   避免译文与原文错位）；
 * - 全部失败时缺的段返回空串（fail-open，client 显示原文），并写 30 秒负缓存；
 * - 日志只记 provider、段数、字符数与耗时，**绝不记原文**（ADR-007）。
 */

import type { ProviderState, TranslateResponse } from '../shared'
import { LruCache, NegativeCache, cacheKey } from './cache'
import type { CotConfig } from './config'
import type { PersistentCache } from './persistent-cache'
import type { FetchLike, TranslateContext, TranslateProvider } from './providers'
import { createGoogleProvider, createLlamaCppProvider, createOllamaProvider } from './providers'
import type { RuntimeDeps } from './runtime'

/** 探测 provider 可用性时给的短超时。 */
const PROBE_TIMEOUT_MS = 1500

export interface TranslatorDeps {
  config: CotConfig
  /** 单测注入；默认用全局 fetch。 */
  fetchImpl?: FetchLike
  /** 只接受已脱敏的字符串（provider / 段数 / 字符数 / 耗时）。 */
  log?: (message: string) => void
  /** 单测注入时钟，用于负缓存 TTL。 */
  now?: () => number
  /** 本地服务自启的可注入依赖（测试用）。 */
  localRuntime?: RuntimeDeps
  /** 额外 provider（如「当前对话的 API 模型」），按 id 参与链。 */
  extraProviders?: TranslateProvider[]
  /** 磁盘译文缓存（跨重启）；不传就是纯内存缓存。 */
  persistent?: PersistentCache
}

/** 单个 provider 一次请求的超时信号（Node 18+ 自带 AbortSignal.timeout）。 */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

/** 翻译编排器：一个插件实例一个。 */
export class Translator {
  private readonly cache: LruCache<string>
  private readonly negative: NegativeCache
  private readonly config: CotConfig
  private readonly fetchImpl: FetchLike | undefined
  private readonly log: ((message: string) => void) | undefined
  private readonly localRuntime: RuntimeDeps | undefined
  private readonly extraProviders: TranslateProvider[]
  private readonly persistent: PersistentCache | undefined

  constructor(deps: TranslatorDeps) {
    this.config = deps.config
    this.fetchImpl = deps.fetchImpl
    this.log = deps.log
    this.localRuntime = deps.localRuntime
    this.extraProviders = deps.extraProviders ?? []
    this.persistent = deps.persistent
    this.cache = new LruCache<string>(deps.config.cacheSize)
    this.negative = new NegativeCache(deps.config.negativeTtlMs, 200, deps.now)
  }

  /** 当前生效配置的快照（只读）。 */
  configSnapshot(): CotConfig {
    return this.config
  }

  /** 当前生效的 provider 列表（按 chain 顺序，跳过被禁用的）。 */
  providers(): TranslateProvider[] {
    const all: Record<string, TranslateProvider> = {
      llamacpp: createLlamaCppProvider(this.config.llamacpp, this.localRuntime),
      ollama: createOllamaProvider(this.config.ollama, this.localRuntime),
      google: createGoogleProvider(this.config.google),
    }
    for (const provider of this.extraProviders) all[provider.id] = provider
    const selected: TranslateProvider[] = []
    for (const id of this.config.chain) {
      if (id === 'llamacpp' && !this.config.llamacpp.enabled) continue
      if (id === 'ollama' && !this.config.ollama.enabled) continue
      if (id === 'google' && !this.config.google.enabled) continue
      const provider = all[id]
      if (provider !== undefined) selected.push(provider)
    }
    return selected
  }

  /**
   * 翻译一批自然语言片段。
   * @param segments - 已剔除代码/路径/URL 的片段（client 半负责剔除）。
   * @param target - 目标语言；省略则用配置值。
   * @param context - 附加上下文（如当前会话 id，供“用对话模型翻译”档使用）。
   */
  async translate(
    segments: readonly string[],
    target = this.config.target,
    context?: TranslateContext,
  ): Promise<TranslateResponse> {
    if (!this.config.enabled || segments.length === 0) {
      return { translations: segments.map(() => ''), provider: '' }
    }

    const results: string[] = segments.map(() => '')
    const misses: Array<{ index: number; key: string; text: string }> = []
    let cached = 0

    for (let index = 0; index < segments.length; index += 1) {
      const text = segments[index]
      const key = cacheKey(target, text)
      const hit = this.cache.get(key)
      if (hit !== undefined) {
        results[index] = hit
        cached += 1
        continue
      }
      if (this.negative.has(key)) continue
      // 第二层：磁盘缓存（只存译文，原文只做哈希键）。
      const disk = this.persistent?.get(target, text)
      if (disk !== undefined) {
        results[index] = disk
        this.cache.set(key, disk)
        cached += 1
        continue
      }
      misses.push({ index, key, text })
    }

    if (misses.length === 0) {
      return { translations: results, provider: cached > 0 ? 'cache' : '' }
    }

    const fetchImpl = this.fetchImpl ?? globalThis.fetch
    const chars = misses.reduce((total, miss) => total + miss.text.length, 0)

    for (const provider of this.providers()) {
      const startedAt = Date.now()
      try {
        const translated = await provider.translate(
          misses.map((miss) => miss.text),
          target,
          timeoutSignal(this.config.timeoutMs),
          fetchImpl,
          context,
        )
        if (translated.length !== misses.length) {
          throw new Error(`${provider.id}: length mismatch`)
        }
        misses.forEach((miss, offset) => {
          results[miss.index] = translated[offset]
          this.cache.set(miss.key, translated[offset])
          this.persistent?.set(target, miss.text, translated[offset], provider.id)
        })
        this.log?.(
          `[cotx] ${provider.id} ok: ${misses.length} seg / ${chars} chars / ${Date.now() - startedAt}ms` +
            ` (cache hits ${cached})`,
        )
        return { translations: results, provider: provider.id }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        this.log?.(
          `[cotx] ${provider.id} failed after ${Date.now() - startedAt}ms: ${reason}` +
            ` (segments ${misses.length}, chars ${chars})`,
        )
      }
    }

    for (const miss of misses) this.negative.add(miss.key)
    this.log?.(`[cotx] all providers failed: ${misses.length} seg / ${chars} chars`)
    return { translations: results, provider: '' }
  }

  /** provider 链健康状态（不含密钥、不含原文）。 */
  async providerStates(): Promise<ProviderState[]> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch
    const states: ProviderState[] = []
    for (const provider of this.providers()) {
      const probe = await provider.probe(timeoutSignal(PROBE_TIMEOUT_MS), fetchImpl)
      states.push({
        id: provider.id,
        kind: provider.kind,
        label: provider.label,
        ...(provider.model === undefined ? {} : { model: provider.model }),
        enabled: true,
        available: probe.available,
        ...(probe.detail === undefined ? {} : { detail: probe.detail }),
      })
    }
    return states
  }

  /** 列出本地 Ollama 已有模型（设置页用，拿不到就返回空数组）。 */
  async models(): Promise<string[]> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch
    for (const provider of this.providers()) {
      if (provider.listModels === undefined) continue
      try {
        return await provider.listModels(timeoutSignal(PROBE_TIMEOUT_MS * 2), fetchImpl)
      } catch (error) {
        this.log?.(`[cotx] listModels failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return []
  }
}
