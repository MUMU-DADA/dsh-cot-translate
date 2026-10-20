/**
 * HTTP 路由（host 半）：`/_cotx/translate`、`/_cotx/providers`、`/_cotx/models`。
 *
 * 边界（ADR-007）：
 * - 只接受同源/本机请求，由 `connection.requestRejection` 这道 trust fence 判定；
 * - 请求体有上限，字段逐个校验，坏输入一律 400，不把异常抛给 webserver；
 * - 响应不含原文、不含密钥；`cache-control: no-store`。
 *
 * 这里只管 HTTP，不碰 provider 细节 —— 编排在 chain.ts。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ErrorResponse, ModelsResponse, ProvidersResponse } from '../shared'
import type { Translator } from './chain'
import type { CotConfig } from './config'

/** 路由常量；client 半按同一路径请求。 */
export const TRANSLATE_PATH = '/_cotx/translate'
export const PROVIDERS_PATH = '/_cotx/providers'
export const MODELS_PATH = '/_cotx/models'

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
}

export type ParseResult =
  | { ok: true; value: TranslateBody }
  | { ok: false; message: string }

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
    value: typeof target === 'string' ? { target, segments: trimmed } : { segments: trimmed },
  }
}

export interface RouteOptions {
  /** ctx.webServer.register。 */
  register: RouteRegister
  translator: Translator
  config: CotConfig
  /**
   * trust fence：返回 true 表示请求已被拒绝（响应已发出）。
   * 由 index.ts 接 `connection.requestRejection`。
   */
  guard: (req: IncomingMessage, res: ServerResponse) => boolean
}

/**
 * 注册三条路由。
 * @returns 与注册顺序一致的 disposer 列表（调用方负责在卸载时全部执行）。
 */
export function registerRoutes(options: RouteOptions): Array<() => void> {
  const { register, translator, config, guard } = options
  const disposers: Array<() => void> = []

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
          sendJson(res, 413, { error: 'too-large' } satisfies ErrorResponse)
          return
        }
        const parsed = parseTranslateBody(body)
        if (!parsed.ok) {
          sendJson(res, 400, { error: 'bad-request', message: parsed.message } satisfies ErrorResponse)
          return
        }
        const result = await translator.translate(parsed.value.segments, parsed.value.target)
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
        const providers = await translator.providerStates()
        sendJson(res, 200, {
          enabled: config.enabled,
          target: config.target,
          chain: [...config.chain],
          providers,
        } satisfies ProvidersResponse)
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
        const models = await translator.models()
        sendJson(res, 200, { models } satisfies ModelsResponse)
      },
    }),
  )

  return disposers
}
