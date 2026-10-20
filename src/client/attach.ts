/**
 * 把双语面板挂进 shell 自己渲染的思考块里。
 *
 * 为什么要碰 DOM：`conversation.chat.node` 是 keyed 槽位，注册 `assistant-step`
 * 会**替换**官方 Assistant 渲染器（shadow shipped UI，见 DECISIONS ADR-011）；
 * 官方也没有 reasoning 级别的子槽位。所以走“观察 + 就地注入”这条路：
 *
 * 1. `MutationObserver` 盯 `[data-variant="think"][data-expanded]`（ReasoningRow 展开态，
 *    用的是 shell 自己的 data 属性，不依赖 hash 类名）；
 * 2. 找到其中的 `[class*="_thinkBody"]`，把双语面板插到最前面；
 * 3. 给 thinkBody 打 `data-cot-bilingual`，CSS 隐藏原来的纯文本渲染（原文在左栏可见）；
 * 4. 折叠/重渲染后清理面板与标记，绝不留下隐藏但存在的残留。
 *
 * 原文优先取**数据层**：`[data-chat-node-key]` + `[data-conversation-session]` 定位
 * 回合与节点，再用 ChatNodeStore 取该 reasoning 块的原文（含围栏代码，剔除器才准）；
 * 数据层拿不到（历史未加载等）时退回 DOM 文本。
 */

import type { BilingualPanel } from './bilingual'
import { createBilingualPanel } from './bilingual'
import type { Translate } from './cordis'
import type { TextTranslator } from './translate'

/** ReasoningRow 展开态（shell 自己的属性，不依赖 hash 类名）。 */
const EXPANDED_REASONING = '[data-variant="think"][data-expanded]'

/** 展开后的思考正文容器；类名是 CSS Module 的 `<hash>_thinkBody`。 */
const THINK_BODY = '[class*="_thinkBody"]'

export interface AttachOptions {
  document: Document
  translator: TextTranslator
  /** 数据层取原文：会话 + 节点 key + 该节点内第几个 reasoning 行。 */
  lookup: (sessionId: string, nodeKey: string, rowIndex: number) => string | undefined
  t?: Translate
  /** 扫描节流（毫秒）；测试传 0 直接跑。 */
  throttleMs?: number
  /** 运行中尾巴的稳定窗口（毫秒），透传给面板；测试里调小。 */
  tailSettleMs?: number
}

export interface AttachHandle {
  /** 手动扫描一次（挂在 MutationObserver 之外，测试也用它）。 */
  scan(): void
  dispose(): void
}

interface Attached {
  row: Element
  /** 首次注入时记下的 shell 原文容器（DOM 文本兜底用）。 */
  source: HTMLElement | null
  panel: BilingualPanel
}

/** ReasoningRow 是否还在流式输出（`data-state="running"`）。 */
function isRunning(row: Element): boolean {
  return row.getAttribute('data-state') === 'running'
}

/**
 * 开始观察并注入。
 * @returns 句柄；`dispose()` 会断开观察、移除所有面板与隐藏标记。
 */
export function attachBilingual(options: AttachOptions): AttachHandle {
  const { document: doc, translator } = options
  const throttleMs = options.throttleMs ?? 120
  const attached = new Map<HTMLElement, Attached>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: MutationObserver | undefined
  let disposed = false

  /** 该行对应思考块的原文：优先数据层，退回 DOM。 */
  const textOf = (row: Element, source: HTMLElement | null): string => {
    try {
      const item = row.closest('[data-chat-node-key]')
      const session = row.closest('[data-conversation-session]')
      const nodeKey = item?.getAttribute('data-chat-node-key')
      const sessionId = session?.getAttribute('data-conversation-session')
      if (
        item !== null &&
        typeof nodeKey === 'string' &&
        nodeKey !== '' &&
        typeof sessionId === 'string' &&
        sessionId !== ''
      ) {
        const rows = Array.from(item.querySelectorAll('[data-variant="think"]'))
        const rowIndex = rows.indexOf(row)
        if (rowIndex >= 0) {
          const text = options.lookup(sessionId, nodeKey, rowIndex)
          if (typeof text === 'string' && text.trim() !== '') return text
        }
      }
    } catch {
      // 数据层异常不影响显示：退回 DOM 文本。
    }
    return source?.textContent ?? ''
  }

  const scan = (): void => {
    if (disposed) return
    const alive = new Set<HTMLElement>()

    for (const row of Array.from(doc.querySelectorAll(EXPANDED_REASONING))) {
      const body = row.querySelector<HTMLElement>(THINK_BODY)
      if (body === null) continue
      alive.add(body)

      const existing = attached.get(body)
      if (existing !== undefined) {
        existing.row = row
        existing.panel.update(textOf(row, existing.source), isRunning(row))
        continue
      }

      // 先记下 shell 的原文容器，再把面板插到它前面。
      const source = body.firstElementChild instanceof HTMLElement ? body.firstElementChild : null
      const panel = createBilingualPanel({
        document: doc,
        translator,
        ...(options.t === undefined ? {} : { t: options.t }),
        ...(options.tailSettleMs === undefined ? {} : { tailSettleMs: options.tailSettleMs }),
      })
      body.setAttribute('data-cot-bilingual', '1')
      body.insertBefore(panel.element, body.firstChild)
      attached.set(body, { row, source, panel })
      panel.update(textOf(row, source), isRunning(row))
    }

    // 折叠 / 重渲染 / 切会话：把不再展开的思考块恢复原样。
    for (const [body, entry] of Array.from(attached)) {
      if (alive.has(body) && body.isConnected) continue
      entry.panel.dispose()
      body.removeAttribute('data-cot-bilingual')
      attached.delete(body)
    }
  }

  const schedule = (): void => {
    if (disposed || timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      scan()
    }, throttleMs)
  }

  scan()
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(schedule)
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-expanded', 'data-chat-node-key'],
      characterData: true,
    })
  }

  return {
    scan,
    dispose() {
      disposed = true
      observer?.disconnect()
      observer = undefined
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      for (const [body, entry] of attached) {
        entry.panel.dispose()
        body.removeAttribute('data-cot-bilingual')
      }
      attached.clear()
    },
  }
}
