/**
 * Client 半的设置镜像：从 host `GET /_cotx/state` 拉一份，供渲染逻辑（attach）
 * 与设置页共用；设置页保存后广播，attach 据此开关/切换模式。
 *
 * 默认值保守（开启、半自动），host 不可达时按默认工作，不阻塞界面。
 */

import { apiGet, apiPost } from './api'

/** 翻译时机：半自动 = 展开才翻；自动 = 生成完就翻（折叠着也翻）。 */
export type TranslationMode = 'semi' | 'auto'

export interface ClientPrefs {
  enabled: boolean
  mode: TranslationMode
  target: string
  modelId: string
  useSessionModel: boolean
}

export const DEFAULT_PREFS: ClientPrefs = {
  enabled: true,
  mode: 'semi',
  /** 空串 = 还没初始化，等 ensureTargetLanguage() 按客户端语言写一次。 */
  target: '',
  modelId: 'hy-mt2-1.8b-q4',
  useSessionModel: false,
}

/** host `/state` 里与设置相关的部分。 */
interface StateLike {
  settings?: Partial<ClientPrefs>
}

let current: ClientPrefs = { ...DEFAULT_PREFS }
const listeners = new Set<(prefs: ClientPrefs) => void>()

/** 当前设置（只读副本）。 */
export function prefs(): ClientPrefs {
  return current
}

/** 订阅设置变化；返回取消订阅函数。 */
export function onPrefs(listener: (prefs: ClientPrefs) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 用一份新设置覆盖并广播。 */
export function setPrefs(next: Partial<ClientPrefs>): void {
  const merged = { ...current, ...next }
  current = {
    enabled: merged.enabled,
    mode: merged.mode === 'auto' ? 'auto' : 'semi',
    target: merged.target,
    modelId: merged.modelId,
    useSessionModel: merged.useSessionModel,
  }
  for (const listener of listeners) listener(current)
}

/** 从 host 拉取设置并广播；失败时保留当前值。 */
export async function loadPrefs(): Promise<void> {
  try {
    const state = await apiGet<StateLike>('/_cotx/state')
    if (state.settings !== undefined) setPrefs(state.settings)
  } catch {
    // host 还没准备好：按默认值工作
  }
}

/** 浏览器语言前缀 → 模型支持的语言码（前缀匹配，未列出则视为不支持）。 */
const LANGUAGE_PREFIXES: Record<string, string> = {
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  ru: 'ru',
  it: 'it',
  nl: 'nl',
  pl: 'pl',
  cs: 'cs',
  tr: 'tr',
  ar: 'ar',
  he: 'he',
  fa: 'fa',
  hi: 'hi',
  bn: 'bn',
  gu: 'gu',
  mr: 'mr',
  ta: 'ta',
  te: 'te',
  ur: 'ur',
  th: 'th',
  vi: 'vi',
  id: 'id',
  in: 'id',
  ms: 'ms',
  tl: 'tl',
  fil: 'tl',
  km: 'km',
  my: 'my',
  uk: 'uk',
  kk: 'kk',
  mn: 'mn',
  bo: 'bo',
  ug: 'ug',
  yue: 'yue',
}

/**
 * 把客户端语言标签（`navigator.language` / `<html lang>`）映射成模型支持的语言码。
 * 中文按地区分简繁；不认识的语言回退英文。
 */
export function detectTargetLanguage(candidates: readonly (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    const tag = candidate.toLowerCase()
    if (tag.startsWith('zh')) {
      return /hant|tw|hk|mo/.test(tag) ? 'zh-Hant' : 'zh-Hans'
    }
    const base = tag.split('-')[0]
    const mapped = LANGUAGE_PREFIXES[base]
    if (mapped !== undefined) return mapped
  }
  return 'en'
}

/**
 * 第一次运行（设置里的 target 为空）时，用**客户端当前语言**初始化目标语言，
 * 写进 host 设置；之后以用户的显式选择为准（不再自动改）。
 */
export async function ensureTargetLanguage(): Promise<void> {
  try {
    const state = await apiGet<StateLike>('/_cotx/state')
    const target = state.settings?.target
    if (target !== undefined && target !== '') {
      setPrefs(state.settings ?? {})
      return
    }
    // DSH 的 `<html lang>` 就是「客户端语言」（shell 的 locale 插件会同步它），
    // 优先级高于 navigator.language（那是 WebView/系统语言，可能和 UI 不一致）。
    const candidates: Array<string | undefined> = []
    if (typeof document !== 'undefined') candidates.push(document.documentElement?.lang)
    if (typeof navigator !== 'undefined') candidates.push(navigator.language)
    const detected = detectTargetLanguage(candidates)
    const updated = await apiPost<StateLike>('/_cotx/settings', { target: detected })
    if (updated.settings !== undefined) setPrefs(updated.settings)
  } catch {
    // host 没就绪：下次启动再试（target 仍为空，host 端用兜底语言）
  }
}
