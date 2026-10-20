/**
 * provider 适配器：把“一段英文 → 一段中文”抽象成统一的 translate()。
 *
 * 当前三个实现：
 *  1. llamacpp —— 本地 Hy-MT2 的 GGUF，走 llama-server 的 `/v1/chat/completions`
 *     （单文件二进制，Vulkan/CUDA 都行，**没有 GUI**；ADR-017）；
 *  2. ollama —— 可选的 Ollama 路径（装了才用，默认禁用）；
 *  3. google —— 免费接口，仅作为最后兜底（ADR-008）。
 *
 * 红线段（AGENTS.md）：这里**不做**任何代码/路径剔除 —— 剔除是 client 半的
 * 责任，送进来的 segments 已经是自然语言。适配器也不打印原文，只报长度与耗时。
 */

import type { ProviderKind } from '../shared'
import type { CotConfig } from './config'
import { languageLabel } from './languages'
import type { LaunchPlan, RuntimeDeps } from './runtime'
import {
  defaultLlamaServerBin,
  defaultModelPath,
  defaultOllamaBin,
  ensureLocalServer,
  ensureOllamaServer,
  hostOf,
  modelLabel,
  portOf,
} from './runtime'

/** 只取 fetch 的可调用签名，便于单测注入假实现。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderProbe {
  available: boolean
  /** 不可用时的人类可读原因（不含任何密钥/原文）。 */
  detail?: string
}

/** 一次翻译请求的附加上下文（例如当前会话 id，供“用对话模型翻译”档使用）。 */
export interface TranslateContext {
  sessionId?: string
}

export interface TranslateProvider {
  id: string
  kind: ProviderKind
  label: string
  /** 客户端本地化用的文案 key（`provider.<id>`）。 */
  labelKey?: string
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
    context?: TranslateContext,
  ): Promise<string[]>
  probe(signal: AbortSignal, fetchImpl: FetchLike): Promise<ProviderProbe>
  listModels?(signal: AbortSignal, fetchImpl: FetchLike): Promise<string[]>
}

/** 目标语言 → 提示词里用的语言名。 */
/**
 * llama-server 的 HTTP 错误：403/401 常见于**端口被别的程序占用**（对方返回自己的
 * 鉴权错误），404 可能是老版本没有该端点。提示写清楚，避免误判成模型问题。
 */
function llamacppHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return `llamacpp: HTTP ${status}（端口可能被其他程序占用，或需要 API key）`
  }
  return `llamacpp: HTTP ${status}`
}

/**
 * target 的提示词写法：已知语言给**完整英文名**（模型卡要求，缩写会掉质量），
 * 未知语言原样透传。
 */
export function targetLabel(target: string): string {
  return languageLabel(target)
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
function translationMessages(text: string, target: string): Array<{ role: string; content: string }> {
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

/** `/api/tags` 的结果缓存时长：模型列表变动不频繁，别每次翻译都探一次。 */
const TAGS_TTL_MS = 60_000

/** 已拉取模型列表的进程内缓存（按 baseURL）。 */
const tagsCache = new Map<string, { at: number; models: string[] }>()

/** Ollama 的模型偏好顺序：先大后小，同档优先 Q4（显存友好）。 */
const MODEL_PREFERENCE: readonly string[] = [
  '7b-q4_k_m',
  '7b-q4_k_s',
  '7b-q6_k',
  '7b-q8_0',
  '7b',
  '1.8b-q8_0',
  '1.8b-q4_k_m',
  '1.8b',
]

/**
 * 从已拉取的模型里挑一个（`model: "auto"` 时用）。
 *
 * 先找 Hy-MT2，找不到再考虑其它翻译专用模型，最后退回列表第一个 ——
 * 用户的模型名/量化档和默认值不一样时，插件不该因此失效。
 */
export function pickModel(available: readonly string[]): string | undefined {
  if (available.length === 0) return undefined
  const entries = available.map((name) => ({ name, lower: name.toLowerCase() }))
  const hy = entries.filter((entry) => entry.lower.includes('hy-mt2'))
  const pool = hy.length > 0 ? hy : entries
  for (const preference of MODEL_PREFERENCE) {
    const hit = pool.find((entry) => entry.lower.includes(preference))
    if (hit !== undefined) return hit.name
  }
  const otherTranslator = entries.find((entry) =>
    /translate|nllb|opus-mt|madlad|m2m100/.test(entry.lower),
  )
  if (otherTranslator !== undefined) return otherTranslator.name
  return pool[0]?.name
}

/** 取 Ollama 已拉取模型列表（带 60 秒缓存）。 */
async function listTags(
  base: string,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const cached = tagsCache.get(base)
  if (cached !== undefined && Date.now() - cached.at < TAGS_TTL_MS) return cached.models
  const response = await fetchImpl(`${base}/api/tags`, { signal })
  if (!response.ok) throw new Error(`ollama: HTTP ${response.status}`)
  const payload = (await response.json()) as { models?: Array<{ name?: unknown }> }
  const models = (payload.models ?? [])
    .map((model) => (typeof model.name === 'string' ? model.name : ''))
    .filter((name) => name !== '')
  tagsCache.set(base, { at: Date.now(), models })
  return models
}

/** 计算该段原文最多需要多少输出 token，避免模型跑飞。 */
function numPredictFor(text: string): number {
  return Math.min(1024, Math.max(128, Math.ceil(text.length * 2)))
}

/** 同时最多并发翻译几段（llama-server 默认 4 个 slot，留余量）。 */
const MAX_PARALLEL_SEGMENTS = 2

/** 并发执行且保留结果顺序（任何一段失败整体抛错，由链降级）。 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 已确认可用的本地服务（baseURL + bin + fetch 实现），拉起过一次就不再重复。 */
let runtimeStarting: Promise<unknown> | undefined

/**
 * llama-server 的拉起计划；找不到二进制/模型时返回 undefined（不拉起）。
 * `--jinja` 用模型自带的 chat 模板，`--no-webui` 关掉它自带的网页界面。
 */
function llamaPlan(config: CotConfig['llamacpp']): LaunchPlan | undefined {
  const bin = config.bin !== '' ? config.bin : defaultLlamaServerBin()
  const model = config.modelPath !== '' ? config.modelPath : defaultModelPath()
  if (bin === undefined || model === undefined) return undefined
  return {
    bin,
    args: [
      '-m',
      model,
      '--host',
      hostOf(config.baseURL),
      '--port',
      portOf(config.baseURL),
      '-c',
      String(config.ctxSize),
      '-ngl',
      String(config.gpuLayers),
      '--jinja',
      '--no-webui',
    ],
  }
}

/** llama.cpp 本地 provider（llama-server，OpenAI 兼容接口）。 */
export function createLlamaCppProvider(
  config: CotConfig['llamacpp'],
  runtimeDeps?: RuntimeDeps,
): TranslateProvider {
  const base = config.baseURL
  const loadModelPlan = () => {
    // 每次调用都重新找一遍：用户可能刚把模型/二进制放进来。
    const plan = llamaPlan(config)
    return plan
  }
  /** 当前实际会用的模型名（配置优先，其次 `~/models` 里发现的）。 */
  const currentModel = () => {
    if (config.modelPath !== '') return modelLabel(config.modelPath)
    const discovered = defaultModelPath()
    return discovered === undefined ? 'auto-detect' : modelLabel(discovered)
  }
  return {
    id: 'llamacpp',
    kind: 'llamacpp',
    label: 'Local Hy-MT2 (llama.cpp)',
    labelKey: 'provider.llamacpp',
    model: currentModel(),
    async translate(segments, target, signal, fetchImpl) {
      if (config.autostart) {
        try {
          await ensureLocalServer({
            baseURL: base,
            probePath: '/health',
            fetchImpl,
            plan: loadModelPlan,
            ...(runtimeDeps === undefined ? {} : { deps: runtimeDeps }),
          })
        } catch {
          // 拉起失败交给下面的请求失败 → 链降级。
        }
      }
      // 段与段之间并发（llama-server 有多个 slot），整批仍要全部成功。
      return mapConcurrent(segments, MAX_PARALLEL_SEGMENTS, async (text) => {
        const response = await fetchImpl(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'local',
            messages: translationMessages(text, target),
            temperature: HY_MT2_OPTIONS.temperature,
            top_p: HY_MT2_OPTIONS.top_p,
            top_k: HY_MT2_OPTIONS.top_k,
            repeat_penalty: HY_MT2_OPTIONS.repeat_penalty,
            max_tokens: numPredictFor(text),
            stream: false,
          }),
          signal,
        })
        if (!response.ok) throw new Error(llamacppHttpError(response.status))
        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>
        }
        const content = payload.choices?.[0]?.message?.content
        if (typeof content !== 'string') throw new Error('llamacpp: malformed response')
        return stripWrapping(content)
      })    },
    async probe(signal, fetchImpl) {
      try {
        const response = await fetchImpl(`${base}/health`, { signal })
        if (response.ok) {
          return { available: true, detail: `model: ${currentModel()}` }
        }
        // 老版本 llama-server 没有 /health：退一步看 /v1/models。
        const models = await fetchImpl(`${base}/v1/models`, { signal })
        return models.ok
          ? { available: true, detail: `model: ${currentModel()}` }
          : { available: false, detail: `HTTP ${response.status}` }
      } catch (error) {
        return { available: false, detail: messageOf(error) }
      }
    },
    async listModels(signal, fetchImpl) {
      const response = await fetchImpl(`${base}/v1/models`, { signal })
      if (!response.ok) throw new Error(llamacppHttpError(response.status))
      const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
      return (payload.data ?? [])
        .map((model) => (typeof model.id === 'string' ? model.id : ''))
        .filter((id) => id !== '')
    },
  }
}

/**
 * 确保本地服务在跑：按需拉起 `ollama serve`（headless）。
 * 用模块级 promise 去重，多个并发请求只拉一次。
 */
async function ensureRuntimeOnce(
  config: CotConfig['ollama'],
  fetchImpl: FetchLike,
  deps: RuntimeDeps | undefined,
): Promise<void> {
  // 不缓存“已就绪”：服务可能已经退出，ensureOllamaServer 每次都会先探活。
  if (runtimeStarting === undefined) {
    runtimeStarting = ensureOllamaServer({
      baseURL: config.baseURL,
      ...(config.bin === '' ? {} : { bin: config.bin }),
      fetchImpl,
      ...(deps === undefined ? {} : { deps }),
    })
      .catch(() => {
        // 拉起失败不影响主流程：翻译会降级到下一档 provider。
      })
      .finally(() => {
        runtimeStarting = undefined
      })
  }
  await runtimeStarting
}

/** Ollama 本地 provider（可选；默认配置里已禁用，本机没装 Ollama）。 */
export function createOllamaProvider(
  config: CotConfig['ollama'],
  runtimeDeps?: RuntimeDeps,
): TranslateProvider {
  const base = config.baseURL
  return {
    id: 'ollama',
    kind: 'ollama',
    label: 'Local Hy-MT2 (Ollama)',
    labelKey: 'provider.ollama',
    model: config.model,
    async translate(segments, target, signal, fetchImpl) {
      // 服务没起来时先按需拉起（无 GUI 的后台进程），再翻译。
      if (config.autostart) await ensureRuntimeOnce(config, fetchImpl, runtimeDeps)
      // `auto`：按已拉取的模型自动挑一个；显式模型名则直接用，不多发一次探测。
      const model =
        config.model === 'auto'
          ? (pickModel(await listTags(base, signal, fetchImpl)) ??
            (() => {
              throw new Error('ollama: no model pulled')
            })())
          : config.model
      return mapConcurrent(segments, MAX_PARALLEL_SEGMENTS, async (text) => {
        const body: Record<string, unknown> = {
          model,
          messages: translationMessages(text, target),
          stream: false,
          options: { ...HY_MT2_OPTIONS, num_predict: numPredictFor(text) },
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
        return stripWrapping(content)
      })
    },
    async probe(signal, fetchImpl) {
      try {
        const models = await listTags(base, signal, fetchImpl)
        if (config.model !== 'auto') {
          return models.includes(config.model)
            ? { available: true, detail: `model: ${config.model}` }
            : { available: true, detail: 'model-not-pulled' }
        }
        const picked = pickModel(models)
        return picked === undefined
          ? { available: true, detail: 'model-not-pulled' }
          : { available: true, detail: `model: ${picked}` }
      } catch (error) {
        return { available: false, detail: messageOf(error) }
      }
    },
    async listModels(signal, fetchImpl) {
      return listTags(base, signal, fetchImpl)
    },
  }
}

/** Google 免费接口（非官方），最后兜底。 */
export function createGoogleProvider(config: CotConfig['google']): TranslateProvider {
  const endpoint = config.endpoint
  return {
    id: 'google',
    kind: 'google',
    label: 'Free Google Translate',
    labelKey: 'provider.google',
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
