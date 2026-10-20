/**
 * Host 半：provider 链 + `/_cotx/*` HTTP 路由 + 设置/模型管理。
 *
 * 路由（docs/ARCHITECTURE.md）：
 *   POST /_cotx/translate        { target?, segments, sessionId? } -> { translations, provider }
 *   GET  /_cotx/providers        -> 链与各 provider 健康状态（不含密钥）
 *   GET  /_cotx/models           -> 本地运行时里已有的模型名
 *   GET  /_cotx/state            -> 设置 + 模型列表 + 下载进度
 *   POST /_cotx/settings         -> 改设置（立即生效）
 *   POST /_cotx/models/download  -> 下载/更新某个模型（异步）
 *   POST /_cotx/models/delete    -> 删除下载的模型（自带模型不可删）
 *   POST /_cotx/selftest         -> 本地模型速度自测
 *   POST /_cotx/restart          -> 重启本地服务（换模型后）
 *
 * 约束（AGENTS.md 红线）：
 * - 只处理自然语言；代码/路径/URL 的剔除在 client 半完成；
 * - 不把原文/译文写进会话或日志（日志只有 provider / 段数 / 字符数 / 耗时）；
 * - 只接受同源/本机请求（`connection.requestRejection`）；不自己监听端口；
 * - 「用当前对话模型翻译」走 `ctx.llm`，不复制密钥、不自己发 HTTP。
 *
 * 本文件同时 re-export 纯逻辑，供 `test/host.test.mjs` 直接测构建产物。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CotConfig } from './host/config'
import { Control } from './host/control'
import { registerRoutes } from './host/routes'
import type { SessionModelHooks } from './host/session-model'

/** 插件名（= 包名，profile patch 与槽位 id 都用它）。 */
export const name = 'dsh-cot-translate'

/**
 * 需要的宿主服务：
 * - webServer：路由载体；
 * - connection：trust fence（同源/本机校验）。
 * 两者缺一时插件保持 pending、不注册任何路由（安全默认）。
 * `llm` / `sessions` 通过 ctx.get 按需读取，缺了只是「用对话模型翻译」不可用。
 */
export const inject = ['webServer', 'connection']

/** 宿主 webserver 服务的最小形状（结构类型，不依赖运行时包）。 */
export interface WebServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** 宿主的连接/信任服务：`undefined` 表示放行，返回状态码表示拒绝。 */
export interface ConnectionLike {
  requestRejection(req: IncomingMessage): number | undefined
}

/** 宿主经 cordis 传给 host 半的 Context（只声明用到的成员）。 */
export interface HostContext {
  effect(callback: () => (() => void) | void, label?: string): unknown
  webServer: WebServerLike
  logger?: { info?: (message: string) => void; warn?: (message: string) => void }
  get?: (name: string) => unknown
  /** cordis 的「等这些服务就绪后回调」入口（拿 llm/sessions 用）。 */
  inject?: (names: string[], callback: (ctx: HostContext) => void) => unknown
  /** cordis 会把服务直接挂在 ctx 上；两个入口都试一下。 */
  llm?: unknown
  sessions?: unknown
  connection?: unknown
}

/** 宿主 Llm 服务的最小形状（只用到 stream）。 */
interface LlmLike {
  stream?: (options: Record<string, unknown>) => AsyncIterable<unknown>
}

/** 宿主 sessions 服务的最小形状（只用到 get）。 */
interface SessionsLike {
  get?: (sessionId: string) => unknown
}

/** 取会话上一次请求的 provider/model。 */
function resolveSessionRoute(
  sessions: SessionsLike | undefined,
  sessionId: string | undefined,
): { provider: string; model: string } | undefined {
  if (sessions?.get === undefined || sessionId === undefined || sessionId === '') return undefined
  try {
    const session = sessions.get(sessionId) as
      | { requestHeader?: () => { config?: { provider?: unknown; model?: unknown } } | undefined }
      | undefined
    const config = session?.requestHeader?.()?.config
    if (typeof config?.provider === 'string' && typeof config?.model === 'string') {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    // 会话不存在/接口形状变了：当作拿不到
  }
  return undefined
}

/** 造一条 user 消息；优先用 dsh-llm 的构造器（消息带 id/source），失败退回普通对象。 */
async function buildUserMessages(user: string): Promise<unknown[]> {
  try {
    // 用变量而不是字面量：宿主包由运行时提供，构建期不解析、类型也不绑死版本。
    const specifier: string = '@deepseek-ai/dsh-llm'
    const module = (await import(specifier)) as {
      createUserMessage?: (input: unknown) => unknown
    }
    if (typeof module.createUserMessage === 'function') {
      return [
        module.createUserMessage({
          content: [{ type: 'text', text: user }],
          source: { kind: 'cot-translate' },
        }),
      ]
    }
  } catch {
    // 宿主包不可解析：用最小消息形状
  }
  return [{ role: 'user', content: [{ type: 'text', text: user }] }]
}

/** 取一个宿主服务：优先 ctx 上的属性，其次 ctx.get(name)。 */
function serviceOf<T>(ctx: HostContext, name: 'llm' | 'sessions' | 'connection'): T | undefined {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct as T
  } catch {
    // 未 inject 的服务在 cordis 里可能抛错：忽略，走 ctx.get
  }
  try {
    return ctx.get?.(name) as T | undefined
  } catch {
    return undefined
  }
}

/** 把 ctx.llm / ctx.sessions 适配成「用对话模型翻译」的钩子。 */
function makeSessionModelHooks(ctx: HostContext): SessionModelHooks | undefined {
  const llm = serviceOf<LlmLike>(ctx, 'llm')
  if (llm?.stream === undefined) return undefined
  const sessions = serviceOf<SessionsLike>(ctx, 'sessions')
  return {
    resolveRoute: (sessionId) => resolveSessionRoute(sessions, sessionId),
    async call(request) {
      if (llm.stream === undefined) throw new Error('llm service unavailable')
      const messages = await buildUserMessages(request.user)
      let text = ''
      for await (const raw of llm.stream({
        provider: request.provider,
        model: request.model,
        messages,
        system: request.system,
        maxTokens: request.maxTokens,
        purpose: 'cot-translate',
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        signal: request.signal,
      })) {
        const chunk = raw as { type?: unknown; text?: unknown; reason?: { kind?: unknown } }
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        if (chunk.type === 'finish') {
          const kind = chunk.reason?.kind
          if (kind === 'error' || kind === 'aborted') {
            throw new Error(`session model: ${String(kind)}`)
          }
        }
      }
      if (text === '') throw new Error('session model: empty response')
      return text
    },
  }
}

/**
 * Cordis host 插件入口。
 * @param ctx - 宿主上下文（webServer / connection 已就绪）。
 * @param rawConfig - profile patch 里的配置，未校验，由 normalizeConfig 兜底。
 */
export function apply(ctx: HostContext, rawConfig?: unknown): void {
  // 会话模型钩子是晚绑定：llm/sessions 服务可能在插件加载后才就绪。
  let sessionHooks: SessionModelHooks | undefined
  const control = new Control({
    ...(rawConfig === undefined ? {} : { staticConfig: rawConfig }),
    log: (message) => {
      ctx.logger?.info?.(message)
    },
    sessionModel: () => sessionHooks,
  })

  /** 绑定一次宿主服务：成功就刷新翻译链，让「用对话模型翻译」可用。 */
  const bindSessionHooks = (source: HostContext): void => {
    try {
      const hooks = makeSessionModelHooks(source)
      if (hooks === undefined || sessionHooks !== undefined) return
      sessionHooks = hooks
      control.refresh()
    } catch {
      // 宿主服务形状变了：保持本地模型，不影响其它功能
    }
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['llm', 'sessions'], (services) => {
      bindSessionHooks(services ?? ctx)
    })
  } else {
    bindSessionHooks(ctx)
  }

  // trust fence：桌面端由 connection 服务判定来源；拿不到就退化为“不额外拦截”，
  // 但路由仍然只挂在 profile 的 loopback webserver 上（见 ADR-007）。
  const connection = serviceOf<ConnectionLike>(ctx, 'connection')
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const rejection = connection?.requestRejection?.(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  ctx.effect(() => {
    const disposers = registerRoutes({
      register: (route) => ctx.webServer.register(route),
      facade: control,
      config: control.configView(),
      guard,
      control,
    })
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, `${name}: routes`)
}

// ── 供测试直接引用的纯逻辑（对宿主 Loader 无副作用）─────────────────────
export { LruCache, NegativeCache, cacheKey } from './host/cache'
export { Translator } from './host/chain'
export { DEFAULT_CONFIG, PROVIDER_IDS, normalizeConfig } from './host/config'
export type {
  CotConfig,
  GoogleConfig,
  LlamaCppConfig,
  OllamaConfig,
  ProviderId,
} from './host/config'
export { Control } from './host/control'
export type { ControlState, SelfTestResult } from './host/control'
export {
  MODEL_CATALOG,
  adoptLegacyModel,
  bundledDir,
  deleteModel,
  downloadModel,
  downloadStateOf,
  findModel,
  listModels,
  managedDir,
  resolveModelPath,
} from './host/models'
export type { DownloadState, ModelEntry, ModelStatus } from './host/models'
export {
  createGoogleProvider,
  createLlamaCppProvider,
  createOllamaProvider,
  parseGooglePayload,
  pickModel,
  stripWrapping,
  targetLabel,
} from './host/providers'
export type {
  FetchLike,
  ProviderProbe,
  TranslateContext,
  TranslateProvider,
} from './host/providers'
export {
  CACHE_CLEAR_PATH,
  CACHE_PATH,
  MODELS_PATH,
  MODEL_DELETE_PATH,
  MODEL_DOWNLOAD_PATH,
  PROVIDERS_PATH,
  RESTART_PATH,
  SELFTEST_PATH,
  SETTINGS_PATH,
  STATE_PATH,
  TRANSLATE_PATH,
  parseTranslateBody,
  readBoundedBody,
  registerRoutes,
  sendJson,
  sendMethodNotAllowed,
} from './host/routes'
export {
  defaultLlamaServerBin,
  defaultModelPath,
  defaultOllamaBin,
  ensureLocalServer,
  ensureOllamaServer,
  modelLabel,
  stopLocalServer,
} from './host/runtime'
export type { EnsureResult, LaunchPlan, RuntimeDeps } from './host/runtime'
export { DEFAULT_CACHE_LIMIT_BYTES, PersistentCache } from './host/persistent-cache'
export type { CacheStats } from './host/persistent-cache'
export { createSessionModelProvider } from './host/session-model'
export type { SessionModelHooks } from './host/session-model'
export {
  DEFAULT_SETTINGS,
  dataDir,
  loadSettings,
  normalizeSettings,
  patchSettings,
  saveSettings,
  settingsPath,
} from './host/settings'
export type { CotSettings, TranslationMode } from './host/settings'
