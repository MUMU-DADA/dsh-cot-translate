/**
 * 本地 Ollama 服务的按需拉起（**headless，无 GUI**）。
 *
 * 为什么需要：用户明确不要 GUI 软件，所以 Ollama 的托盘应用不装/不启动，
 * 只保留 `ollama.exe serve` 这个命令行服务。服务没起来时插件按需拉起它，
 * 拉起后一直复用；DSH 退出也不会杀掉它（detached + unref）。
 *
 * 只在“确实要翻译、而且链里包含本地模型”时触发，不会在启动时无故开进程。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** 只取 fetch 的可调用签名，便于单测注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 自启行为的可注入依赖（测试用）。 */
export interface OllamaRuntimeDeps {
  /** 返回可执行文件路径；undefined = 找不到。 */
  resolveBin?: () => string | undefined
  /** 实际拉起进程（默认 `spawn(bin, ['serve'], { detached: true })`）。 */
  launch?: (bin: string) => void
  /** 等待函数（测试里换成零等待）。 */
  sleep?: (ms: number) => Promise<void>
  /** 等待服务就绪的总时长（默认 15 秒）。 */
  waitMs?: number
}

/** 探测间隔与单次探测超时。 */
const READY_POLL_MS = 500
const PROBE_TIMEOUT_MS = 1200

/**
 * 常见安装位置。用户明确指定了 `ollama.bin` 时优先用配置值。
 * Windows 官方/ winget 安装器默认在 `%LOCALAPPDATA%\Programs\Ollama`。
 */
export function defaultOllamaBin(): string | undefined {
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local !== undefined && local !== '') {
      const candidate = join(local, 'Programs', 'Ollama', 'ollama.exe')
      if (existsSync(candidate)) return candidate
    }
    return 'ollama.exe'
  }
  const candidates = ['/usr/local/bin/ollama', '/usr/bin/ollama', join(homedir(), '.local', 'bin', 'ollama')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'ollama'
}

/** 默认拉起方式：完全脱离父进程，不继承 stdio —— 无窗口、无 GUI。 */
function defaultLaunch(bin: string): void {
  const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {
    // 找不到可执行文件/无权限：交给后续就绪探测失败，不抛给调用方。
  })
  child.unref()
}

export interface EnsureResult {
  /** 本次是否拉起了进程。 */
  started: boolean
  /** 等待结束时服务是否可用。 */
  ready: boolean
}

/**
 * 确保本地服务可用：先探一次 `/api/tags`，连不上且允许自启就拉起并等就绪。
 * @param options - 服务地址、可执行文件、fetch 实现与可注入依赖。
 */
export async function ensureOllamaServer(options: {
  baseURL: string
  bin?: string
  fetchImpl: FetchLike
  deps?: OllamaRuntimeDeps
}): Promise<EnsureResult> {
  const { baseURL, fetchImpl } = options
  const deps = options.deps ?? {}
  const probe = async (): Promise<boolean> => {
    try {
      const response = await fetchImpl(`${baseURL}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  if (await probe()) return { started: false, ready: true }

  const executable =
    options.bin !== undefined && options.bin !== ''
      ? options.bin
      : (deps.resolveBin ?? defaultOllamaBin)()
  if (executable === undefined) return { started: false, ready: false }

  try {
    ;(deps.launch ?? defaultLaunch)(executable)
  } catch {
    return { started: false, ready: false }
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const deadline = Date.now() + (deps.waitMs ?? 15000)
  while (Date.now() < deadline) {
    await sleep(READY_POLL_MS)
    if (await probe()) return { started: true, ready: true }
  }
  return { started: true, ready: false }
}
