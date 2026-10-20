/**
 * 两端共享的类型：翻译请求/响应、provider 描述与健康状态。
 *
 * 约定：
 * - 调用方（client 半）负责把代码块、路径、命令、URL 剔除出 segments；
 * - translations 与 segments 一一对应，失败位置为空串，由调用方回显原文；
 * - 译文只用于显示，绝不写回会话；
 * - 健康状态里不含密钥、不含原文。
 */

export type ProviderKind = 'ollama' | 'openai' | 'anthropic' | 'google' | 'bing'

export interface ProviderInfo {
  /** 稳定 id，用于配置里排序/开关，例如 "local-7b" */
  id: string
  kind: ProviderKind
  /** 展示名 */
  label: string
  enabled: boolean
  /** OpenAI 兼容 / Ollama / Anthropic 端点的基地址 */
  baseURL?: string
  /** 模型 id，例如 kaelri/hy-mt2:7b-q4_K_M */
  model?: string
  /**
   * 密钥来源：环境变量名或 DSH credentials 里的 ref 名。
   * 只存名字，绝不存密钥本体。
   */
  apiKeyRef?: string
}

export interface TranslateRequest {
  /** 目标语言，例如 "zh-Hans"；省略时用插件配置 */
  target?: string
  /** 待翻自然语言片段（已剔除代码/路径/URL） */
  segments: string[]
}

export interface TranslateResponse {
  /** 与请求 segments 一一对应；失败位置为空串 */
  translations: string[]
  /**
   * 实际使用的 provider id，便于排障与 UI 展示。
   * `""` = 全部失败（fail-open），`"cache"` = 全部命中缓存。
   */
  provider: string
}

/** 单个 provider 的健康状态（`GET /_cotx/providers`）。 */
export interface ProviderState {
  id: string
  kind: ProviderKind
  label: string
  model?: string
  enabled: boolean
  available: boolean
  /** 不可用原因（如 "model-not-pulled"、"HTTP 500"），不含原文/密钥。 */
  detail?: string
}

export interface ProvidersResponse {
  enabled: boolean
  target: string
  /** 配置的尝试顺序（provider id）。 */
  chain: string[]
  providers: ProviderState[]
}

export interface ModelsResponse {
  models: string[]
}

export interface ErrorResponse {
  error: string
  message?: string
}
