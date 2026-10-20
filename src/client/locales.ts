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

  // ── 设置页：导航与总述 ────────────────────────────────────
  'set.title': '思维链翻译',
  'set.intro': '把思考（reasoning）实时翻译成中文，显示在原文右侧。译文只用于显示，不会写回会话。',
  'set.loading': '正在读取设置…',

  // ── 设置页：开关与时机 ────────────────────────────────────
  'set.enabled': '启用翻译',
  'set.enabledHint': '关掉后不再翻译，思考块恢复原文显示。',
  'set.mode': '翻译时机',
  'set.modeHint': '半自动：手动点开思考才开始翻；自动：思考生成完就立刻翻译（折叠着也翻，展开即有译文）。',
  'set.modeSemi': '半自动',
  'set.modeAuto': '自动',
  'set.target': '译文语言',
  'set.targetHint': '翻译成哪种语言（支持 Hy-MT2 的 30+ 种语言；改完立即生效）。默认跟随安装插件时的客户端语言。',
  'set.targetUnset': '（跟随客户端语言）',

  // ── 设置页：模型 ──────────────────────────────────────────
  'set.model': '本地翻译模型',
  'set.modelHint': '默认用插件自带的 1.8B（兜底模型）。换更大的模型更准，但更吃显存、更慢。',
  'set.bundled': '自带 · 兜底',
  'set.installed': '已安装',
  'set.notInstalled': '未下载',
  'set.notDownloaded': '未下载',
  'set.aboutSize': '约',
  'set.download': '下载',
  'set.update': '更新',
  'set.delete': '删除',
  'set.downloadFailed': '下载失败',

  // ── 设置页：对话框模型与自测 ──────────────────────────────
  'set.sessionModel': '使用当前对话的 API 模型翻译',
  'set.sessionModelHint': '打开后走当前会话选中的模型（更快、不占显存，但会产生 API 调用费用）；本地模型只作兜底。',
  'set.selftest': '本地模型速度测试',
  'set.selftestHint': '用固定样本跑一遍当前翻译链，显示平均每段耗时。',
  'set.selftestStart': '开始测试',
  'set.selftestRunning': '测试中…',
  'set.selftestResult': '平均 {ms} ms/段 · {api}',
  'set.selftestFailed': '测试失败',
  'set.chain': '当前翻译来源',
  'set.copyright': '© 2026 dsh-cot-translate contributors',
  'set.version': 'v{version} · MIT License',
  'set.versionUnknown': 'MIT License',

  // ── 设置页：翻译缓存 ──────────────────────────────────────
  'set.port': '本地服务端口',
  'set.portHint': 'llama-server 监听的回环端口（1024–65535）。默认 28457，避开常见端口；改完下次翻译会按新端口重新拉起。',
  'set.portSave': '应用',
  'set.portFree': '端口空闲',
  'set.portOurs': '本地服务正在使用该端口',
  'set.portBusy': '端口被其他程序占用',
  'set.portInvalid': '端口必须是 1024–65535 之间的整数',
  'set.cache': '翻译缓存',
  'set.cacheHint': '译文缓存在本地（只存译文，原文不落盘），重启后已翻过的内容直接命中。上限 {limit}，超出后自动清理最旧的。',
  'set.cacheUsage': '{used} / {limit} · {entries} 条',
  'set.cacheClear': '清理缓存',
  'set.cacheCleared': '已清理',
}

const en: NamespaceDictionary = {
  // ── bilingual panel ───────────────────────────────────────
  'bi.original': 'Source',
  'bi.translation': 'Translation',
  'bi.loading': 'Translating…',
  'bi.failed': 'Translation unavailable',
  'bi.technical': 'Technical content (not translated)',
  'bi.note': 'Local model · natural language only; code, paths and links stay as-is',

  // ── settings: nav & intro ─────────────────────────────────
  'set.title': 'Chain-of-thought translation',
  'set.intro':
    'Translate reasoning into Chinese next to the original text. Translations are display-only and never written back to the session.',
  'set.loading': 'Loading settings…',

  // ── settings: toggles & timing ────────────────────────────
  'set.enabled': 'Enable translation',
  'set.enabledHint': 'When off, reasoning blocks show their original text only.',
  'set.mode': 'Translation timing',
  'set.modeHint':
    'Semi-auto: translate when you expand a reasoning block. Auto: translate as soon as reasoning completes, even while collapsed.',
  'set.modeSemi': 'Semi-auto',
  'set.modeAuto': 'Auto',
  'set.target': 'Target language',
  'set.targetHint':
    'Translate into this language (30+ supported by Hy-MT2; takes effect immediately). Defaults to the client language when the plugin was installed.',
  'set.targetUnset': '(follow client language)',

  // ── settings: models ──────────────────────────────────────
  'set.model': 'Local translation model',
  'set.modelHint':
    'The bundled 1.8B is the fallback. Larger models are more accurate but slower and use more VRAM.',
  'set.bundled': 'Bundled · fallback',
  'set.installed': 'Installed',
  'set.notInstalled': 'Not downloaded',
  'set.notDownloaded': 'not downloaded',
  'set.aboutSize': 'about',
  'set.download': 'Download',
  'set.update': 'Update',
  'set.delete': 'Delete',
  'set.downloadFailed': 'Download failed',

  // ── settings: session model & self-test ───────────────────
  'set.sessionModel': 'Translate with the current conversation model',
  'set.sessionModelHint':
    'Uses the model selected for this conversation (faster, no VRAM), costs API calls; the local model stays the fallback.',
  'set.selftest': 'Local model speed test',
  'set.selftestHint': 'Runs a fixed sample through the current chain and reports the average time per segment.',
  'set.selftestStart': 'Run test',
  'set.selftestRunning': 'Testing…',
  'set.selftestResult': '{ms} ms/segment average · {api}',
  'set.selftestFailed': 'Test failed',
  'set.chain': 'Current providers',
  'set.copyright': '© 2026 dsh-cot-translate contributors',
  'set.version': 'v{version} · MIT License',
  'set.versionUnknown': 'MIT License',

  // ── settings: translation cache ───────────────────────────
  'set.port': 'Local service port',
  'set.portHint':
    'Loopback port for llama-server (1024–65535). Default 28457, deliberately uncommon; the next translation restarts the server on the new port.',
  'set.portSave': 'Apply',
  'set.portFree': 'Port is free',
  'set.portOurs': 'Used by our local service',
  'set.portBusy': 'Port is used by another program',
  'set.portInvalid': 'Port must be an integer between 1024 and 65535',
  'set.cache': 'Translation cache',
  'set.cacheHint':
    'Translations are cached locally (translations only — source text is never written to disk). Restarts reuse them. Cap {limit}; the oldest entries are evicted automatically.',
  'set.cacheUsage': '{used} / {limit} · {entries} entries',
  'set.cacheClear': 'Clear cache',
  'set.cacheCleared': 'Cleared',
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
