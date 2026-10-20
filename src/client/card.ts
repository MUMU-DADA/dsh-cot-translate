/**
 * M1/M3 回合卡片：「这一回合模型都想了什么」的中文译文。
 *
 * 背景：`conversation.chat.node` 是 **keyed** 槽位，键域由 shell 的
 * `ChatNodeKind` 表固定，`assistant-step` 已被官方渲染器占用 —— 重复注册
 * 等于**替换**整个 Assistant 渲染器（shadow shipped UI），无法“追加一行”。
 * 因此改用官方给产物扩展用的 `conversation.chat.turnTail`（list 槽位）：
 * 每个回合结束后的操作行之前一个条目，能通过 `ChatNodeStore.turnDataSource`
 * 读到包含隐藏节点的 reasoning 数据。依据见 docs/RESEARCH.md §3 与
 * docs/DECISIONS.md ADR-011。
 *
 * 组件只负责显示：取数在 client/index.ts 注入，翻译在 client/translate.ts。
 */

import { createElement, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { AssistantStepData } from './chat'
import { collectReasoning, reasoningCharCount, singleLinePreview } from './chat'
import type { Translate } from './cordis'
import { fallbackTranslate } from './locales'
import { CARD_MARKER_CLASS } from './styles'
import { sharedTranslator } from './translate'

/** 折叠时最多展示的推理段数。 */
const COLLAPSED_SEGMENTS = 2

/** 槽位 owner 传入的回合标识（`TurnLocation`，只用到 turn）。 */
export interface TurnLike {
  readonly turn: number | string
}

/** `conversation.chat.turnTail` 条目的 props。 */
export interface TurnTranslationCardProps {
  /** 本条目所属回合。 */
  turn: TurnLike
  /** 宿主的本地化函数（注册时声明了 locale 才有）。 */
  t?: Translate
  /** 由 keyedHooks 提供的钩子；宿主未注入时为 undefined。 */
  useCotSteps?: (turnKey: string) => readonly AssistantStepData[] | undefined
}

type CardBodyProps = TurnTranslationCardProps & {
  useCotSteps: (turnKey: string) => readonly AssistantStepData[] | undefined
}

/** 把宿主 `t` 包成始终可用的翻译函数。 */
function translator(t: Translate | undefined): Translate {
  return t ?? fallbackTranslate
}

/**
 * 回合译文卡片。没有 reasoning 内容时返回 null —— turnTail 是 list 槽位，
 * 返回 null 的条目不会占位（与 ui-plan 的 PlanCards 同款约定）。
 */
export function TurnTranslationCard(props: TurnTranslationCardProps): ReactElement | null {
  const { useCotSteps } = props
  // 钩子不能条件调用，因此把“有没有注入”的分支挡在这一层。
  if (typeof useCotSteps !== 'function') return null
  return createElement(CardBody, { ...props, useCotSteps })
}

function CardBody({ turn, t, useCotSteps }: CardBodyProps): ReactElement | null {
  const turnKey = String(turn.turn)
  const steps = useCotSteps(turnKey)
  const [expanded, setExpanded] = useState(false)
  const segments = collectReasoning(steps)
  if (segments.length === 0) return null

  const tr = translator(t)
  const chars = reasoningCharCount(segments)
  const visible = expanded ? segments : segments.slice(0, COLLAPSED_SEGMENTS)
  const collapsible = segments.length > COLLAPSED_SEGMENTS

  return createElement(
    'div',
    {
      className: `cotx-root ${CARD_MARKER_CLASS}`,
      'data-cot-translation': '1',
      'data-cot-turn': turnKey,
    },
    createElement(
      'div',
      { className: 'cotx-head' },
      createElement('span', { className: 'cotx-title' }, tr('card.title')),
      createElement(
        'span',
        { className: 'cotx-badge' },
        tr('card.badge', { segments: segments.length, chars }),
      ),
      createElement('span', { className: 'cotx-spacer' }),
      collapsible || expanded
        ? createElement(
            'button',
            {
              type: 'button',
              className: 'cotx-toggle',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: () => {
                setExpanded((value) => !value)
              },
            },
            expanded
              ? tr('card.collapse')
              : tr('card.expand', { count: segments.length }),
          )
        : null,
    ),
    createElement(
      'div',
      { className: 'cotx-body' },
      visible.map((segment, index) =>
        createElement(TranslatedSegment, {
          key: `${turnKey}:${index}`,
          text: segment.text,
          t: tr,
        }),
      ),
    ),
    createElement('div', { className: 'cotx-note' }, tr('card.note')),
  )
}

/** 单段思考：原文起手 + 译文（或翻译中 / 失败提示）。 */
function TranslatedSegment({ text, t }: { text: string; t: Translate }): ReactElement {
  const [state, setState] = useState<{ phase: 'loading' | 'done' | 'failed'; text: string }>({
    phase: 'loading',
    text: '',
  })

  useEffect(() => {
    let alive = true
    sharedTranslator()
      .translate(text)
      .then((outcome) => {
        if (!alive) return
        setState(
          outcome.ok ? { phase: 'done', text: outcome.text } : { phase: 'failed', text: '' },
        )
      })
      .catch(() => {
        if (alive) setState({ phase: 'failed', text: '' })
      })
    return () => {
      alive = false
    }
  }, [text])

  const body =
    state.phase === 'done'
      ? state.text
      : t(state.phase === 'loading' ? 'card.loading' : 'card.failed')

  return createElement(
    'div',
    { className: 'cotx-segment' },
    createElement(
      'div',
      { className: 'cotx-source', title: text },
      `${t('card.original')} · ${singleLinePreview(text, 60)}`,
    ),
    createElement(
      'div',
      { className: 'cotx-translation', 'data-cot-phase': state.phase },
      body,
    ),
  )
}
