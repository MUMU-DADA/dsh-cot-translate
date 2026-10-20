/**
 * 磁盘译文缓存（跨重启保留）：`~/.dsh/cot-translate/cache/`。
 *
 * 设计要点：
 * - **只存译文**，原文只作为 sha256 键参与文件名 —— 原文不落盘（思考文本里
 *   可能有代码和内部路径）；
 * - 每个键一个小 JSON 文件，按 key 前两位分 256 个子目录，避免单目录几万文件；
 * - 总大小上限（默认 50MB），超限时按 **mtime（最近访问/写入时间）从旧到新** 淘汰，
 *   一次淘汰到上限的 90%，避免每写一条就抖一次；
 * - 命中时只在 mtime 超过 1 小时才 touch（utimes），减少无谓 IO；
 * - 启动时扫目录建索引（文件数通常远小于上限），损坏/无法解析的文件直接删掉。
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './settings'

/** 默认上限 50MB（用户要求）。 */
export const DEFAULT_CACHE_LIMIT_BYTES = 50 * 1024 * 1024

/** 淘汰到上限的这个比例，避免频繁触发。 */
const EVICT_TO_RATIO = 0.9

/** 命中后多久才刷新 mtime（毫秒）。 */
const TOUCH_AFTER_MS = 60 * 60 * 1000

/** 缓存统计（设置页展示用）。 */
export interface CacheStats {
  entries: number
  bytes: number
  limitBytes: number
  dir: string
}

interface FileMeta {
  path: string
  size: number
  mtimeMs: number
}

/** 磁盘译文缓存。 */
export class PersistentCache {
  private readonly dir: string
  private readonly limitBytes: number
  private readonly files = new Map<string, FileMeta>()
  private bytes = 0

  constructor(options: { dir?: string; limitBytes?: number } = {}) {
    this.dir = options.dir ?? join(dataDir(), 'cache')
    this.limitBytes = options.limitBytes ?? DEFAULT_CACHE_LIMIT_BYTES
    this.load()
  }

  /** 扫目录建索引（只在构造时执行一次）。 */
  private load(): void {
    if (!existsSync(this.dir)) return
    let shards: string[]
    try {
      shards = readdirSync(this.dir)
    } catch {
      return
    }
    for (const shard of shards) {
      const shardDir = join(this.dir, shard)
      let names: string[]
      try {
        names = readdirSync(shardDir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const path = join(shardDir, name)
        const key = name.slice(0, -'.json'.length)
        try {
          const stat = statSync(path)
          this.files.set(key, { path, size: stat.size, mtimeMs: stat.mtimeMs })
          this.bytes += stat.size
        } catch {
          // 扫不到就跳过
        }
      }
    }
  }

  /** 读一条缓存；不存在/损坏返回 undefined。 */
  get(target: string, text: string): string | undefined {
    const key = hashKey(target, text)
    const meta = this.files.get(key)
    if (meta === undefined) return undefined
    try {
      const raw = readFileSync(meta.path, 'utf8')
      const parsed = JSON.parse(raw) as { translation?: unknown }
      if (typeof parsed.translation !== 'string' || parsed.translation === '') {
        this.drop(key)
        return undefined
      }
      const now = Date.now()
      if (now - meta.mtimeMs > TOUCH_AFTER_MS) {
        try {
          utimesSync(meta.path, new Date(now), new Date(now))
          meta.mtimeMs = now
        } catch {
          // touch 失败不影响命中
        }
      }
      return parsed.translation
    } catch {
      this.drop(key)
      return undefined
    }
  }

  /** 写一条缓存（原子替换），超限时淘汰最旧的。 */
  set(target: string, text: string, translation: string, provider: string): void {
    if (translation === '') return
    const key = hashKey(target, text)
    const path = this.pathOf(key)
    const payload = `${JSON.stringify({ translation, provider, at: Date.now() })}\n`
    try {
      mkdirSync(join(this.dir, key.slice(0, 2)), { recursive: true })
      const temp = `${path}.tmp`
      writeFileSync(temp, payload, 'utf8')
      renameSync(temp, path)
      const size = Buffer.byteLength(payload, 'utf8')
      const previous = this.files.get(key)
      if (previous !== undefined) this.bytes -= previous.size
      this.files.set(key, { path, size, mtimeMs: Date.now() })
      this.bytes += size
      this.evictIfNeeded()
    } catch {
      // 磁盘满/权限问题：缓存失败不影响翻译
    }
  }

  /** 统计：条数、字节数、上限。 */
  stats(): CacheStats {
    return {
      entries: this.files.size,
      bytes: this.bytes,
      limitBytes: this.limitBytes,
      dir: this.dir,
    }
  }

  /** 清空全部缓存，返回清完之后的统计。 */
  clear(): CacheStats {
    try {
      rmSync(this.dir, { recursive: true, force: true })
    } catch {
      // 目录删不掉时逐个删文件
      for (const meta of this.files.values()) {
        try {
          unlinkSync(meta.path)
        } catch {
          // 忽略
        }
      }
    }
    this.files.clear()
    this.bytes = 0
    return this.stats()
  }

  /** 超过上限时按 mtime 从旧到新淘汰，直到降到上限的 90%。 */
  private evictIfNeeded(): void {
    if (this.bytes <= this.limitBytes) return
    const target = Math.floor(this.limitBytes * EVICT_TO_RATIO)
    const ordered = [...this.files.entries()].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs)
    for (const [key, meta] of ordered) {
      if (this.bytes <= target) break
      this.drop(key)
    }
  }

  /** 删一条索引 + 文件。 */
  private drop(key: string): void {
    const meta = this.files.get(key)
    if (meta === undefined) return
    this.files.delete(key)
    this.bytes -= meta.size
    try {
      unlinkSync(meta.path)
    } catch {
      // 已经没了
    }
  }

  /** 键 → 文件路径（前两位做目录分片）。 */
  private pathOf(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.json`)
  }
}

/** 原文+目标语言 → 固定长度的文件名（原文本身不落盘）。 */
function hashKey(target: string, text: string): string {
  return createHash('sha256').update(`${target}\u0000${text}`, 'utf8').digest('hex')
}
