/**
 * 送翻前的切分：把一段思考拆成「要翻的自然语言」与「原样保留的技术片段」。
 *
 * 做法是**分段而不是占位符**：命中的技术片段整段留在原处，翻译只发生在自然语言
 * 片段上，最后按原顺序拼回去。这样没有占位符被模型吞掉/改写的风险（AGENTS 红线：
 * 代码、路径、URL、标识符必须原样还原）。
 *
 * 纯函数，不碰 DOM / 网络，便于单测。
 */

/** 一个片段：`translate` 为 true 才送翻，false 原样保留。 */
export interface TextSpan {
  readonly translate: boolean
  readonly text: string
}

/** 围栏代码块 / 行内代码 / URL / Windows 路径 / POSIX 路径。 */
const KEEP_PATTERNS: readonly string[] = [
  '```[\\s\\S]*?(?:```|$)', // 围栏代码块（未闭合也吃掉）
  '`[^`\\n]+`', // 行内代码
  'https?://[^\\s<>()"\'`]+', // URL
  '[A-Za-z]:\\\\(?:[^\\\\\\s"\'<>|:*?]+\\\\)*[^\\\\\\s"\'<>|:*?]*', // C:\path\to\file
  '(?<![\\w.])/(?:[\\w.@+-]+/)+[\\w.@+-]*', // /usr/local/bin
  '\\b[a-zA-Z_][\\w.]*\\(\\s*\\)', // functionName()
]

/** 收集所有「原样保留」的区间，并合并重叠。 */
export function keepRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const pattern of KEEP_PATTERNS) {
    const regex = new RegExp(pattern, 'g')
    for (const match of text.matchAll(regex)) {
      const index = match.index
      if (index === undefined) continue
      ranges.push([index, index + match[0].length])
    }
  }
  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }
  return merged
}

/** 按「送翻 / 保留」切分整段文本，顺序与原文本一致。 */
export function splitForTranslation(text: string): TextSpan[] {
  const spans: TextSpan[] = []
  let cursor = 0
  for (const [start, end] of keepRanges(text)) {
    if (start > cursor) spans.push({ translate: true, text: text.slice(cursor, start) })
    spans.push({ translate: false, text: text.slice(start, end) })
    cursor = end
  }
  if (cursor < text.length) spans.push({ translate: true, text: text.slice(cursor) })
  return spans
}

/** 单段送翻文本的目标上限（ARCHITECTURE：≤ 240 字符）。 */
export const MAX_CHUNK_CHARS = 240

/**
 * 把一段自然语言切成 ≤ `max` 字符的句子块。
 *
 * 块里保留原有空白与标点，`chunks.join('') === text`；只有超长单句才硬切。
 * 这样翻译结果按顺序拼回去时，空格与换行不会走样。
 */
export function sentenceChunks(text: string, max = MAX_CHUNK_CHARS): string[] {
  if (text.length <= max) return text === '' ? [] : [text]

  // 先按「段末/句末 + 其后空白」切，保留分隔符在块尾部。
  const pieces = text.match(/[^.!?。！？\n]+(?:[.!?。！？]+|\n+|$)/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const piece of pieces) {
    if (piece.length > max) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }
      for (let offset = 0; offset < piece.length; offset += max) {
        chunks.push(piece.slice(offset, offset + max))
      }
      continue
    }
    if (current.length + piece.length > max) {
      chunks.push(current)
      current = piece
    } else {
      current += piece
    }
  }
  if (current !== '') chunks.push(current)
  return chunks
}

/** 一次请求最多带的块数（host 侧上限 64，这里留余量）。 */
export const MAX_CHUNKS_PER_REQUEST = 8

/** 一次请求最多带的总字符数（host 侧上限 16000，这里留余量）。 */
export const MAX_CHARS_PER_REQUEST = 1200

/** 把块列表分批，保证每条请求的段数与总字符数都在上限内。 */
export function batchChunks(chunks: readonly string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let chars = 0
  for (const chunk of chunks) {
    if (
      current.length > 0 &&
      (current.length >= MAX_CHUNKS_PER_REQUEST || chars + chunk.length > MAX_CHARS_PER_REQUEST)
    ) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(chunk)
    chars += chunk.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}
