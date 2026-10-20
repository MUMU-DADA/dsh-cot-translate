/**
 * 本地推理服务的按需拉起（**headless，纯命令行，无 GUI**）。
 *
 * 支持两种本地运行时：
 * - `llama.cpp` 的 `llama-server.exe`（默认，单文件二进制，Vulkan/CUDA 都能跑）；
 * - Ollama 的 `ollama serve`（可选，装了才用）。
 *
 * 行为：先探一次健康端点，连不上且允许自启就 spawn 一次（detached、stdio ignore、
 * 无窗口），然后轮询到就绪。同一个 baseURL 只会拉起一次；DSH 退出不杀子进程。
 * 找不到二进制/模型时返回 `{ ready: false }`，由 provider 链继续降级。
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { basename, join } from 'node:path'

/** 只取 fetch 的可调用签名，便于单测注入。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 自启行为的可注入依赖（测试用）。 */
export interface RuntimeDeps {
  /** 实际拉起进程（默认 detached spawn）；返回 pid 便于之后停掉。 */
  launch?: (bin: string, args: string[]) => void | number
  /** 等待函数（测试里换成零等待）。 */
  sleep?: (ms: number) => Promise<void>
  /** 等待服务就绪的总时长（默认 30 秒：第一次要加载模型到显存）。 */
  waitMs?: number
}

/** 拉起本地服务需要的可执行文件与参数。 */
export interface LaunchPlan {
  bin: string
  args: string[]
}

const READY_POLL_MS = 500
const PROBE_TIMEOUT_MS = 1500

/** 已确认可用 / 拉起中的服务（按 baseURL + 探测路径区分）。 */
const readyServers = new Set<string>()
const inflight = new Map<string, Promise<EnsureResult>>()

/** 默认拉起方式：完全脱离父进程，不继承 stdio —— 无窗口、无 GUI。 */
function defaultLaunch(bin: string, args: string[]): number | undefined {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', () => {
    // 找不到可执行文件/无权限：交给就绪探测失败，不抛给调用方。
  })
  child.unref()
  return child.pid
}

/** 我们自己拉起的进程 pid（按 baseURL），用于切换模型时停掉旧的。 */
const spawnedPids = new Map<string, number>()

/**
 * 停掉本插件拉起的本地服务（切换模型/关闭功能时用）。
 * 只杀自己 spawn 的进程，不动用户手动起的实例。
 */
export function stopLocalServer(baseURL: string): void {
  const pid = spawnedPids.get(baseURL)
  spawnedPids.delete(baseURL)
  readyServers.delete(`${baseURL}|/health`)
  readyServers.delete(`${baseURL}|/api/tags`)
  if (pid === undefined) return
  try {
    process.kill(pid)
  } catch {
    // 进程已经退出/无权限：忽略
  }
}

export interface EnsureResult {
  /** 本次是否拉起了进程。 */
  started: boolean
  /** 结束时服务是否可用。 */
  ready: boolean
}

export interface EnsureLocalServerOptions {
  baseURL: string
  /** 健康检查路径：llama.cpp 是 `/health`，Ollama 是 `/api/tags`。 */
  probePath: string
  fetchImpl: FetchLike
  /** 返回拉起计划；返回 undefined 表示“找不到东西可拉起”。 */
  plan: () => LaunchPlan | undefined
  deps?: RuntimeDeps
}

/**
 * 确保本地服务在跑；必要时拉起一次并等待就绪。同一服务并发调用只拉起一次。
 */
export async function ensureLocalServer(
  options: EnsureLocalServerOptions,
): Promise<EnsureResult> {
  const key = `${options.baseURL}|${options.probePath}`
  if (readyServers.has(key)) return { started: false, ready: true }
  const running = inflight.get(key)
  if (running !== undefined) return running
  const task = runEnsure(options)
    .then((result) => {
      if (result.ready) readyServers.add(key)
      return result
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, task)
  return task
}

async function runEnsure(options: EnsureLocalServerOptions): Promise<EnsureResult> {
  const { baseURL, probePath, fetchImpl } = options
  const deps = options.deps ?? {}
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  const probe = async (): Promise<boolean> => {
    try {
      const response = await fetchImpl(`${baseURL}${probePath}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  if (await probe()) return { started: false, ready: true }

  const plan = options.plan()
  if (plan === undefined) return { started: false, ready: false }

  try {
    const pid = (deps.launch ?? defaultLaunch)(plan.bin, plan.args)
    if (typeof pid === 'number') spawnedPids.set(baseURL, pid)
  } catch {
    return { started: false, ready: false }
  }

  const deadline = Date.now() + (deps.waitMs ?? 30000)
  while (Date.now() < deadline) {
    await sleep(READY_POLL_MS)
    if (await probe()) return { started: true, ready: true }
  }
  return { started: true, ready: false }
}

// ── 可执行文件 / 模型文件的默认发现 ─────────────────────────────────

/**
 * llama-server 的常见位置。
 * Windows 用免安装的 release 压缩包，默认放在 `%USERPROFILE%\tools\llama.cpp\`。
 */
export function defaultLlamaServerBin(): string | undefined {
  const home = homedir()
  const candidates =
    platform() === 'win32'
      ? [
          join(home, 'tools', 'llama.cpp', 'llama-server.exe'),
          join(home, 'llama.cpp', 'llama-server.exe'),
          join(home, 'tools', 'llama.cpp', 'build', 'bin', 'llama-server.exe'),
          'llama-server.exe',
        ]
      : [
          join(home, '.local', 'bin', 'llama-server'),
          '/usr/local/bin/llama-server',
          '/usr/bin/llama-server',
          'llama-server',
        ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  // 找不到就明确返回 undefined：不要在测试/别处盲目 spawn 一个不存在的进程。
  return undefined
}

/** 在 `~/models` 里找 GGUF：优先 Hy-MT2，其次任意 .gguf。 */
export function defaultModelPath(): string | undefined {
  const dir = join(homedir(), 'models')
  if (!existsSync(dir)) return undefined
  try {
    const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.gguf'))
    if (files.length === 0) return undefined
    const preferred = files.filter((name) => /hy-mt2/i.test(name))
    const pool = preferred.length > 0 ? preferred : files
    // 同族优先 Q4_K_M（显存小、质量够），其次 Q6/Q8。
    pool.sort((left, right) => score(left) - score(right))
    return join(dir, pool[0])
  } catch {
    return undefined
  }
}

/** 量化档位打分：Q4_K_M < Q4 < Q5 < Q6_K < Q8_0 < 其它。 */
function score(name: string): number {
  const lower = name.toLowerCase()
  if (lower.includes('q4_k_m')) return 0
  if (lower.includes('q4')) return 1
  if (lower.includes('q5')) return 2
  if (lower.includes('q6')) return 3
  if (lower.includes('q8')) return 4
  return 5
}

/** 模型展示名（`Hy-MT2-1.8B-Q4_K_M.gguf` → `Hy-MT2-1.8B-Q4_K_M`）。 */
export function modelLabel(path: string): string {
  return basename(path).replace(/\.gguf$/i, '')
}

/** 本地服务默认端口：8080 太容易被别的应用占用（实测被一个 python 应用抢过）。 */
const DEFAULT_PORT = '18099'

/** 从 baseURL 取端口（非法时回退默认端口）。 */
export function portOf(baseURL: string): string {
  try {
    const url = new URL(baseURL)
    return url.port === '' ? DEFAULT_PORT : url.port
  } catch {
    return DEFAULT_PORT
  }
}

/** 从 baseURL 取 host（默认回环）。 */
export function hostOf(baseURL: string): string {
  try {
    const url = new URL(baseURL)
    return url.hostname === '' ? '127.0.0.1' : url.hostname
  } catch {
    return '127.0.0.1'
  }
}

// ── Ollama（可选，保留兼容）────────────────────────────────────────

/** Ollama 的常见安装位置。 */
export function defaultOllamaBin(): string | undefined {
  if (platform() === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local !== undefined && local !== '') {
      const candidate = join(local, 'Programs', 'Ollama', 'ollama.exe')
      if (existsSync(candidate)) return candidate
    }
    return undefined
  }
  const candidates = ['/usr/local/bin/ollama', '/usr/bin/ollama', join(homedir(), '.local', 'bin', 'ollama')]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * 确保 Ollama 服务在跑（可选路径；不装 Ollama 时不会被触发）。
 * 保留给仍然使用 Ollama 的用户，本机默认走 llama.cpp。
 */
export async function ensureOllamaServer(options: {
  baseURL: string
  bin?: string
  fetchImpl: FetchLike
  deps?: RuntimeDeps
}): Promise<EnsureResult> {
  return ensureLocalServer({
    baseURL: options.baseURL,
    probePath: '/api/tags',
    fetchImpl: options.fetchImpl,
    ...(options.deps === undefined ? {} : { deps: options.deps }),
    plan: () => {
      const executable =
        options.bin !== undefined && options.bin !== '' ? options.bin : defaultOllamaBin()
      return executable === undefined ? undefined : { bin: executable, args: ['serve'] }
    },
  })
}
