/**
 * Host 半：provider 链 + `/_cotx/*` HTTP 路由。
 *
 * 里程碑 M2（docs/ROADMAP.md）：
 *   POST /_cotx/translate  { target?, segments }  -> { translations, provider }
 *   GET  /_cotx/providers  -> 链与各 provider 健康状态（不含密钥）
 *   GET  /_cotx/models     -> 本地 Ollama 已有模型
 *
 * 约束（AGENTS.md 红线）：
 * - 只处理自然语言；代码/路径/URL 的剔除在 client 半完成；
 * - 不把原文/译文写进会话或日志（日志只有 provider / 段数 / 字符数 / 耗时）；
 * - 只接受同源/本机请求（`connection.requestRejection`）；不自己监听端口。
 *
 * 本文件同时 re-export 纯逻辑，供 `test/host.test.mjs` 直接测构建产物。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Translator } from './host/chain'
import { normalizeConfig } from './host/config'
import { registerRoutes } from './host/routes'

/** 插件名（= 包名，profile patch 与槽位 id 都用它）。 */
export const name = 'dsh-cot-translate'

/**
 * 需要的宿主服务：
 * - webServer：路由载体；
 * - connection：trust fence（同源/本机校验）。
 * 两者缺一时插件保持 pending、不注册任何路由（安全默认）。
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
}

/**
 * Cordis host 插件入口。
 * @param ctx - 宿主上下文（webServer / connection 已就绪）。
 * @param rawConfig - profile patch 里的配置，未校验，由 normalizeConfig 兜底。
 */
export function apply(ctx: HostContext, rawConfig?: unknown): void {
  const config = normalizeConfig(rawConfig)
  const translator = new Translator({
    config,
    log: (message) => {
      ctx.logger?.info?.(message)
    },
  })

  // trust fence：桌面端由 connection 服务判定来源；拿不到就退化为“不额外拦截”，
  // 但路由仍然只挂在 profile 的 loopback webserver 上（见 ADR-007）。
  const connection = ctx.get?.('connection') as ConnectionLike | undefined
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
      translator,
      config,
      guard,
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
export {
  createGoogleProvider,
  createLlamaCppProvider,
  createOllamaProvider,
  parseGooglePayload,
  pickModel,
  stripWrapping,
  targetLabel,
} from './host/providers'
export type { FetchLike, ProviderProbe, TranslateProvider } from './host/providers'
export {
  MODELS_PATH,
  PROVIDERS_PATH,
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
} from './host/runtime'
export type { EnsureResult, LaunchPlan, RuntimeDeps } from './host/runtime'
