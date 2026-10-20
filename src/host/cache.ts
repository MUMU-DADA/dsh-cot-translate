/**
 * 两级缓存（进程内，不落盘）：
 *
 * - 成功译文进 LRU（ADR-008：约 600 条）；
 * - 失败结果进 30 秒负缓存，避免 provider 挂掉时被 UI 重试风暴打满。
 *
 * 不缓存原文以外的东西，也不写磁盘 —— 思考文本可能包含代码与内部路径。
 */

/** Map 迭代顺序即插入顺序；命中时重新插入即可得到 LRU 行为。 */
export class LruCache<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.map.size
  }

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    if (this.limit <= 0) return
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size <= this.limit) return
    const oldest = this.map.keys().next()
    if (!oldest.done) this.map.delete(oldest.value)
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * 失败负缓存：记录“这条内容刚刚失败过”，到期前不再打 provider。
 * 容量有上限，超出按插入顺序淘汰最旧的记录。
 */
export class NegativeCache {
  private readonly until = new Map<string, number>()

  constructor(
    private readonly ttlMs: number,
    private readonly limit = 200,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    this.purge()
    return this.until.size
  }

  /** 是否处于负缓存有效期（顺带清理过期项）。 */
  has(key: string): boolean {
    const expiry = this.until.get(key)
    if (expiry === undefined) return false
    if (this.now() >= expiry) {
      this.until.delete(key)
      return false
    }
    return true
  }

  add(key: string): void {
    if (this.ttlMs <= 0) return
    this.until.delete(key)
    this.until.set(key, this.now() + this.ttlMs)
    if (this.until.size <= this.limit) return
    const oldest = this.until.keys().next()
    if (!oldest.done) this.until.delete(oldest.value)
  }

  clear(): void {
    this.until.clear()
  }

  private purge(): void {
    const now = this.now()
    for (const [key, expiry] of this.until) {
      if (now >= expiry) this.until.delete(key)
    }
  }
}

/** 缓存键：目标语言 + 原文（原文不落盘、只作进程内哈希输入）。 */
export function cacheKey(target: string, text: string): string {
  return `${target}\u0000${text}`
}
