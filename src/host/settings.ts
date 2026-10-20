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
  /** 目标语言 */
  target: string
}

export const DEFAULT_SETTINGS: CotSettings = {
  enabled: true,
  mode: 'semi',
  modelId: 'hy-mt2-1.8b-q4',
  useSessionModel: false,
  target: 'zh-Hans',
}

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
  const target =
    typeof source.target === 'string' && source.target.trim() !== ''
      ? source.target.trim().slice(0, 32)
      : DEFAULT_SETTINGS.target
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    mode,
    modelId,
    useSessionModel:
      typeof source.useSessionModel === 'boolean'
        ? source.useSessionModel
        : DEFAULT_SETTINGS.useSessionModel,
    target,
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
