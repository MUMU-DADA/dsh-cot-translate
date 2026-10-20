/**
 * Client 半的设置镜像：从 host `GET /_cotx/state` 拉一份，供渲染逻辑（attach）
 * 与设置页共用；设置页保存后广播，attach 据此开关/切换模式。
 *
 * 默认值保守（开启、半自动），host 不可达时按默认工作，不阻塞界面。
 */

import { apiGet } from './api'

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
  target: 'zh-Hans',
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
