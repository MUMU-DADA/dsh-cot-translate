/**
 * 本地模型目录与下载管理。
 *
 * 两种模型：
 * - **bundled**：随插件目录分发（`<插件根>/models/`），是兜底模型，**不可删除**；
 * - **preset**：需要额外下载，存到 `~/.dsh/cot-translate/models/`，可下载/更新/删除。
 *
 * 下载走 HF 的直链（GGUF），边下边写临时文件，状态可轮询；
 * 下载完 rename 成正式文件名，避免半截文件被当成可用模型。
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dataDir } from './settings'

/** 一个可选模型。 */
export interface ModelEntry {
  id: string
  label: string
  /** GGUF 文件名。 */
  file: string
  /** 下载地址。 */
  url: string
  /** 大致体积（MB），用于 UI 预估。 */
  sizeMB: number
  /** 随插件分发、不可删除、作为兜底。 */
  bundled: boolean
  note: string
  /** 模型许可证（展示用，下载页/设置页显示）。 */
  license: string
  /** 版权归属（展示用）。 */
  copyright: string
  /** 模型来源仓库（展示用）。 */
  source: string
}

const HF_18B = 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main'
const HF_7B = 'https://huggingface.co/tencent/Hy-MT2-7B-GGUF/resolve/main'

/** 内置目录：第一个是插件自带兜底模型。 */
export const MODEL_CATALOG: readonly ModelEntry[] = [
  {
    id: 'hy-mt2-1.8b-q4',
    label: 'Hy-MT2 1.8B Q4_K_M',
    file: 'Hy-MT2-1.8B-Q4_K_M.gguf',
    url: `${HF_18B}/Hy-MT2-1.8B-Q4_K_M.gguf`,
    sizeMB: 1080.6,
    bundled: true,
    note: '插件自带 · 兜底模型（不可删除）；最快，显存约 1.5GB',
    license: 'Apache-2.0',
    copyright: '© Tencent Hunyuan',
    source: 'tencent/Hy-MT2-1.8B-GGUF',
  },
  {
    id: 'hy-mt2-1.8b-q8',
    label: 'Hy-MT2 1.8B Q8_0',
    file: 'Hy-MT2-1.8B-Q8_0.gguf',
    url: `${HF_18B}/Hy-MT2-1.8B-Q8_0.gguf`,
    sizeMB: 1820.1,
    bundled: false,
    note: '精度更高一点，显存约 2.3GB，速度略慢',
    license: 'Apache-2.0',
    copyright: '© Tencent Hunyuan',
    source: 'tencent/Hy-MT2-1.8B-GGUF',
  },
  {
    id: 'hy-mt2-7b-q4',
    label: 'Hy-MT2 7B Q4_K_M',
    file: 'Hy-MT2-7B-Q4_K_M.gguf',
    url: `${HF_7B}/Hy-MT2-7B-Q4_K_M.gguf`,
    sizeMB: 4410.4,
    bundled: false,
    note: '质量最好，显存约 4.5GB，速度约为 1.8B 的 1/3–1/5',
    license: 'Apache-2.0',
    copyright: '© Tencent Hunyuan',
    source: 'tencent/Hy-MT2-7B-GGUF',
  },
]

/** 找不到模型 id 时返回 undefined。 */
export function findModel(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === id)
}

/** 插件自带的模型目录（随包分发）。 */
export function bundledDir(): string {
  // lib/index.js → ../models = 包根目录下的 models/
  return fileURLToPath(new URL('../models/', import.meta.url))
}

/** 下载的模型目录（用户数据）。 */
export function managedDir(): string {
  return join(dataDir(), 'models')
}

/** 该模型应该落在哪个路径。 */
export function filePathOf(entry: ModelEntry): string {
  return join(entry.bundled ? bundledDir() : managedDir(), entry.file)
}

/** 已安装则返回路径。 */
export function resolveModelPath(id: string): string | undefined {
  const entry = findModel(id)
  if (entry === undefined) return undefined
  const path = filePathOf(entry)
  return existsSync(path) ? path : undefined
}

/** UI 用的模型状态。 */
export interface ModelStatus {
  id: string
  label: string
  bundled: boolean
  note: string
  sizeMB: number
  installed: boolean
  /** 已安装文件的实际字节数（未安装为 0）。 */
  bytes: number
  /** 下载地址（UI 不展示，仅本地排障用）。 */
  url: string
  /** 许可证（设置页展示，如 Apache-2.0）。 */
  license: string
  /** 版权归属。 */
  copyright: string
  /** 来源仓库。 */
  source: string
}

/** 当前模型状态列表。 */
export function listModels(): ModelStatus[] {
  return MODEL_CATALOG.map((entry) => {
    const path = filePathOf(entry)
    const installed = existsSync(path)
    return {
      id: entry.id,
      label: entry.label,
      bundled: entry.bundled,
      note: entry.note,
      sizeMB: entry.sizeMB,
      installed,
      bytes: installed ? statSync(path).size : 0,
      url: entry.url,
      license: entry.license,
      copyright: entry.copyright,
      source: entry.source,
    }
  })
}

/** 一次下载的进度（内存态，重启即清空）。 */
export interface DownloadState {
  id: string
  phase: 'idle' | 'downloading' | 'done' | 'error'
  received: number
  total: number
  error?: string
}

const downloads = new Map<string, DownloadState>()

/** 某模型的下载状态。 */
export function downloadStateOf(id: string): DownloadState {
  return downloads.get(id) ?? { id, phase: 'idle', received: 0, total: 0 }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 下载（或更新）一个模型到目标目录。
 * - 已有同名文件会被新文件替换；
 * - 写入 `<file>.part` 再 rename，避免半截文件被当成可用模型；
 * - 状态写进内存，UI 轮询 `downloadStateOf`。
 */
export async function downloadModel(
  id: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<void> {
  const entry = findModel(id)
  if (entry === undefined) throw new Error(`unknown model: ${id}`)
  const current = downloads.get(id)
  if (current?.phase === 'downloading') return

  const target = filePathOf(entry)
  const temp = `${target}.part`
  mkdirSync(entry.bundled ? bundledDir() : managedDir(), { recursive: true })
  const state: DownloadState = { id, phase: 'downloading', received: 0, total: 0 }
  downloads.set(id, state)

  try {
    const response = await fetchImpl(entry.url)
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status}`)
    }
    const total = Number(response.headers.get('content-length') ?? 0) || 0
    state.total = total
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    body.on('data', (chunk: Buffer) => {
      state.received += chunk.length
    })
    await pipeline(body, createWriteStream(temp))
    renameSync(temp, target)
    state.phase = 'done'
    state.total = state.total === 0 ? state.received : state.total
  } catch (error) {
    state.phase = 'error'
    state.error = error instanceof Error ? error.message : String(error)
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // 清理失败不影响报错
    }
    throw error
  }
}

/** 删除一个已下载的模型；自带模型不可删除。 */
export function deleteModel(id: string): boolean {
  const entry = findModel(id)
  if (entry === undefined || entry.bundled) return false
  const path = filePathOf(entry)
  if (existsSync(path)) unlinkSync(path)
  downloads.delete(id)
  return true
}

/**
 * 老版本把模型放在 `~/models`：若自带模型缺失而旧位置有，直接挪进插件目录。
 * （同一磁盘上 rename 是瞬时的，不复制 1GB。）
 */
export function adoptLegacyModel(): void {
  const bundled = MODEL_CATALOG.find((entry) => entry.bundled)
  if (bundled === undefined) return
  const target = filePathOf(bundled)
  if (existsSync(target)) return
  const legacy = join(homedir(), 'models', bundled.file)
  if (!existsSync(legacy)) return
  try {
    mkdirSync(bundledDir(), { recursive: true })
    renameSync(legacy, target)
  } catch {
    // 跨盘/权限问题：保持原样，用户还可以手动放
  }
}
