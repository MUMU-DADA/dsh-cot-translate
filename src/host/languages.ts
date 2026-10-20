/**
 * 目标语言表（Hy-MT2 支持的 33 种语言 + 繁体/粤语）。
 *
 * 模型卡明确要求：提示词里用**完整的语言名**（英文提示用英文名，中文提示用中文名），
 * 所以这里同时给出英文名（拼进 system prompt）与中文名（设置页显示）。
 *
 * 来源：tencent/Hy-MT2-1.8B 模型卡 "Supported Languages"（2026-10-20 抓取）。
 */

export interface Language {
  /** BCP-47 风格短码，也用作设置里的值。 */
  code: string
  /** 英文全名（英文提示词用，必须完整）。 */
  en: string
  /** 中文名（设置页显示）。 */
  zh: string
}

/** 支持的语言（顺序：中文/英文在前，其余按模型卡顺序）。 */
export const LANGUAGES: readonly Language[] = [
  { code: 'zh-Hans', en: 'Simplified Chinese', zh: '简体中文' },
  { code: 'en', en: 'English', zh: '英语' },
  { code: 'zh-Hant', en: 'Traditional Chinese', zh: '繁体中文' },
  { code: 'ja', en: 'Japanese', zh: '日语' },
  { code: 'ko', en: 'Korean', zh: '韩语' },
  { code: 'fr', en: 'French', zh: '法语' },
  { code: 'de', en: 'German', zh: '德语' },
  { code: 'es', en: 'Spanish', zh: '西班牙语' },
  { code: 'pt', en: 'Portuguese', zh: '葡萄牙语' },
  { code: 'ru', en: 'Russian', zh: '俄语' },
  { code: 'it', en: 'Italian', zh: '意大利语' },
  { code: 'nl', en: 'Dutch', zh: '荷兰语' },
  { code: 'pl', en: 'Polish', zh: '波兰语' },
  { code: 'cs', en: 'Czech', zh: '捷克语' },
  { code: 'tr', en: 'Turkish', zh: '土耳其语' },
  { code: 'ar', en: 'Arabic', zh: '阿拉伯语' },
  { code: 'he', en: 'Hebrew', zh: '希伯来语' },
  { code: 'fa', en: 'Persian', zh: '波斯语' },
  { code: 'hi', en: 'Hindi', zh: '印地语' },
  { code: 'bn', en: 'Bengali', zh: '孟加拉语' },
  { code: 'gu', en: 'Gujarati', zh: '古吉拉特语' },
  { code: 'mr', en: 'Marathi', zh: '马拉地语' },
  { code: 'ta', en: 'Tamil', zh: '泰米尔语' },
  { code: 'te', en: 'Telugu', zh: '泰卢固语' },
  { code: 'ur', en: 'Urdu', zh: '乌尔都语' },
  { code: 'th', en: 'Thai', zh: '泰语' },
  { code: 'vi', en: 'Vietnamese', zh: '越南语' },
  { code: 'id', en: 'Indonesian', zh: '印尼语' },
  { code: 'ms', en: 'Malay', zh: '马来语' },
  { code: 'tl', en: 'Filipino', zh: '菲律宾语' },
  { code: 'km', en: 'Khmer', zh: '高棉语' },
  { code: 'my', en: 'Burmese', zh: '缅甸语' },
  { code: 'uk', en: 'Ukrainian', zh: '乌克兰语' },
  { code: 'kk', en: 'Kazakh', zh: '哈萨克语' },
  { code: 'mn', en: 'Mongolian', zh: '蒙古语' },
  { code: 'bo', en: 'Tibetan', zh: '藏语' },
  { code: 'ug', en: 'Uyghur', zh: '维吾尔语' },
  { code: 'yue', en: 'Cantonese', zh: '粤语' },
]

/** code → 英文全名（拼提示词用）。 */
export const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, language.en]),
)

// 常见别名：都指向同一个英文名，避免提示词里出现缩写。
for (const [alias, canonical] of [
  ['zh', 'zh-Hans'],
  ['zh-CN', 'zh-Hans'],
  ['zh-TW', 'zh-Hant'],
  ['ms-MY', 'ms'],
  ['in', 'id'],
] as const) {
  LANGUAGE_NAMES[alias] = LANGUAGE_NAMES[canonical]
}

/** 是否为已知语言码（用于校验设置）。 */
export function isKnownLanguage(code: string): boolean {
  return LANGUAGE_NAMES[code] !== undefined
}

/** 目标语言的提示词写法：已知语言给英文全名，未知原样透传。 */
export function languageLabel(code: string): string {
  return LANGUAGE_NAMES[code] ?? code
}
