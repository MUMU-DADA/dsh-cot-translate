/**
 * UI 文案（多语言）。
 *
 * 结构：
 * - 每种语言一个 JSON 文件（`zh.json` / `en.json` / `ja.json` …），翻译人员直接改 JSON；
 * - `zh` / `en` 是完整字典（shell 自带这两种语言），其它语言由插件通过
 *   `ctx.locale.addLanguage()` 注册成可选语言，缺的 key 由 shell 沿 fallback 链回退到 `en`；
 * - 所有组件都用 `t('key', params)` 取文案，禁止在组件里硬编码可见文字；
 * - host 半只返回 `labelKey` / `noteKey` / `errorCode`，由客户端按当前语言渲染。
 */

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ja from './ja.json'
import ko from './ko.json'
import ru from './ru.json'
import zh from './zh.json'
import zhHant from './zh-Hant.json'

/** 一份命名空间字典：flat key → 文案模板（`{name}` 为插值位）。 */
export type NamespaceDictionary = Record<string, string>

/** 完整字典里出现过的所有 key（zh 是权威清单）。 */
export type MessageKey = keyof typeof zh

/** 所有语言的字典；key 是 shell 的 locale id（`zh` / `en` 是自带的，其余是插件注册的）。 */
export const LOCALES: Record<string, NamespaceDictionary> = {
  zh,
  en,
  'zh-Hant': zhHant,
  ja,
  ko,
  fr,
  de,
  es,
  ru,
}

/** 一种由插件提供的可选 UI 语言。 */
export interface LocalePack {
  /** BCP 47 风格 id，必须与字典文件名一致。 */
  id: string
  /** 语言自己的名字（shell 的语言选择器里显示）。 */
  label: string
  /** 回退到的语言；缺省为 en，繁体回退简体更自然。 */
  fallback?: string
}

/**
 * 插件额外注册的可选语言。shell 只自带 zh / en；这些语言通过
 * `ctx.locale.addLanguage()` 加入语言目录，fallback 一律是 en。
 * 想加语言：在这里加一行 + 建对应的 `<id>.json`。
 */
export const LOCALE_PACKS: readonly LocalePack[] = [
  { id: 'zh-Hant', label: '繁體中文', fallback: 'zh' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
]

/** 作为回退链终点的语言（shell 一定自带）。 */
export const FALLBACK_LOCALE = 'en'

/** 宿主 `t` 尚未可用/缺 key 时的兜底翻译：先 zh 再 en，最后原样返回 key。 */
export function fallbackTranslate(
  key: string,
  params?: Record<string, string | number>,
): string {
  const zhDictionary: NamespaceDictionary = zh
  const enDictionary: NamespaceDictionary = en
  const template = zhDictionary[key] ?? enDictionary[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match: string, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}

/**
 * 取当前界面语言（BCP 47）。shell 的 locale 插件会把它同步到 `<html lang>`
 * （zh 写成 `zh-CN`），所以在组件里读它就等于读当前语言。
 */
export function currentLocale(): string {
  if (typeof document !== 'undefined') {
    const language = document.documentElement?.lang
    if (typeof language === 'string' && language !== '') return language
  }
  return FALLBACK_LOCALE
}

/** 按当前语言格式化数字（千分位、小数位等随语言变化）。 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(currentLocale(), options).format(value)
  } catch {
    return String(value)
  }
}

/**
 * 渲染 host 给的可翻译字段：有 key 且字典里有就用翻译，否则用 fallback 原文。
 * （shell 的 `t` 在缺 key 时会原样返回 key，用它判断。）
 */
export function localize(
  translate: (key: string, params?: Record<string, string | number>) => string,
  key: string | undefined,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (key === undefined || key === '') return fallback
  const value = translate(key, params)
  return value === key ? fallback : value
}
