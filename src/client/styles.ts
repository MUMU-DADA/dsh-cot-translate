/**
 * 卡片样式：运行时注入一个 <style>，随插件卸载移除。
 *
 * 只用 shell 已有的 CSS 变量（`--dsw-*`）取色，跟随明暗主题；
 * 类名统一 `cotx-` 前缀，另挂 `.cot-translation` 作为验收标记
 * （docs/ROADMAP.md M1）。样式不写进 DOM 内联属性，方便以后换成
 * 构建期 CSS 而不动组件。
 */

/** 验收与查询用标记类。 */
export const CARD_MARKER_CLASS = 'cot-translation'

const STYLE_ATTR = 'data-cot-translate-styles'

const CSS = `
.cotx-root {
  box-sizing: border-box;
  border: .5px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, .28));
  border-radius: var(--dsw-radius-lg, 10px);
  padding: 8px 12px;
  margin: 0;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 20px;
}
.cotx-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cotx-title {
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, inherit);
  flex: none;
}
.cotx-badge {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  flex: none;
}
.cotx-spacer { flex: 1 1 auto; }
.cotx-toggle {
  flex: none;
  font: inherit;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, inherit);
  background: none;
  border: 0;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--dsw-radius-sm, 6px);
}
.cotx-toggle:hover { color: var(--dsw-alias-label-primary, inherit); }
.cotx-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, currentColor);
  outline-offset: 2px;
}
.cotx-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.cotx-segment { min-width: 0; }
.cotx-source {
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cotx-placeholder {
  color: var(--dsw-alias-label-secondary, inherit);
  white-space: pre-wrap;
  word-break: break-word;
}
.cotx-note {
  margin-top: 6px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
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
