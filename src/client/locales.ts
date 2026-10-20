/**
 * UI 文案（中/英）。
 *
 * 通过 `ctx.locale.register(name, LOCALES)` 注册；组件里用 `t(key)` 取，
 * 拿不到宿主 t 时退回中文原文（见 `fallbackTranslate`），避免界面出现裸 key。
 */

/** 一份命名空间字典：flat key → 文案模板（`{name}` 为插值位）。 */
export type NamespaceDictionary = Record<string, string>

const zh: NamespaceDictionary = {
  // ── 双语对照面板 ──────────────────────────────────────────
  'bi.original': '原文',
  'bi.translation': '译文',
  'bi.loading': '翻译中…',
  'bi.failed': '翻译不可用',
  'bi.technical': '技术内容，不翻译',
  'bi.note': '本地模型翻译 · 只翻自然语言，代码 / 路径 / 链接保持原样',

  // ── 设置页（M4 用）─────────────────────────────────────────
  section: '思维链翻译',
  target: '目标语言',
  providerChain: '翻译来源（按顺序尝试）',
  timing: '翻译时机',
  timingLazy: '懒加载（默认）：新的思考实时翻，历史只在展开时翻',
  timingAll: '全量：打开会话就翻译所有思考',
  timingExpanded: '仅展开：只翻当前展开的思考',
  enabled: '启用翻译',
  translateAnswer: '同时翻译最终回答（可选）',
  providerLocal: '本地模型',
  providerOpenAI: 'OpenAI 兼容端点',
  providerFree: '免费在线（Google / Bing）',
  statusRunning: '翻译中…',
  statusFailed: '翻译失败，显示原文',
}

const en: NamespaceDictionary = {
  // ── bilingual panel ───────────────────────────────────────
  'bi.original': 'Source',
  'bi.translation': 'Translation',
  'bi.loading': 'Translating…',
  'bi.failed': 'Translation unavailable',
  'bi.technical': 'Technical content (not translated)',
  'bi.note': 'Local model · natural language only; code, paths and links stay as-is',

  // ── settings (M4) ─────────────────────────────────────────
  section: 'Chain-of-thought translation',
  target: 'Target language',
  providerChain: 'Translation providers (tried in order)',
  timing: 'Translation timing',
  timingLazy: 'Lazy (default): translate live reasoning; history on expand',
  timingAll: 'All: translate every reasoning block on open',
  timingExpanded: 'Expanded only: translate just the opened block',
  enabled: 'Enable translation',
  translateAnswer: 'Also translate the final answer (optional)',
  providerLocal: 'Local model',
  providerOpenAI: 'OpenAI-compatible endpoint',
  providerFree: 'Free online (Google / Bing)',
  statusRunning: 'Translating…',
  statusFailed: 'Translation failed; showing the original',
}

/** 交给 `ctx.locale.register(namespace, LOCALES)` 的字典表。 */
export const LOCALES: Record<string, NamespaceDictionary> = { zh, en }

/**
 * 宿主 `t` 尚未可用时的兜底翻译：中文原文，并处理 `{name}` 插值。
 * 只用于显示，不参与任何请求组装。
 */
export function fallbackTranslate(
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name]
    return value === undefined ? `{${name}}` : String(value)
  })
}
