/**
 * 双语面板样式：运行时注入一个 <style>，随插件卸载移除。
 *
 * 版式：每行两列（左原文 / 右译文），行悬停时整行高亮 —— 高亮由 CSS 的
 * `.cotx-bi-row:hover` 完成，左右两栏天然同时亮，不需要 JS 联动。
 * 窄容器下退化为上下堆叠。
 *
 * 只用 shell 已有的 `--dsw-*` 变量取色，跟随明暗主题。
 */

const STYLE_ATTR = 'data-cot-translate-styles'

const CSS = `
/* 面板就位后隐藏 shell 原来的纯文本渲染，避免同一段思考显示两遍。 */
[data-cot-bilingual] > :not([data-cot-panel]) {
  display: none !important;
}

.cotx-bi {
  container-type: inline-size;
  display: block;
  margin: 2px 0 4px;
}

.cotx-bi-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 16px;
  padding: 0 8px 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: .04em;
}

.cotx-bi-rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cotx-bi-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 16px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  transition: background-color .12s ease;
}

/* 悬停/键盘聚焦：整行（左右两栏）一起高亮，这就是“两边对照”。 */
.cotx-bi-row:hover,
.cotx-bi-row:focus-within {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, .1));
}

.cotx-bi-cell {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-word;
}

.cotx-bi-src {
  color: var(--dsw-alias-label-secondary, inherit);
}

.cotx-bi-dst {
  color: var(--dsw-alias-label-primary, inherit);
}

.cotx-bi-dst[data-cot-state='loading'],
.cotx-bi-dst[data-cot-state='failed'],
.cotx-bi-dst[data-cot-state='technical'] {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 12px;
}

.cotx-bi-inline-code,
.cotx-bi-link {
  font-family: var(--dsw-font-markdown-code-block-small, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  padding: 0 3px;
  border-radius: 4px;
  background: var(--dsw-alias-markdown-code-block, rgba(127, 127, 127, .12));
  word-break: break-all;
}

.cotx-bi-link {
  color: var(--dsw-alias-state-business-primary, inherit);
  background: none;
  padding: 0;
}

.cotx-bi-code {
  margin: 2px 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-markdown-code-block, rgba(127, 127, 127, .12));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow-x: auto;
}

.cotx-bi-note {
  padding: 4px 8px 0;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  line-height: 16px;
}

@container (max-width: 520px) {
  .cotx-bi-head {
    display: none;
  }
  .cotx-bi-row {
    grid-template-columns: minmax(0, 1fr);
    row-gap: 4px;
  }
  .cotx-bi-src {
    font-size: 12px;
    color: var(--dsw-alias-label-tertiary, inherit);
  }
}
`

/**
 * 注入样式表；重复调用不会重复插入。
 * @returns 移除本次注入的 disposer（已有样式表时为空操作）。
 */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ATTR, '1')
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
