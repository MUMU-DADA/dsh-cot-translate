/**
 * 本插件用到的 **最小 cordis 客户端契约**（结构类型）。
 *
 * 为什么不直接 `import type { Context } from '@deepseek-ai/cordis'`：
 * 兼容基线 0.2.0-rc.2 的 cordis 是桌面端内置运行时，本仓库没有把它装成
 * 依赖（会与宿主版本打架）。这里只声明实际调用到的成员，运行时由宿主
 * 提供真实对象；形状来自 0.2.0-rc.2 的 ui-chat / ui-plan 实测，
 * 见 docs/RESEARCH.md §3。
 */

import type { AssistantStepData, ChatNode } from './chat'

/** 可订阅快照源：`ChatNodeStore` 的 `source()` / `turnDataSource()` 返回该形状。 */
export interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(onChange: () => void): () => void
}

/** 会话绑定对象本身对本插件不透明，只需原样透传给 uiConversation。 */
export interface SessionBinding {
  readonly sessionId?: string
}

/** `ctx.locale.bind(ns)` 返回的翻译函数。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** 槽位注册参数（只声明本插件使用的字段；keyed 槽位用 key，list 槽位用 id）。 */
export interface SlotRegisterOptions {
  name: string
  id?: string
  key?: string
  order?: number
  locale?: string
  /**
   * 会话作用域槽位的注入：宿主按 sessionId 调用一次，返回值合并进组件 props。
   * `hooks` 为可直接调用的快照钩子，`keyedHooks` 为「传入 key 才返回钩子」的工厂。
   */
  inject?: (sessionId: string) => Record<string, unknown>
}

/** 槽位服务：槽位声明晚于插件加载，注册动作要包在 inject 回调里。 */
export interface SlotsService {
  inject(name: string, activate: () => unknown): () => void
  register(options: SlotRegisterOptions, component: unknown): () => void
}

export interface LocaleService {
  /** `dictionaries` 形如 `{ zh: {...}, en: {...} }`。 */
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(namespace: string): Translate
}

export interface SessionsService {
  binding(sessionId: string): SessionBinding | undefined
}

/** Chat target 的快照：只声明读节点数据所需部分。 */
export interface ChatSnapshot {
  readonly nodes: {
    turnDataSource(turn: number, kind: string): SnapshotSource<readonly AssistantStepData[]>
    /** 按节点 key 取单个节点（含业务数据）；未加载时为 undefined。 */
    source(key: string): SnapshotSource<ChatNode | undefined>
  }
}

export interface ChatTarget {
  getSnapshot(): ChatSnapshot | undefined
}

export interface UiConversationService {
  binding(binding: SessionBinding): { target(name: string): ChatTarget }
}

/** 客户端插件入口收到的 cordis Context（子集）。 */
export interface ClientContext {
  /** 注册随插件卸载一起清理的副作用；回调返回 disposer。 */
  effect(callback: () => (() => void) | void, label?: string): unknown
  slots: SlotsService
  locale: LocaleService
  sessions: SessionsService
  uiConversation: UiConversationService
  /** 可选服务探测（本插件暂未使用，留作 M2 之后按需取用）。 */
  get?(name: string): unknown
}
