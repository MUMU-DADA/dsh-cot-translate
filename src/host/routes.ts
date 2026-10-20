/**
 * HTTP 路由（host 半）：翻译、provider 状态、模型管理、设置与自测。
 *
 * 边界（ADR-007）：
 * - 只接受同源/本机请求，由 `connection.requestRejection` 这道 trust fence 判定；
 * - 请求体有上限，字段逐个校验，坏输入一律 400，不把异常抛给 webserver；
 * - 响应不含原文、不含密钥；`cache-control: no-store`。
 *
 * 这里只管 HTTP，不碰 provider/设置细节 —— 编排在 control.ts、链在 chain.ts。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProviderState, TranslateResponse } from '../shared'
import type { Translator } from './chain'
import type { Control } from './control'
import type { CotConfig } from './config'

/** 路由常量；client 半按同一路径请求。 */
export const TRANSLATE_PATH = '/_cotx/translate'
export const PROVIDERS_PATH = '/_cotx/providers'
export const MODELS_PATH = '/_cotx/models'
export const STATE_PATH = '/_cotx/state'
export const SETTINGS_PATH = '/_cotx/settings'
export const MODEL_DOWNLOAD_PATH = '/_cotx/models/download'
export const MODEL_DELETE_PATH = '/_cotx/models/delete'
export const SELFTEST_PATH = '/_cotx/selftest'
export const RESTART_PATH = '/_cotx/restart'
export const PORT_PATH = '/_cotx/port'
export const CACHE_PATH = '/_cotx/cache'
export const CACHE_CLEAR_PATH = '/_cotx/cache/clear'

/** 思考片段是自然语言，64KB 已远超正常批量；超过即视为异常输入。 */
const MAX_BODY_BYTES = 64 * 1024
/** 单批最多段数（client 会自己按句切分，正常远小于此值）。 */
const MAX_SEGMENTS = 64
/** 单段最大字符数。 */
const MAX_SEGMENT_CHARS = 4000
/** 单批总字符数上限。 */
const MAX_TOTAL_CHARS = 16000

/** webserver 的路由注册签名（只用到 exact）。 */
export type RouteRegister = (route: {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}) => () => void

export interface TranslateBody {
  target?: string
  segments: string[]
  /** 当前会话 id（「用对话模型翻译」档要用）。 */
  sessionId?: string
}

export type ParseResult =
  | { ok: true; value: TranslateBody }
  | { ok: false; message: string }

/** 翻译能力的门面：路由只依赖它，测试可注入假实现。 */
export interface TranslationFacade {
  translate(segments: readonly string[], target?: string, sessionId?: string): Promise<TranslateResponse>
  providerStates(): Promise<ProviderState[]>
  modelsList(): Promise<string[]>
}

/** JSON 响应；不缓存（可用性与译文都是实时事实）。 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** 405 + Allow。 */
export function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** 读有上限的请求体；超限返回 null（流已丢弃）。 */
export async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) {
      req.resume()
      return null
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/** 解析 JSON 请求体；空体返回 {}。 */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const text = await readBoundedBody(req)
  if (text === null) return null
  if (text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * 校验 `POST /_cotx/translate` 的请求体。
 * 空段落直接拒绝：client 半负责跳过空段，不把空串送进来。
 */
export function parseTranslateBody(text: string): ParseResult {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, message: 'body is not JSON' }
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, message: 'body must be an object' }
  }
  const record = payload as Record<string, unknown>
  const target = record.target
  if (target !== undefined && (typeof target !== 'string' || target.length > 32)) {
    return { ok: false, message: 'target must be a string of at most 32 chars' }
  }
  const sessionId = record.sessionId
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 200)) {
    return { ok: false, message: 'sessionId must be a string of at most 200 chars' }
  }
  const segments = record.segments
  if (!Array.isArray(segments)) {
    return { ok: false, message: 'segments must be an array' }
  }
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) {
    return { ok: false, message: `segments must contain 1..${MAX_SEGMENTS} items` }
  }
  let total = 0
  const trimmed: string[] = []
  for (const segment of segments) {
    if (typeof segment !== 'string') {
      return { ok: false, message: 'every segment must be a string' }
    }
    const value = segment.trim()
    if (value === '') return { ok: false, message: 'segments must not be empty' }
    if (value.length > MAX_SEGMENT_CHARS) {
      return { ok: false, message: `segment longer than ${MAX_SEGMENT_CHARS} chars` }
    }
    total += value.length
    trimmed.push(value)
  }
  if (total > MAX_TOTAL_CHARS) {
    return { ok: false, message: `batch larger than ${MAX_TOTAL_CHARS} chars` }
  }
  return {
    ok: true,
    value: {
      segments: trimmed,
      ...(typeof target === 'string' ? { target } : {}),
      ...(typeof sessionId === 'string' ? { sessionId } : {}),
    },
  }
}

export interface RouteOptions {
  /** ctx.webServer.register。 */
  register: RouteRegister
  /** 翻译门面（生产是 Control，测试可注入）。 */
  facade: TranslationFacade
  config: CotConfig
  /**
   * trust fence：返回 true 表示请求已被拒绝（响应已发出）。
   * 由 index.ts 接 `connection.requestRejection`。
   */
  guard: (req: IncomingMessage, res: ServerResponse) => boolean
  /** 设置/模型管理接口；缺省时这些路由不注册（单测的最小装配）。 */
  control?: Control
}

/**
 * 注册所有路由。
 * @returns 与注册顺序一致的 disposer 列表（调用方负责在卸载时全部执行）。
 */
export function registerRoutes(options: RouteOptions): Array<() => void> {
  const { register, facade, config, guard, control } = options
  const disposers: Array<() => void> = []

  const exact = (
    path: string,
    handler: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => Promise<void>,
  ) => {
    disposers.push(
      register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (guard(req, res)) return
          const body = (await readJsonBody(req)) ?? {}
          await handler(req, res, body)
        },
      }),
    )
  }

  disposers.push(
    register({
      kind: 'exact',
      path: TRANSLATE_PATH,
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'POST')
          return
        }
        const body = await readBoundedBody(req)
        if (body === null) {
          sendJson(res, 413, { error: 'too-large' })
          return
        }
        const parsed = parseTranslateBody(body)
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'bad-request', message: parsed.message })
          return
        }
        const result = await facade.translate(
          parsed.value.segments,
          parsed.value.target,
          parsed.value.sessionId,
        )
        sendJson(res, 200, result)
      },
    }),
  )

  disposers.push(
    register({
      kind: 'exact',
      path: PROVIDERS_PATH,
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        const providers = await facade.providerStates()
        sendJson(res, 200, {
          enabled: config.enabled,
          target: config.target,
          chain: [...config.chain],
          providers,
        })
      },
    }),
  )

  disposers.push(
    register({
      kind: 'exact',
      path: MODELS_PATH,
      handler: async (req, res) => {
        if (guard(req, res)) return
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res, 'GET')
          return
        }
        sendJson(res, 200, { models: await facade.modelsList() })
      },
    }),
  )

  if (control === undefined) return disposers

  // ── 设置 / 模型管理 / 自测 ──────────────────────────────────
  exact(STATE_PATH, async (_req, res) => {
    sendJson(res, 200, control.state())
  })

  exact(SETTINGS_PATH, async (req, res, body) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendJson(res, 200, control.update(body))
  })

  exact(MODEL_DOWNLOAD_PATH, async (req, res, body) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    const id = typeof body.id === 'string' ? body.id : ''
    if (id === '') {
      sendJson(res, 400, { error: 'bad-request', message: 'id is required' })
      return
    }
    // 下载是长任务：立刻返回，进度靠 /_cotx/state 轮询。
    void control.download(id).catch(() => {
      // 失败状态已经记在 downloadStateOf 里
    })
    sendJson(res, 202, { started: id })
  })

  exact(MODEL_DELETE_PATH, async (req, res, body) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    const id = typeof body.id === 'string' ? body.id : ''
    sendJson(res, 200, control.remove(id))
  })

  exact(SELFTEST_PATH, async (req, res) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendJson(res, 200, await control.selftest())
  })

  exact(RESTART_PATH, async (req, res) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendJson(res, 200, control.restart())
  })

  exact(PORT_PATH, async (req, res) => {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, 'GET')
      return
    }
    const raw = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('port') ?? ''
    const port = Number(raw)
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
      sendJson(res, 400, { error: 'bad-request', message: 'port must be 1024..65535' })
      return
    }
    sendJson(res, 200, await control.portStatus(port))
  })

  exact(CACHE_PATH, async (req, res) => {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, 'GET')
      return
    }
    sendJson(res, 200, control.state().cache)
  })

  exact(CACHE_CLEAR_PATH, async (req, res) => {
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    sendJson(res, 200, control.clearCache())
  })

  return disposers
}
