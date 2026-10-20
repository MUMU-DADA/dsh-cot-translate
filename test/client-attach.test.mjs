/**
 * 双语对照面板 + DOM 注入的测试（jsdom）。
 *
 * 覆盖：
 * - 展开的思考块里注入面板、隐藏 shell 原文渲染；
 * - 逐段成行、左右两栏、翻译回填；
 * - 折叠后清理干净（面板移除、标记移除）；
 * - 数据层原文优先（围栏代码不被送出翻译）；
 * - 纯技术段落 → 右栏“技术内容，不翻译”；
 * - 段落切分（围栏代码不被空行切开）与轻量去 Markdown。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test, { after } from 'node:test'
import { JSDOM } from 'jsdom'

const REQUIRE = createRequire(import.meta.url)
const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 在 jsdom 窗口里执行 bundle（拿到 __ModuleLoader__ 的 factory）。 */
function loadClient() {
  let captured
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  dom.window.__ModuleLoader__ = {
    load(options) {
      captured = options
    },
  }
  dom.window.eval(SOURCE)
  assert.ok(captured !== undefined, 'bundle 没调用 __ModuleLoader__.load')
  // jsdom 的 AbortSignal 未必实现静态 timeout；测试里给个等价物。
  if (typeof dom.window.AbortSignal.timeout !== 'function') {
    Object.defineProperty(dom.window.AbortSignal, 'timeout', {
      value: () => new dom.window.AbortController().signal,
      configurable: true,
    })
  }
  return { dom, module: captured.factory(REQUIRE) }
}

const { dom, module: client } = loadClient()
const { window } = dom
const document = window.document

// jsdom 的动画时钟会拖住进程退出，跑完就关掉。
after(() => {
  window.close()
})

/** 等异步回填跑完。 */
const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** 假翻译器：纯技术段落返回 none，其余加「译:」前缀。 */
function fakeTranslator() {
  const calls = []
  return {
    calls,
    async translateMany(texts) {
      calls.push([...texts])
      return texts.map((text) =>
        client.isTechnicalOnly(text)
          ? { ok: true, text, provider: 'none' }
          : { ok: true, text: `译:${text}`, provider: 'ollama' },
      )
    },
  }
}

/** 真翻译器 + 假 fetch：记录真正被送出去的 segments。 */
function recordingTranslator() {
  const segments = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    segments.push(...body.segments)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        translations: body.segments.map((segment) => `译:${segment.trim()}`),
        provider: 'ollama',
      }),
    }
  }
  return { segments, translator: new client.TextTranslator({ fetchImpl }) }
}

/** 造一个展开态思考块的 DOM（结构照抄 shell 的 data 属性）。 */
function chatFixture({ text, nodeKey = 'node-1', sessionId = 'session-1', running = false }) {
  document.body.innerHTML = `
    <div data-conversation-session="${sessionId}">
      <div data-chat-node-key="${nodeKey}" data-chat-group-part="reasoning">
        <div data-variant="think" data-expanded="true" data-state="${running ? 'running' : 'ok'}">
          <div class="lcKema_row">Think</div>
          <div class="lcKema_thinkBody">
            <div class="md_root" data-md="1">${text}</div>
          </div>
        </div>
      </div>
    </div>
  `
  return {
    row: document.querySelector('[data-variant="think"]'),
    body: document.querySelector('[class*="_thinkBody"]'),
    markdown: document.querySelector('[data-md="1"]'),
  }
}

test('展开的思考块注入双语面板并回填译文', async (context) => {
  const fixture = chatFixture({ text: 'First paragraph.\n\nSecond paragraph.' })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: () => undefined,
    throttleMs: 0,
  })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()

  const panel = fixture.body.querySelector('[data-cot-panel]')
  assert.ok(panel !== null, '面板应插入 thinkBody')
  assert.equal(fixture.body.getAttribute('data-cot-bilingual'), '1', '应打上隐藏原文的标记')

  const rows = fixture.body.querySelectorAll('[data-cot-pair]')
  assert.equal(rows.length, 2, '两个段落 → 两行')

  const first = rows[0]
  const src = first.querySelector('.cotx-bi-src')
  const dst = first.querySelector('.cotx-bi-dst')
  assert.ok(src.textContent.includes('First paragraph.'), '左栏是原文')
  assert.equal(dst.textContent, '译:First paragraph.', '右栏是译文')
  assert.equal(dst.getAttribute('data-cot-state'), 'done')

  // 每行左右两栏在同一个行容器里 —— CSS 的 .cotx-bi-row:hover 才能同时高亮两边。
  assert.equal(first.querySelectorAll('.cotx-bi-cell').length, 2)
  assert.equal(
    fixture.body.querySelectorAll('.cotx-bi-head .cotx-bi-head-cell').length,
    2,
    '表头应是「原文 / 译文」两列',
  )
})

test('折叠后清理：面板与标记都移除', async (context) => {
  const fixture = chatFixture({ text: 'Only paragraph.' })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({ document, translator, lookup: () => undefined, throttleMs: 0 })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()
  assert.ok(fixture.body.querySelector('[data-cot-panel]') !== null)

  fixture.row.removeAttribute('data-expanded')
  handle.scan()

  assert.equal(fixture.body.querySelector('[data-cot-panel]'), null, '面板应被移除')
  assert.equal(fixture.body.getAttribute('data-cot-bilingual'), null, '隐藏标记应被移除')
})

test('数据层原文优先：围栏代码不被送出翻译', async (context) => {
  const fixture = chatFixture({ text: '(dom fallback text)' })
  const { segments, translator } = recordingTranslator()
  const dataText = 'Let me check the command.\n\n```bash\nnpm test\n```'
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: (sessionId, nodeKey, rowIndex) => {
      assert.equal(sessionId, 'session-1')
      assert.equal(nodeKey, 'node-1')
      assert.equal(rowIndex, 0)
      return dataText
    },
    throttleMs: 0,
  })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()

  const rows = fixture.body.querySelectorAll('[data-cot-pair]')
  assert.equal(rows.length, 2, '「自然语言段落 + 围栏代码」→ 两行')

  // 左栏：代码块用 <pre> 原样渲染。
  const code = rows[1].querySelector('pre.cotx-bi-code')
  assert.ok(code !== null, '围栏代码应渲染为 pre')
  assert.match(code.textContent, /npm test/)

  // 真正送出去的 segments 里不能有代码。
  assert.ok(segments.length >= 1, '自然语言段落应送出')
  assert.ok(segments.some((text) => text.includes('Let me check the command.')))
  assert.ok(!segments.some((text) => text.includes('npm test')), '代码不能进翻译请求')

  // 纯代码段落的右栏是“技术内容，不翻译”。
  const technical = rows[1].querySelector('.cotx-bi-dst')
  assert.equal(technical.getAttribute('data-cot-state'), 'technical')
  assert.match(technical.textContent, /不翻译/)
})

test('逐段显示：第一段回来就先显示，不等其它段', async (context) => {
  chatFixture({ text: 'First para.\n\nSecond para.' })
  const resolvers = []
  const translator = {
    calls: [],
    translateMany(texts) {
      this.calls.push([...texts])
      return new Promise((resolve) => {
        resolvers.push({ texts, resolve })
      })
    },
  }
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: () => undefined,
    throttleMs: 0,
  })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()

  assert.equal(resolvers.length, 2, '两段应各自成为一个独立请求（并发 2）')
  const rows = () => Array.from(document.querySelectorAll('[data-cot-pair]'))

  // 只完成第一段：第一行立刻出译文，第二行仍在“翻译中”。
  resolvers[0].resolve([{ ok: true, text: '译:First para.', provider: 'llamacpp' }])
  await flush()
  assert.equal(rows()[0].querySelector('.cotx-bi-dst').textContent, '译:First para.')
  assert.equal(
    rows()[1].querySelector('.cotx-bi-dst').getAttribute('data-cot-state'),
    'loading',
    '第二段还没回来时不能显示译文',
  )

  // 第二段回来后再补上。
  resolvers[1].resolve([{ ok: true, text: '译:Second para.', provider: 'llamacpp' }])
  await flush()
  assert.equal(rows()[1].querySelector('.cotx-bi-dst').textContent, '译:Second para.')
})

test('流式追加：只为新增段落发请求', async (context) => {
  chatFixture({ text: 'One.' })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({ document, translator, lookup: () => undefined, throttleMs: 0 })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()
  const firstCalls = translator.calls.length

  const markdown = document.querySelector('[data-md="1"]')
  markdown.textContent = 'One.\n\nTwo.'
  handle.scan()
  await flush()

  const rows = document.querySelectorAll('[data-cot-pair]')
  assert.equal(rows.length, 2)
  const newCalls = translator.calls.slice(firstCalls).flat()
  assert.deepEqual(newCalls, ['Two.'], '只应翻译新增的那段')
})

test('流式进行中：最后一段稳定之后才送翻', async (context) => {
  const fixture = chatFixture({ text: 'Stable paragraph.\n\nGrowing tail', running: true })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: () => undefined,
    throttleMs: 0,
    tailSettleMs: 30,
  })
  context.after(() => handle.dispose())
  const rows = () => Array.from(document.querySelectorAll('[data-cot-pair]'))
  const micro = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  // 第一次扫描：第一段已稳定 → 立刻送翻；最后一段还在增长 → 压住。
  handle.scan()
  await micro()
  assert.deepEqual(translator.calls.flat(), ['Stable paragraph.'])
  assert.equal(rows()[1].querySelector('.cotx-bi-dst').getAttribute('data-cot-state'), 'loading')

  // 稳定窗口过去后补翻。
  await sleep(60)
  await micro()
  assert.deepEqual(translator.calls.flat(), ['Stable paragraph.', 'Growing tail'])

  // 又长了一截 → 先不送翻。
  document.querySelector('[data-md="1"]').textContent = 'Stable paragraph.\n\nGrowing tail and more'
  handle.scan()
  await micro()
  assert.deepEqual(translator.calls.flat(), ['Stable paragraph.', 'Growing tail'], '增长中不应立刻送翻')
  await sleep(60)
  await micro()
  assert.deepEqual(translator.calls.flat(), [
    'Stable paragraph.',
    'Growing tail',
    'Growing tail and more',
  ])

  // 流式结束：新尾巴立刻送翻，不需要等窗口。
  document.querySelector('[data-md="1"]').textContent =
    'Stable paragraph.\n\nGrowing tail and more\n\nFinal paragraph.'
  fixture.row.setAttribute('data-state', 'ok')
  handle.scan()
  await micro()
  assert.deepEqual(translator.calls.flat().slice(-1), ['Final paragraph.'])
})

test('文案：表头与提示使用中文字典', async (context) => {
  const fixture = chatFixture({ text: 'Hello world.' })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({ document, translator, lookup: () => undefined, throttleMs: 0 })
  context.after(() => handle.dispose())
  handle.scan()
  await flush()

  const heads = Array.from(fixture.body.querySelectorAll('.cotx-bi-head-cell')).map(
    (cell) => cell.textContent,
  )
  assert.deepEqual(heads, ['原文', '译文'])
  assert.match(fixture.body.querySelector('.cotx-bi-note').textContent, /只翻自然语言/)
})

test('段落切分：围栏代码内部的空行不切开', () => {
  const text = 'Before.\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\nAfter.'
  const paragraphs = client.paragraphsOf(text)
  assert.equal(paragraphs.length, 3)
  assert.match(paragraphs[1], /const a = 1[\s\S]*const b = 2/)
})

test('轻量去 Markdown：去掉粗体/标题/列表符号', () => {
  assert.equal(client.normalizeMarkdownLite('## Heading'), 'Heading')
  assert.equal(client.normalizeMarkdownLite('- **bold** item'), '• bold item')
  assert.equal(client.normalizeMarkdownLite('plain ~~gone~~ text'), 'plain gone text')
})

test('自动模式：折叠的思考块也提前翻译（展开即有译文）', async (context) => {
  client.setPrefs({ mode: 'auto', enabled: true })
  document.body.innerHTML = `
    <div data-conversation-session="session-auto">
      <div data-chat-node-key="node-auto">
        <div data-variant="think" data-state="ok">
          <div class="lcKema_row">Think</div>
        </div>
      </div>
    </div>
  `
  const calls = []
  const translator = {
    calls,
    async translateMany(texts) {
      calls.push([...texts])
      return texts.map((text) => ({ ok: true, text: `译:${text}`, provider: 'ollama' }))
    },
  }
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: () => 'First para.\n\nSecond para.',
    throttleMs: 0,
  })
  context.after(() => {
    handle.dispose()
    client.setPrefs({ mode: 'semi' })
  })
  handle.scan()
  await flush()

  assert.equal(calls.length > 0, true, '自动模式应提前翻译')
  assert.deepEqual(calls[0], ['First para.', 'Second para.'], '按面板同样的段落切分预热缓存')
  assert.equal(document.querySelector('[data-cot-panel]'), null, '折叠态不注入面板')
})

test('关闭翻译：不注入面板，也不发请求', async (context) => {
  client.setPrefs({ enabled: false })
  const fixture = chatFixture({ text: 'Only paragraph.' })
  const translator = fakeTranslator()
  const handle = client.attachBilingual({
    document,
    translator,
    lookup: () => undefined,
    throttleMs: 0,
  })
  context.after(() => {
    handle.dispose()
    client.setPrefs({ enabled: true })
  })
  handle.scan()
  await flush()

  assert.equal(fixture.body.querySelector('[data-cot-panel]'), null, '关闭时不应注入面板')
  assert.equal(fixture.body.getAttribute('data-cot-bilingual'), null, '关闭时不应打标记')
  assert.equal(translator.calls.length, 0, '关闭时不应发翻译请求')
})
test('apply：注册设置页（settings.section）并保持双语注入', async () => {
  const registered = []
  const injectedNames = []
  const addedLanguages = []
  const ctx = {
    effect(callback) {
      callback()
      return () => {}
    },
    slots: {
      inject(name, activate) {
        injectedNames.push(name)
        activate()
        return () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
      addLanguage(language) {
        addedLanguages.push(language.id)
        return () => {}
      },
    },
    sessions: { binding: () => undefined },
    uiConversation: { binding: () => ({ target: () => ({ getSnapshot: () => undefined }) }) },
    get() {
      return undefined
    },
  }
  client.apply(ctx)

  assert.ok(injectedNames.includes('settings.section'), '设置页应注入到 settings.section')
  const section = registered.find((item) => item.options.name === 'settings.section')
  assert.ok(section !== undefined, '应注册 settings.section')
  assert.equal(section.options.id, 'cot-translate')
  assert.equal(typeof section.component, 'function', '设置页应是 React 组件')
  assert.ok(addedLanguages.includes('ja'), '应注册额外 UI 语言 ja')
  assert.ok(addedLanguages.includes('zh-Hant'), '应注册繁体中文')
  assert.ok(!addedLanguages.includes('zh'), 'zh/en 是 shell 自带的，不重复注册')
  // 其它槽位不应被误注册
  assert.deepEqual(
    registered.map((item) => item.options.name),
    ['settings.section'],
  )
})
test('目标语言默认跟随客户端语言（检测映射）', () => {
  assert.equal(client.detectTargetLanguage(['zh-CN']), 'zh-Hans')
  assert.equal(client.detectTargetLanguage(['zh-Hans']), 'zh-Hans')
  assert.equal(client.detectTargetLanguage(['zh-TW']), 'zh-Hant')
  assert.equal(client.detectTargetLanguage(['zh-HK']), 'zh-Hant')
  assert.equal(client.detectTargetLanguage(['en-US']), 'en')
  assert.equal(client.detectTargetLanguage(['ja-JP']), 'ja')
  assert.equal(client.detectTargetLanguage(['fr-FR']), 'fr')
  assert.equal(client.detectTargetLanguage(['de']), 'de')
  assert.equal(client.detectTargetLanguage(['pt-BR']), 'pt')
  // <html lang> 作为第二候选；都不认识回退英文
  assert.equal(client.detectTargetLanguage([undefined, 'ja']), 'ja')
  assert.equal(client.detectTargetLanguage(['sv-SE']), 'en')
  assert.equal(client.detectTargetLanguage([]), 'en')
})
test('首次运行：目标语言按客户端语言写入一次，之后不再覆盖', async () => {
  const posted = []
  const state = {
    settings: {
      enabled: true,
      mode: 'semi',
      modelId: 'hy-mt2-1.8b-q4',
      useSessionModel: false,
      target: '',
    },
  }
  const originalFetch = window.fetch
  window.fetch = async (url, init) => {
    if (String(url).endsWith('/_cotx/settings')) {
      const body = JSON.parse(init.body)
      posted.push(body)
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...state, settings: { ...state.settings, ...body } }),
      }
    }
    return { ok: true, status: 200, json: async () => state }
  }
  const previousLang = document.documentElement.lang
  document.documentElement.lang = 'ja'
  try {
    await client.ensureTargetLanguage()
    assert.deepEqual(posted, [{ target: 'ja' }], '应按 <html lang> 写入目标语言')
    assert.equal(client.prefs().target, 'ja')

    // 已经初始化过：第二次只读不写
    posted.length = 0
    state.settings.target = 'ja'
    await client.ensureTargetLanguage()
    assert.equal(posted.length, 0, '有显式目标语言后不应再覆盖')
  } finally {
    window.fetch = originalFetch
    document.documentElement.lang = previousLang
    client.setPrefs({ target: '' })
  }
})