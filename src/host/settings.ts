/**
 * 插件设置：持久化在 `~/.dsh/cot-translate/settings.json`。
 *
 * 为什么自己存而不是用 DSH 的 settings 服务：这套设置只影响本插件、需要
 * 立刻生效（改模型要重启本地服务），自己存一份 JSON 最简单，也不用把
 * schemastery schema 拉进依赖（ADR-012 的延续）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isKnownLanguage } from './languages'

/** 翻译时机：半自动 = 展开才翻；自动 = 生成完就翻（折叠着也翻）。 */
export type TranslationMode = 'semi' | 'auto'

export interface CotSettings {
  /** 总开关 */
  enabled: boolean
  /** 翻译时机 */
  mode: TranslationMode
  /** 选中的本地模型 id（见 models.ts 的 catalog） */
  modelId: string
  /** 用当前对话的 API 模型翻译（而不是本地模型） */
  useSessionModel: boolean
  /** 允许本地失败后把原文发给 Google（默认关闭，隐私优先） */
  allowOnline: boolean
  /** 目标语言（"" = 待客户端按自己的语言初始化） */
  target: string
  /** 本地 llama-server 的端口（可在设置页调整） */
  localPort: number
}

/** 目标语言为空（""）表示「还没定，等客户端按自己的语言初始化」。 */
/** 默认服务端口：刻意避开 8080/3000/5000 这类常见端口。 */
export const DEFAULT_LOCAL_PORT = 28457

/** 端口的合法范围（1024–65535；1024 以下需要管理员权限）。 */
export const MIN_LOCAL_PORT = 1024
export const MAX_LOCAL_PORT = 65535

export const DEFAULT_SETTINGS: CotSettings = {
  enabled: true,
  mode: 'semi',
  modelId: 'hy-mt2-1.8b-q4',
  useSessionModel: false,
  allowOnline: false,
  target: '',
  localPort: DEFAULT_LOCAL_PORT,
}

/** target 未初始化时，host 端兜底用的语言（客户端没来/拿不到时）。 */
export const FALLBACK_TARGET = 'zh-Hans'

/** 插件数据目录（设置、下载的模型）。`COTX_HOME` 可覆盖（测试用）。 */
export function dataDir(): string {
  const override = process.env.COTX_HOME
  if (override !== undefined && override !== '') return override
  return join(homedir(), '.dsh', 'cot-translate')
}

/** 设置文件路径。 */
export function settingsPath(): string {
  return join(dataDir(), 'settings.json')
}

/** 归一化：坏值回退默认，永不抛错。 */
export function normalizeSettings(raw: unknown): CotSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const mode = source.mode === 'auto' ? 'auto' : source.mode === 'semi' ? 'semi' : DEFAULT_SETTINGS.mode
  const modelId =
    typeof source.modelId === 'string' && source.modelId.trim() !== ''
      ? source.modelId.trim()
      : DEFAULT_SETTINGS.modelId
  // 只接受 Hy-MT2 支持的语言码；"" 表示待客户端初始化（见 prefs.ensureTargetLanguage）。
  const rawTarget =
    typeof source.target === 'string'
      ? source.target.trim().slice(0, 32)
      : DEFAULT_SETTINGS.target
  const target = rawTarget === '' || isKnownLanguage(rawTarget) ? rawTarget : DEFAULT_SETTINGS.target
  const rawPort = source.localPort
  const localPort =
    typeof rawPort === 'number' && Number.isSafeInteger(rawPort) && rawPort >= MIN_LOCAL_PORT && rawPort <= MAX_LOCAL_PORT
      ? rawPort
      : DEFAULT_SETTINGS.localPort
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    mode,
    modelId,
    useSessionModel:
      typeof source.useSessionModel === 'boolean'
        ? source.useSessionModel
        : DEFAULT_SETTINGS.useSessionModel,
    allowOnline:
      typeof source.allowOnline === 'boolean'
        ? source.allowOnline
        : DEFAULT_SETTINGS.allowOnline,
    target,
    localPort,
  }
}

/** 读取设置；文件不存在/损坏都回退默认。 */
export function loadSettings(): CotSettings {
  const file = settingsPath()
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS }
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** 写入设置（先建目录；返回归一化后的值）。 */
export function saveSettings(raw: unknown): CotSettings {
  const settings = normalizeSettings(raw)
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  return settings
}

/** 把一批补丁合并进当前设置并落盘。 */
export function patchSettings(patch: unknown): CotSettings {
  const current = loadSettings()
  const merged = { ...current, ...(typeof patch === 'object' && patch !== null ? patch : {}) }
  return saveSettings(merged)
}
