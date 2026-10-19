/** 设置页与 UI 文案（中/英）。实现阶段换成 ctx.locale.register 的命名空间字典。 */

export const LOCALES = {
  zh: {
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
    original: '原文',
  },
  en: {
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
    original: 'Original',
  },
} as const

export type LocaleKey = keyof typeof LOCALES
