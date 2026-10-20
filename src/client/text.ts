/**
 * 双语面板用的文本处理：切段、轻量去 Markdown 标记、把片段渲染成 DOM 节点。
 *
 * 为什么不用官方 markdown 渲染器：面板要的是**逐段对齐**的原文/译文两列，
 * 不是渲染后的富文本。这里只保留“读得懂原文”的最低限度：
 * 代码/路径/URL 用等宽字体，粗体/标题等标记去掉（否则左栏会露出 `**`）。
 */

import type { TextSpan } from './strip'
import { splitForTranslation } from './strip'

/** 围栏代码块正则（含未闭合）。 */
const FENCE = /```[\s\S]*?(?:```|$)/g

/**
 * 把思考文本切成段落。
 *
 * 围栏代码块整体作为一个段落（内部的空行不再切分），其余按空行切。
 * 纯空白段落丢弃，顺序不变。
 */
export function paragraphsOf(text: string): string[] {
  const segments: string[] = []
  let cursor = 0
  for (const match of text.matchAll(FENCE)) {
    const index = match.index ?? 0
    if (index > cursor) segments.push(text.slice(cursor, index))
    segments.push(match[0])
    cursor = index + match[0].length
  }
  if (cursor < text.length) segments.push(text.slice(cursor))

  const paragraphs: string[] = []
  for (const segment of segments) {
    if (segment.trimStart().startsWith('```')) {
      const trimmed = segment.replace(/\s+$/, '')
      if (trimmed.trim() !== '') paragraphs.push(trimmed)
      continue
    }
    for (const part of segment.split(/\r?\n(?:[\t ]*\r?\n)+/)) {
      const trimmed = part.trim()
      if (trimmed !== '') paragraphs.push(trimmed)
    }
  }
  return paragraphs
}

/**
 * 去掉会干扰阅读/翻译的 Markdown 标记：粗体、斜体、删除线、标题井号、
 * 行首列表符号换成圆点。围栏代码块不处理。
 */
export function normalizeMarkdownLite(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let value = line
      value = value.replace(/^#{1,6}\s+/, '')
      value = value.replace(/^\s*>+\s?/, '')
      value = value.replace(/^(\s*)[-*+]\s+/, '$1• ')
      value = value.replace(/\*\*([^*]+)\*\*/g, '$1')
      value = value.replace(/__([^_]+)__/g, '$1')
      value = value.replace(/~~([^~]+)~~/g, '$1')
      return value
    })
    .join('\n')
    .trim()
}

/** 这段文本是否只由技术片段组成（没有自然语言要翻）。 */
export function isTechnicalOnly(text: string): boolean {
  return splitForTranslation(text).every((span) => !span.translate || span.text.trim() === '')
}

/**
 * 把文本渲染进容器：技术片段用 `<code>`，自然语言用文本节点。
 * @param doc - 目标文档（测试里传 jsdom 的 document）。
 */
export function renderSpansInto(doc: Document, container: HTMLElement, text: string): void {
  container.textContent = ''
  for (const span of splitForTranslation(text)) {
    appendSpan(doc, container, span)
  }
}

function appendSpan(doc: Document, container: HTMLElement, span: TextSpan): void {
  if (!span.translate && span.kind === 'code' && span.text.trimStart().startsWith('```')) {
    const pre = doc.createElement('pre')
    pre.className = 'cotx-bi-code'
    pre.textContent = span.text.replace(/^```\w*\s*/, '').replace(/```$/, '').trimEnd()
    container.appendChild(pre)
    return
  }
  if (!span.translate) {
    const code = doc.createElement('code')
    code.className = span.kind === 'url' ? 'cotx-bi-link' : 'cotx-bi-inline-code'
    code.textContent = span.text
    container.appendChild(code)
    return
  }
  // 自然语言按换行拆成文本节点 + <br>，保住段落内的折行。
  const lines = span.text.split('\n')
  lines.forEach((line, index) => {
    if (index > 0) container.appendChild(doc.createElement('br'))
    container.appendChild(doc.createTextNode(line))
  })
}
