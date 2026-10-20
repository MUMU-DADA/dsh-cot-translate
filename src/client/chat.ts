/**
 * Chat 侧的业务数据类型与纯函数。
 *
 * 数据来源：`ChatNodeStore.turnDataSource(turn, "assistant-step")`，快照是
 * 该回合所有 assistant-step 节点的 **业务数据**（`node.data`，含隐藏节点），
 * 按 anchor 顺序排列。依据：DSH 0.2.0-rc.2 实测，见 docs/RESEARCH.md §3。
 *
 * 这里只做“取 reasoning 文本”这一件事，不碰 React，便于单测。
 */

/** Assistant 内容块种类（`toAssistantBlock` 的分类结果）。 */
export type ChatBlockKind = 'reasoning' | 'text' | 'tool-call' | 'image' | 'other'

export interface ChatBlock {
  readonly kind: ChatBlockKind
  /** 仅 reasoning / text 有正文。 */
  readonly text?: string
}

/** 一个 assistant-step 节点的业务数据（只声明本插件用到的字段）。 */
export interface AssistantStepData {
  /** 同一回合内的第几次 assistant 尝试，从 0 起。 */
  readonly step?: number
  /** running / complete / interrupted … */
  readonly status?: string
  readonly blocks?: readonly ChatBlock[]
}

/** 从节点数据里取出的连续一段推理文本。 */
export interface ReasoningSegment {
  readonly text: string
  readonly step?: number
}

/** ChatNodeStore 里的一个节点（只声明本插件用到的部分）。 */
export interface ChatNode {
  readonly key: string
  readonly data: AssistantStepData
}

/**
 * 按节点顺序、块顺序收集 reasoning 文本。
 *
 * 跳过空块（流式期间会产生 `text: ""` 的空 reasoning 块），保留段落原样，
 * 不合并也不改写 —— 显示层不对原文做任何加工。
 */
export function collectReasoning(
  steps: readonly AssistantStepData[] | undefined,
): ReasoningSegment[] {
  const segments: ReasoningSegment[] = []
  for (const step of steps ?? []) {
    for (const block of step.blocks ?? []) {
      if (block.kind !== 'reasoning') continue
      const text = block.text?.trim() ?? ''
      if (text === '') continue
      segments.push({ text, step: step.step })
    }
  }
  return segments
}

/** 各段文本的总字符数（用于卡片摘要与“没有推理内容”判定）。 */
export function reasoningCharCount(segments: readonly ReasoningSegment[]): number {
  let total = 0
  for (const segment of segments) total += segment.text.length
  return total
}

/**
 * 取一段文本的单行预览：折叠换行、限长，供卡片头部展示原文起手。
 * 只用于显示，不送入翻译。
 */
export function singleLinePreview(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}
