/**
 * host 半配置：从 cordis 传来的原始 config 归一化成稳定的内部形状。
 *
 * 为什么不用 schemastery 声明 `Config`：cordis 4 实测“没有 Config schema 时
 * config 原样透传”（`resolveConfig` 只在 runtime.Config 存在时校验），而本项目
 * 不把任何 `@deepseek-ai/*` 拉进依赖 —— 归一化逻辑自己写，就能被单测覆盖，
 * 也避免桌面端升级时 schema 版本对不上。
 */

/** 已知的 provider id（链里出现别的 id 会被忽略）。 */
export const PROVIDER_IDS = ['session', 'llamacpp', 'ollama', 'google'] as const

/** provider id 联合。 */
export type ProviderId = (typeof PROVIDER_IDS)[number]

export interface LlamaCppConfig {
  enabled: boolean
  /** llama-server 的地址；默认 127.0.0.1:18099（8080 常被别的应用占用）。 */
  baseURL: string
  /** llama-server 可执行文件；空串 = 自动在常见位置找。 */
  bin: string
  /** GGUF 模型路径；空串 = 在 `~/models` 里找。 */
  modelPath: string
  /** 卸载到 GPU 的层数（99 = 全部）。 */
  gpuLayers: number
  /** 上下文窗口。 */
  ctxSize: number
  /** 连不上时是否拉起 llama-server。 */
  autostart: boolean
}

export interface OllamaConfig {
  enabled: boolean
  /** 只连本机回环或用户明确指定的地址；不监听、不暴露。 */
  baseURL: string
  /** 模型名；`auto` = 从 `/api/tags` 里按偏好挑一个已拉取的。 */
  model: string
  /** 透传给 Ollama 的 keep_alive（如 "5m" / 0）；空串表示不指定。 */
  keepAlive: string
  /** 连不上时是否尝试拉起 `ollama serve`（无 GUI，后台进程）。 */
  autostart: boolean
  /** 可执行文件路径；空串 = 按平台常见位置自动找。 */
  bin: string
}

export interface GoogleConfig {
  enabled: boolean
  /** 免费接口（非官方），作为最后兜底。 */
  endpoint: string
}

export interface CotConfig {
  enabled: boolean
  target: string
  /** 单个 provider 一次请求的超时（毫秒）。 */
  timeoutMs: number
  /** 成功译文 LRU 容量。 */
  cacheSize: number
  /** 失败负缓存时长（毫秒），0 表示关闭。 */
  negativeTtlMs: number
  /** provider 尝试顺序。 */
  chain: ProviderId[]
  llamacpp: LlamaCppConfig
  ollama: OllamaConfig
  google: GoogleConfig
}

/** 桌面端常见安装位置；Ollama 默认就是这里。 */
const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434'

/** 官方免费接口；仅兜底，失败不影响主流程。 */
const DEFAULT_GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

export const DEFAULT_CONFIG: CotConfig = {
  enabled: true,
  target: 'zh-Hans',
  // 首次调用要等模型从磁盘加载进显存（1.8B 约 2-5s，7B 约 5-10s），给足余量。
  timeoutMs: 20000,
  cacheSize: 600,
  negativeTtlMs: 30000,
  chain: ['llamacpp', 'google'],
  llamacpp: {
    enabled: true,
    baseURL: 'http://127.0.0.1:18099',
    bin: '',
    modelPath: '',
    gpuLayers: 99,
    ctxSize: 4096,
    autostart: true,
  },
  ollama: {
    enabled: false,
    baseURL: DEFAULT_OLLAMA_BASE,
    // auto = 从 `/api/tags` 里按偏好挑一个已拉取的模型（见 providers.pickModel），
    // 用户拉的是 1.8B 还是 7B、量化档是什么都不影响插件工作。
    model: 'auto',
    keepAlive: '5m',
    autostart: true,
    bin: '',
  },
  google: {
    enabled: true,
    endpoint: DEFAULT_GOOGLE_ENDPOINT,
  },
}

/** 把任意输入夹到 [min, max] 的整数；非法值回退默认。 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 非空字符串或回退默认。 */
function text(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

/** 布尔值或回退默认。 */
function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 归一化 provider 链：只留已知 id，去重，保持顺序。 */
function chainOf(value: unknown, fallback: ProviderId[]): ProviderId[] {
  if (!Array.isArray(value)) return [...fallback]
  const seen = new Set<ProviderId>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = PROVIDER_IDS.find((candidate) => candidate === entry)
    if (id !== undefined) seen.add(id)
  }
  return seen.size === 0 ? [...fallback] : [...seen]
}

function objectOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 原始 config → {CotConfig}。未知字段忽略，非法值回退默认，永不抛错
 * （配置写坏不该让插件挂不上）。
 */
export function normalizeConfig(raw: unknown): CotConfig {
  const root = objectOf(raw)
  const ollama = objectOf(root.ollama)
  const google = objectOf(root.google)
  const llamacpp = objectOf(root.llamacpp)

  const baseURL = text(ollama.baseURL, DEFAULT_CONFIG.ollama.baseURL).replace(/\/+$/, '')
  const llamaBaseURL = text(llamacpp.baseURL, DEFAULT_CONFIG.llamacpp.baseURL).replace(/\/+$/, '')

  return {
    enabled: flag(root.enabled, DEFAULT_CONFIG.enabled),
    target: text(root.target, DEFAULT_CONFIG.target).slice(0, 32),
    timeoutMs: clampInt(root.timeoutMs, DEFAULT_CONFIG.timeoutMs, 500, 120000),
    cacheSize: clampInt(root.cacheSize, DEFAULT_CONFIG.cacheSize, 0, 5000),
    negativeTtlMs: clampInt(root.negativeTtlMs, DEFAULT_CONFIG.negativeTtlMs, 0, 300000),
    chain: chainOf(root.chain, DEFAULT_CONFIG.chain),
    llamacpp: {
      enabled: flag(llamacpp.enabled, DEFAULT_CONFIG.llamacpp.enabled),
      baseURL: llamaBaseURL,
      bin: typeof llamacpp.bin === 'string' ? llamacpp.bin.trim() : '',
      modelPath: typeof llamacpp.modelPath === 'string' ? llamacpp.modelPath.trim() : '',
      gpuLayers: clampInt(llamacpp.gpuLayers, DEFAULT_CONFIG.llamacpp.gpuLayers, 0, 999),
      ctxSize: clampInt(llamacpp.ctxSize, DEFAULT_CONFIG.llamacpp.ctxSize, 512, 32768),
      autostart: flag(llamacpp.autostart, DEFAULT_CONFIG.llamacpp.autostart),
    },
    ollama: {
      enabled: flag(ollama.enabled, DEFAULT_CONFIG.ollama.enabled),
      baseURL,
      model: text(ollama.model, DEFAULT_CONFIG.ollama.model).slice(0, 200),
      keepAlive: typeof ollama.keepAlive === 'string' ? ollama.keepAlive.trim() : '',
      autostart: flag(ollama.autostart, DEFAULT_CONFIG.ollama.autostart),
      bin: typeof ollama.bin === 'string' ? ollama.bin.trim() : '',
    },
    google: {
      enabled: flag(google.enabled, DEFAULT_CONFIG.google.enabled),
      endpoint: text(google.endpoint, DEFAULT_CONFIG.google.endpoint),
    },
  }
}
