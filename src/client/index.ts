/**
 * Client 半：把「回合内的思考译文」挂到 Chat 的 turnTail 槽位上。
 *
 * 为什么不是 `conversation.chat.node`：该槽位是 keyed，键域被 shell 的
 * `ChatNodeKind` 固定；注册 `assistant-step` 等于**替换**官方 Assistant
 * 渲染器（shadow shipped UI），做不到“在 Think 行下面追加一行”。
 * 详见 docs/DECISIONS.md ADR-011 与 docs/RESEARCH.md §3。
 *
 * 当前进度（M1）：数据链路已打通 —— 通过 `ChatNodeStore.turnDataSource`
 * 读到含隐藏节点的 assistant-step 数据，抽出 reasoning 文本并渲染占位卡片。
 * M2 起把占位文案换成 host 半返回的真实译文（POST /_cotx/translate）。
 *
 * 兼容基线：DSH 0.2.0-rc.2 + cordis 4.0.4。
 */

import type { AssistantStepData } from './chat'
import { TurnTranslationCard } from './card'
import type { ClientContext, SnapshotSource } from './cordis'
import { LOCALES } from './locales'
import { installStyles } from './styles'
/** 包名，同时作为槽位条目 id 与 locale 命名空间。 */
export const name = 'dsh-cot-translate'

/** 需要宿主提供的客户端服务（cordis 服务名，不是包名）。 */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']

/** 本插件占用的槽位：回合尾部条目（list，session 作用域）。 */
const TURN_TAIL_SLOT = 'conversation.chat.turnTail'

/** reasoning 挂在 assistant-step 节点上，其业务数据即 AssistantStepData。 */
const ASSISTANT_STEP_KIND = 'assistant-step'

/** 空数据源：拿不到 Chat target 时让卡片自行返回 null，不抛错打断整行渲染。 */
const EMPTY_SOURCE: SnapshotSource<readonly AssistantStepData[]> = {
  getSnapshot: () => [],
  subscribe: () => () => {},
}

/**
 * 取某个回合的 assistant-step 数据源。
 *
 * `ChatNodeStore.turnDataSource(turn, kind)` 返回可订阅源，快照是该回合中
 * 该 kind 的节点业务数据数组（含隐藏节点，按 anchor 顺序）。keyedHooks 会把
 * 它包成 `useCotSteps(turnKey)` 注入组件。
 */
function reasoningSource(
  ctx: ClientContext,
  sessionId: string,
  turnKey: string,
): SnapshotSource<readonly AssistantStepData[]> {
  try {
    const turn = Number(turnKey)
    if (!Number.isFinite(turn)) return EMPTY_SOURCE
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return EMPTY_SOURCE
    const snapshot = ctx.uiConversation.binding(binding).target('chat').getSnapshot()
    if (snapshot === undefined) return EMPTY_SOURCE
    return snapshot.nodes.turnDataSource(turn, ASSISTANT_STEP_KIND)
  } catch {
    // 会话切换 / 目标未就绪时的瞬时状态：静默降级为“没有译文”，不影响 Chat。
    return EMPTY_SOURCE
  }
}

/**
 * Cordis 客户端插件入口。
 * @param ctx - 客户端根上下文（宿主在 inject 的服务就绪后调用）。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(name, LOCALES), `${name}: dictionaries`)
  ctx.effect(installStyles, `${name}: styles`)
  ctx.effect(
    () =>
      ctx.slots.inject(TURN_TAIL_SLOT, () =>
        ctx.slots.register(
          {
            name: TURN_TAIL_SLOT,
            id: name,
            order: 40,
            locale: name,
            inject: (sessionId) => ({
              keyedHooks: {
                cotSteps: (turnKey: string) => reasoningSource(ctx, sessionId, turnKey),
              },
            }),
          },
          TurnTranslationCard,
        ),
      ),
    `${name}: turn-tail card`,
  )
}

// ── 供测试直接引用的纯逻辑（对宿主 Loader 无副作用）─────────────────────
export { collectReasoning, reasoningCharCount, singleLinePreview } from './chat'
export {
  MAX_CHUNK_CHARS,
  MAX_CHARS_PER_REQUEST,
  MAX_CHUNKS_PER_REQUEST,
  batchChunks,
  keepRanges,
  sentenceChunks,
  splitForTranslation,
} from './strip'
export { TRANSLATE_ENDPOINT, TextTranslator, sharedTranslator } from './translate'
