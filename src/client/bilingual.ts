/**
 * 双语对照面板：左原文 / 右译文，逐段成行，悬停整行高亮（CSS 实现，无需 JS）。
 *
 * 面板是**纯 DOM**（不用 React）：它被注入到 shell 自己渲染的思考块里，
 * 走自己的 DOM 生命周期，避免和 shell 的 React 树互相踩。
 *
 * 失败语义：单段翻译失败 → 右栏显示“翻译不可用”；纯代码段落 → 右栏显示
 * “技术内容，不翻译”（fail-open，原文永远在左栏）。
 */

import type { Translate } from './cordis'
import { fallbackTranslate } from './locales'
import { isTechnicalOnly, normalizeMarkdownLite, paragraphsOf, renderSpansInto } from './text'
import type { TextTranslator } from './translate'

export interface BilingualPanelOptions {
  document: Document
  translator: TextTranslator
  t?: Translate
  /**
   * 运行中思考块的“尾巴稳定”判定窗口（毫秒）：最后一段这么久没再增长才送翻。
   * 默认 400ms；测试里调小。
   */
  tailSettleMs?: number
}

export interface BilingualPanel {
  readonly element: HTMLElement
  /**
   * 用最新原文刷新；内容没变则什么都不做。
   * @param running - 该思考块是否仍在流式输出。运行中时最后一段要“稳定”下来才送翻，
   *   否则每个 token 都会打一次模型。
   */
  update(text: string, running?: boolean): void
  /** 取消回填、移除 DOM。 */
  dispose(): void
}

/** 一行对照的 DOM 与状态。 */
interface Row {
  readonly root: HTMLElement
  readonly src: HTMLElement
  readonly dst: HTMLElement
  /** 本行当前对应的原文（去 Markdown 后的段落）。 */
  text: string
}

/**
 * 创建面板（但尚未插入 DOM）。
 * 调用方负责把 `element` 放进思考块，并在卸载时调用 `dispose`。
 */
export function createBilingualPanel(options: BilingualPanelOptions): BilingualPanel {
  const { document: doc, translator } = options
  const tr = options.t ?? fallbackTranslate

  const root = doc.createElement('div')
  root.className = 'cotx-bi'
  root.setAttribute('data-cot-panel', '1')

  const head = doc.createElement('div')
  head.className = 'cotx-bi-head'
  for (const key of ['bi.original', 'bi.translation'] as const) {
    const cell = doc.createElement('span')
    cell.className = 'cotx-bi-head-cell'
    cell.textContent = tr(key)
    head.appendChild(cell)
  }
  root.appendChild(head)

  const rowsBox = doc.createElement('div')
  rowsBox.className = 'cotx-bi-rows'
  root.appendChild(rowsBox)

  const note = doc.createElement('div')
  note.className = 'cotx-bi-note'
  note.textContent = tr('bi.note')
  root.appendChild(note)

  let rows: Row[] = []
  let lastText = ''
  let token = 0
  let disposed = false
  /**
   * 运行中的思考块：最后一段还在增长，要等它**停止增长一小段时间**才送翻，
   * 否则每个 token 都会打一次模型。用定时器而不是“扫描轮数”，
   * 这样不会被我们自己的 DOM 写入触发的观察回调误判为“稳定”。
   */
  let settledTail: string | undefined
  let tailTimer: ReturnType<typeof setTimeout> | undefined
  const tailSettleMs = options.tailSettleMs ?? 400

  /** 延迟补翻：到点时最后一段仍没变才真的送翻。 */
  const scheduleTailFlush = () => {
    if (tailTimer !== undefined) return
    tailTimer = setTimeout(() => {
      tailTimer = undefined
      if (!disposed) flushTail()
    }, tailSettleMs)
  }

  /** 建一行（左右两栏），左栏先渲染原文。 */
  const makeRow = (text: string, index: number): Row => {
    const row = doc.createElement('div')
    row.className = 'cotx-bi-row'
    row.setAttribute('data-cot-pair', String(index))

    const src = doc.createElement('div')
    src.className = 'cotx-bi-cell cotx-bi-src'
    renderSpansInto(doc, src, text)

    const dst = doc.createElement('div')
    dst.className = 'cotx-bi-cell cotx-bi-dst'
    dst.setAttribute('data-cot-state', 'loading')
    dst.textContent = tr('bi.loading')

    row.appendChild(src)
    row.appendChild(dst)
    rowsBox.appendChild(row)
    return { root: row, src, dst, text }
  }

  const setCell = (row: Row, state: 'loading' | 'done' | 'failed' | 'technical', text: string) => {
    row.dst.setAttribute('data-cot-state', state)
    row.dst.textContent = text
  }

  /** 只翻新增/变化的段落，其余保持原状（流式追加时尤其重要）。 */
  const translateDirty = (dirty: number[]) => {
    if (dirty.length === 0) return
    const myToken = ++token
    const texts = dirty.map((index) => rows[index].text)
    translator
      .translateMany(texts)
      .then((outcomes) => {
        if (disposed || myToken !== token) return
        outcomes.forEach((outcome, offset) => {
          const row = rows[dirty[offset]]
          if (row === undefined) return
          if (!outcome.ok) {
            setCell(row, 'failed', tr('bi.failed'))
            return
          }
          if (outcome.provider === 'none') {
            setCell(row, 'technical', tr('bi.technical'))
            return
          }
          setCell(row, 'done', outcome.text)
        })
      })
      .catch(() => {
        if (disposed || myToken !== token) return
        for (const index of dirty) {
          const row = rows[index]
          if (row !== undefined) setCell(row, 'failed', tr('bi.failed'))
        }
      })
  }

  /** 把被压住的最后一段补翻（若已稳定）。 */
  const flushTail = () => {
    const tail = rows.length - 1
    if (tail < 0 || settledTail === undefined) {
      settledTail = undefined
      return
    }
    const row = rows[tail]
    if (row.text !== settledTail || row.dst.getAttribute('data-cot-state') !== 'loading') {
      settledTail = undefined
      return
    }
    settledTail = undefined
    translateDirty([tail])
  }

  /** 取消待执行的尾巴补翻。 */
  const cancelTailFlush = () => {
    if (tailTimer === undefined) return
    clearTimeout(tailTimer)
    tailTimer = undefined
  }

  const update = (text: string, running = false) => {
    if (disposed) return
    if (text === lastText) {
      // 文本这一轮没变；运行中交给定时器判断“稳定”，停止流式则立刻补翻。
      if (settledTail === undefined) return
      if (!running) {
        cancelTailFlush()
        flushTail()
      }
      return
    }
    lastText = text
    const paragraphs = paragraphsOf(text)
      .map((paragraph) => normalizeMarkdownLite(paragraph))
      .filter((paragraph) => paragraph !== '')

    const dirty: number[] = []
    const tailIndex = paragraphs.length - 1
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      const existing = rows[index]
      if (existing === undefined) {
        const row = makeRow(paragraph, index)
        rows.push(row)
        // 运行中的最后一段先压住，等它停止增长再翻。
        if (running && index === tailIndex) {
          settledTail = paragraph
        } else {
          dirty.push(index)
        }
        continue
      }
      if (existing.text === paragraph) continue
      existing.text = paragraph
      renderSpansInto(doc, existing.src, paragraph)
      setCell(existing, 'loading', tr('bi.loading'))
      if (running && index === tailIndex) {
        settledTail = paragraph
        continue
      }
      dirty.push(index)
    }
    if (!running) {
      settledTail = undefined
      cancelTailFlush()
    }
    if (rows.length > paragraphs.length) {
      for (const row of rows.slice(paragraphs.length)) row.root.remove()
      rows = rows.slice(0, paragraphs.length)
    }
    if (settledTail !== undefined) scheduleTailFlush()
    translateDirty(dirty)
  }

  return {
    element: root,
    update,
    dispose() {
      disposed = true
      token += 1
      cancelTailFlush()
      root.remove()
    },
  }
}

/** 供测试断言：某行是否只含技术内容。 */
export { isTechnicalOnly }
