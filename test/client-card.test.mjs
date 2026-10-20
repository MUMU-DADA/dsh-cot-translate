/**
 * M1 冒烟测试：直接加载构建产物 `lib/client.js`，在假 DOM / 假 cordis 上跑一遍。
 *
 * 为什么测产物而不是源码：client bundle 的对外契约（`__ModuleLoader__.load`
 * 包装、`apply` / `inject` / `name` 导出、槽位注册参数）就是产物本身，源码
 * 测试覆盖不到包装层。先 `npm run build`（`pretest` 会自动跑）。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const REQUIRE = createRequire(import.meta.url)
const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 假装是浏览器的 <style> 宿主，记录注入的样式表。 */
function fakeDocument() {
  const styles = []
  return {
    styles,
    document: {
      head: {
        appendChild(tag) {
          styles.push(tag)
        },
      },
      querySelector: () => null,
      createElement: () => ({
        textContent: '',
        setAttribute() {},
        remove() {},
      }),
    },
  }
}

/** 在假 DOM 里执行 bundle，返回它对外的模块导出。 */
function loadBundle() {
  let captured
  const fake = fakeDocument()
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          captured = options
        },
      },
    },
    document: fake.document,
    console,
  }
  vm.runInContext(SOURCE, vm.createContext(sandbox))
  assert.ok(captured !== undefined, 'bundle 没有调用 window.__ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-cot-translate', 'bundle id 必须等于包名')
  return { module: captured.factory(REQUIRE), styles: fake.styles }
}

/** 一段带 reasoning 与正文的 assistant-step 业务数据。 */
const STEPS = [
  {
    step: 0,
    status: 'complete',
    blocks: [
      { kind: 'reasoning', text: 'We need to inspect the repository layout before editing.' },
      { kind: 'text', text: 'Done.' },
    ],
  },
  {
    step: 1,
    blocks: [{ kind: 'reasoning', text: 'Then wire the slot registration.' }],
  },
]

/** 记录调用顺序的假 ctx，并暴露槽位注册参数与组件。 */
function fakeContext(snapshot) {
  const events = []
  const recorded = {}
  const ctx = {
    effect(callback, label) {
      events.push(['effect', label])
      const disposer = callback()
      recorded.disposers = [...(recorded.disposers ?? []), disposer]
      return () => {}
    },
    slots: {
      inject(name, activate) {
        events.push(['slots.inject', name])
        recorded.injectedSlot = name
        return activate()
      },
      register(options, component) {
        events.push(['slots.register', options.name])
        recorded.options = options
        recorded.component = component
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        events.push(['locale.register', namespace])
        recorded.localeNamespace = namespace
        recorded.locales = dictionaries
        return () => {}
      },
      bind: () => (key) => key,
    },
    sessions: {
      binding(sessionId) {
        recorded.sessionId = sessionId
        return { sessionId }
      },
    },
    uiConversation: {
      binding() {
        return {
          target(name) {
            recorded.target = name
            return { getSnapshot: () => snapshot }
          },
        }
      },
    },
  }
  return { ctx, events, recorded }
}

test('bundle 导出 apply / inject / name', () => {
  const { module } = loadBundle()
  assert.equal(module.name, 'dsh-cot-translate')
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(
    [...module.inject].sort(),
    ['locale', 'sessions', 'slots', 'uiConversation'],
  )
})

test('apply 注册字典、样式与 turnTail 条目', () => {
  const { module } = loadBundle()
  const { ctx, events, recorded } = fakeContext({ nodes: { turnDataSource: () => ({ getSnapshot: () => [], subscribe: () => () => {} }) } })
  module.apply(ctx)

  assert.equal(recorded.localeNamespace, 'dsh-cot-translate')
  assert.ok(Object.keys(recorded.locales).includes('zh'), '应有中文字典')
  assert.ok(Object.keys(recorded.locales).includes('en'), '应有英文字典')
  assert.equal(recorded.injectedSlot, 'conversation.chat.turnTail')
  assert.equal(recorded.options.name, 'conversation.chat.turnTail')
  assert.equal(recorded.options.id, 'dsh-cot-translate')
  assert.equal(recorded.options.locale, 'dsh-cot-translate')
  assert.ok(events.some(([kind]) => kind === 'effect'), '副作用应通过 ctx.effect 注册')
})

test('注入的 cotSteps 钩子按 turn/kind 取数据源', () => {
  let asked
  const source = {
    getSnapshot: () => STEPS,
    subscribe: () => () => {},
  }
  const snapshot = {
    nodes: {
      turnDataSource(turn, kind) {
        asked = { turn, kind }
        return source
      },
    },
  }
  const { module } = loadBundle()
  const { ctx, recorded } = fakeContext(snapshot)
  module.apply(ctx)

  const injected = recorded.options.inject('session-1')
  assert.equal(typeof injected.keyedHooks.cotSteps, 'function')

  // 数据源在钩子被调用时才解析（会话/回合随渲染变化），不是注册时。
  assert.equal(injected.keyedHooks.cotSteps('7'), source)
  assert.equal(recorded.target, 'chat')
  assert.equal(recorded.sessionId, 'session-1')
  assert.deepEqual(asked, { turn: 7, kind: 'assistant-step' })
})

test('卡片渲染 reasoning 占位译文，且没有 reasoning 时不占位', () => {
  const { module } = loadBundle()
  const stepsSource = { getSnapshot: () => STEPS, subscribe: () => () => {} }
  const emptySource = { getSnapshot: () => [], subscribe: () => () => {} }
  const snapshot = { nodes: { turnDataSource: () => stepsSource } }
  const { ctx, recorded } = fakeContext(snapshot)
  module.apply(ctx)
  const Component = recorded.component

  const html = renderToStaticMarkup(
    createElement(Component, {
      turn: { turn: 7 },
      useCotSteps: () => stepsSource.getSnapshot(),
    }),
  )
  assert.match(html, /class="cotx-root cot-translation"/)
  assert.match(html, /data-cot-translation="1"/)
  assert.match(html, /思维链译文/, '应显示卡片标题')
  assert.match(html, /2 段 · 88 字/, '应统计 reasoning 段数与字数')
  assert.match(html, /inspect the repository layout/, '应带原文起手便于核对')

  const empty = renderToStaticMarkup(
    createElement(Component, {
      turn: { turn: 8 },
      useCotSteps: () => emptySource.getSnapshot(),
    }),
  )
  assert.equal(empty, '', '没有 reasoning 时返回 null')

  const noHook = renderToStaticMarkup(createElement(Component, { turn: { turn: 9 } }))
  assert.equal(noHook, '', '宿主未注入钩子时返回 null')
})
