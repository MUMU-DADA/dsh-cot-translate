/**
 * Host 半（M2）冒烟测试：直接加载构建产物 `lib/index.js`，用假 fetch / 假 HTTP
 * 对象跑 provider 链、缓存、校验与路由。
 *
 * 产物是自包含 ESM（不 import 任何 @deepseek-ai/*），所以能在 node 里直接跑。
 * `pretest` 会先 build。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

const host = await import('../lib/index.js')

/** 假 Response：只实现用到的方法。 */
function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

/** 假 fetch：按 url 分派，记录调用。 */
function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/** 假 request：POST body 以 Buffer 流形式迭代。 */
function fakeRequest(method, body = '') {
  return {
    method,
    url: '/_cotx/translate',
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body, 'utf8')
    },
    resume() {},
  }
}

/** 假 response：记录状态码 / 头 / body。 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

const OLLAMA_OK = { message: { content: '  中文译文  ' } }

test('normalizeConfig 兜底、夹取与去重', () => {
  const defaults = host.normalizeConfig(undefined)
  assert.equal(defaults.target, 'zh-Hans')
  assert.deepEqual(defaults.chain, ['ollama', 'google'])
  assert.equal(defaults.ollama.baseURL, 'http://127.0.0.1:11434')

  const custom = host.normalizeConfig({
    timeoutMs: 1,
    cacheSize: -5,
    negativeTtlMs: 10 ** 9,
    chain: ['google', 'google', 'bogus'],
    ollama: { baseURL: 'http://10.0.0.2:11434///', model: 'x/y:1b' },
  })
  assert.equal(custom.timeoutMs, 500, '过小超时被夹到 500ms')
  assert.equal(custom.cacheSize, 0, '负容量夹到 0')
  assert.equal(custom.negativeTtlMs, 300000, '过大负缓存被夹到 5 分钟')
  assert.deepEqual(custom.chain, ['google'], '未知 id 丢弃、重复去重')
  assert.equal(custom.ollama.baseURL, 'http://10.0.0.2:11434', '去掉结尾斜杠')
})

test('LruCache 命中刷新顺序、超限淘汰最旧', () => {
  const cache = new host.LruCache(2)
  cache.set('a', '1')
  cache.set('b', '2')
  cache.get('a')
  cache.set('c', '3')
  assert.equal(cache.get('b'), undefined, 'b 是最久未用的，应被淘汰')
  assert.equal(cache.get('a'), '1')
  assert.equal(cache.get('c'), '3')
})

test('NegativeCache 到期失效', () => {
  let now = 1000
  const negative = new host.NegativeCache(30000, 10, () => now)
  negative.add('k')
  assert.equal(negative.has('k'), true)
  now += 30000
  assert.equal(negative.has('k'), false, '到期后应失效')
})

test('译文字符串清洗：去引号与“译文：”前缀', () => {
  assert.equal(host.stripWrapping('“你好”'), '你好')
  assert.equal(host.stripWrapping('译文：你好'), '你好')
  assert.equal(host.stripWrapping('Translation: hello'), 'hello')
  assert.equal(host.stripWrapping('你好'), '你好')
})

test('ollama 适配器：请求体、keep_alive 与采样参数', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const provider = host.createOllamaProvider(
    host.normalizeConfig({ ollama: { model: 'kaelri/hy-mt2:7b-q4_K_M', keepAlive: '5m', autostart: false } }).ollama,
  )
  const out = await provider.translate(['Think step one.'], 'zh-Hans', AbortSignal.timeout(1000), fetchImpl)

  assert.deepEqual(out, ['中文译文'])
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:11434/api/chat')
  const body = JSON.parse(fetchImpl.calls[0].init.body)
  assert.equal(body.model, 'kaelri/hy-mt2:7b-q4_K_M')
  assert.equal(body.stream, false)
  assert.equal(body.keep_alive, '5m')
  assert.equal(body.options.temperature, 0.7)
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /Simplified Chinese/)
  assert.equal(body.messages[1].content, 'Think step one.')
})

test('模型自动选择：优先 7B Q4，其次 1.8B，其次其它翻译模型', () => {
  assert.deepEqual(
    host.pickModel([
      'kaelri/hy-mt2:1.8b-q4_K_M',
      'kaelri/hy-mt2:7b-q8_0',
      'kaelri/hy-mt2:7b-q4_K_M',
    ]),
    'kaelri/hy-mt2:7b-q4_K_M',
  )
  assert.equal(host.pickModel(['kaelri/hy-mt2:1.8b-q4_K_M']), 'kaelri/hy-mt2:1.8b-q4_K_M')
  assert.equal(host.pickModel(['translategemma:4b']), 'translategemma:4b')
  assert.equal(host.pickModel(['some-other:latest']), 'some-other:latest')
  assert.equal(host.pickModel([]), undefined)
})

test('model=auto：先查 /api/tags 选模型，标签缓存 60 秒', async () => {
  const calls = []
  let chatModel
  const fetchImpl = fakeFetch((url, init) => {
    if (url.endsWith('/api/tags')) {
      calls.push('tags')
      return jsonResponse({ models: [{ name: 'kaelri/hy-mt2:1.8b-q4_K_M' }] })
    }
    chatModel = JSON.parse(init.body).model
    calls.push('chat')
    return jsonResponse(OLLAMA_OK)
  })
  const provider = host.createOllamaProvider(
    host.normalizeConfig({
      ollama: { model: 'auto', baseURL: 'http://fake:1', autostart: false },
    }).ollama,
  )
  // 换一个 baseURL，避开其它用例写进模块级标签缓存的条目。
  const first = await provider.translate(['hi'], 'zh-Hans', AbortSignal.timeout(1000), fetchImpl)
  assert.deepEqual(first, ['中文译文'])
  assert.equal(chatModel, 'kaelri/hy-mt2:1.8b-q4_K_M')
  assert.deepEqual(calls, ['tags', 'chat'])

  await provider.translate(['again'], 'zh-Hans', AbortSignal.timeout(1000), fetchImpl)
  assert.deepEqual(calls, ['tags', 'chat', 'chat'], '第二次应命中标签缓存，不再查 /api/tags')
})

test('probe 在 auto 模式下报出实际选中的模型', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ models: [{ name: 'kaelri/hy-mt2:7b-q4_K_M' }] }))
  const provider = host.createOllamaProvider(
    host.normalizeConfig({ ollama: { model: 'auto', baseURL: 'http://fake-probe:1' } }).ollama,
  )
  const probe = await provider.probe(AbortSignal.timeout(1000), fetchImpl)
  assert.equal(probe.available, true)
  assert.match(probe.detail, /7b-q4_K_M/)
})

test('本地服务按需拉起：连不上时 spawn 一次并等就绪', async () => {
  const launched = []
  let tagsCalls = 0
  const fetchImpl = fakeFetch((url) => {
    if (url.endsWith('/api/tags')) {
      tagsCalls += 1
      // 前两次（拉起前的探测 + 拉起后的第一次轮询）失败，之后服务就绪。
      return tagsCalls <= 2
        ? jsonResponse({}, 503)
        : jsonResponse({ models: [{ name: 'kaelri/hy-mt2:1.8b-q4_K_M' }] })
    }
    return jsonResponse(OLLAMA_OK)
  })
  const config = host.normalizeConfig({
    ollama: { model: 'auto', baseURL: 'http://autostart:1', autostart: true, bin: 'C:/fake/ollama.exe' },
    chain: ['ollama'],
  })
  const translator = new host.Translator({
    config,
    fetchImpl,
    ollamaRuntime: {
      launch: (bin) => launched.push(bin),
      sleep: async () => {},
      waitMs: 5000,
    },
  })

  const result = await translator.translate(['hello'])
  assert.deepEqual(result.translations, ['中文译文'])
  assert.deepEqual(launched, ['C:/fake/ollama.exe'], '应拉起一次本地服务')
})

test('autostart=false 时不拉起进程', async () => {
  const launched = []
  const fetchImpl = fakeFetch(() => jsonResponse({}, 503))
  const config = host.normalizeConfig({
    ollama: { model: 'auto', baseURL: 'http://no-autostart:1', autostart: false },
    chain: ['ollama'],
    google: { enabled: false },
  })
  const translator = new host.Translator({
    config,
    fetchImpl,
    ollamaRuntime: { launch: (bin) => launched.push(bin), sleep: async () => {}, waitMs: 100 },
  })
  const result = await translator.translate(['hello'])
  assert.deepEqual(result.translations, [''])
  assert.deepEqual(launched, [])
})

test('ensureOllamaServer：已就绪时不拉起', async () => {
  const launched = []
  const result = await host.ensureOllamaServer({
    baseURL: 'http://already-up:1',
    fetchImpl: fakeFetch(() => jsonResponse({ models: [] })),
    deps: { launch: (bin) => launched.push(bin) },
  })
  assert.deepEqual(result, { started: false, ready: true })
  assert.deepEqual(launched, [])
})

test('google 适配器：URL 参数与响应解析', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse([[['你好', 'hello']]]))
  const provider = host.createGoogleProvider(host.normalizeConfig({}).google)
  const out = await provider.translate(['hello'], 'zh-Hans', AbortSignal.timeout(1000), fetchImpl)
  assert.deepEqual(out, ['你好'])
  assert.match(fetchImpl.calls[0].url, /tl=zh-CN/)
  assert.match(fetchImpl.calls[0].url, /q=hello/)
})

test('provider 链：第一个失败自动降级到下一个', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/api/chat')) return jsonResponse({ error: 'boom' }, 500)
    return jsonResponse([[['兜底译文', 'hello']]])
  })
  const translator = new host.Translator({
    config: host.normalizeConfig({ ollama: { model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } }),
    fetchImpl,
  })
  const result = await translator.translate(['hello'])
  assert.deepEqual(result.translations, ['兜底译文'])
  assert.equal(result.provider, 'google')
})

test('provider 链：全挂则 fail-open + 负缓存命中不再打模型', async () => {
  let calls = 0
  const fetchImpl = fakeFetch(() => {
    calls += 1
    return jsonResponse({}, 500)
  })
  const translator = new host.Translator({ config: host.normalizeConfig({ ollama: { autostart: false } }), fetchImpl })

  const first = await translator.translate(['hello'])
  assert.deepEqual(first.translations, [''])
  assert.equal(first.provider, '')
  const afterFirst = calls
  assert.ok(afterFirst > 0)

  const second = await translator.translate(['hello'])
  assert.deepEqual(second.translations, [''])
  assert.equal(calls, afterFirst, '负缓存期内不应再请求 provider')
})

test('provider 链：缓存命中标记 provider=cache', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const translator = new host.Translator({
    config: host.normalizeConfig({ ollama: { model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } }),
    fetchImpl,
  })
  const first = await translator.translate(['hello'])
  assert.equal(first.provider, 'ollama')
  const second = await translator.translate(['hello'])
  assert.equal(second.provider, 'cache')
  assert.deepEqual(second.translations, ['中文译文'])
})

test('provider 链：返回条数不匹配视为该档失败', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/api/chat')) return jsonResponse(OLLAMA_OK)
    return jsonResponse([[['兜底', 'x']]])
  })
  const config = host.normalizeConfig({})
  const translator = new host.Translator({ config, fetchImpl })
  // 让 ollama 只返回 1 条而请求 2 条：借用 translate 的多段 → ollama 会循环两次，
  // 因此这里直接测 Translator 对 provider 返回长度不符的防御：用假 provider 替换。
  translator.providers = () => [
    { id: 'broken', kind: 'ollama', label: 'broken', translate: async () => [] },
    { id: 'google', kind: 'google', label: 'g', translate: async (segments) => segments.map(() => 'ok') },
  ]
  const result = await translator.translate(['a', 'b'])
  assert.deepEqual(result.translations, ['ok', 'ok'])
  assert.equal(result.provider, 'google')
})

test('parseTranslateBody 校验', () => {
  const ok = host.parseTranslateBody(JSON.stringify({ segments: [' hello ', 'world'], target: 'zh-Hans' }))
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.segments, ['hello', 'world'], '段落应 trim')

  assert.equal(host.parseTranslateBody('not json').ok, false)
  assert.equal(host.parseTranslateBody(JSON.stringify({ segments: [] })).ok, false)
  assert.equal(host.parseTranslateBody(JSON.stringify({ segments: ['   '] })).ok, false)
  assert.equal(host.parseTranslateBody(JSON.stringify({ segments: [1] })).ok, false)
  const tooMany = Array.from({ length: 65 }, () => 'x')
  assert.equal(host.parseTranslateBody(JSON.stringify({ segments: tooMany })).ok, false)
  const tooLong = 'x'.repeat(4001)
  assert.equal(host.parseTranslateBody(JSON.stringify({ segments: [tooLong] })).ok, false)
})

test('registerRoutes：POST 翻译成功 / 坏请求 400 / 方法 405 / trust fence', async () => {
  const routes = []
  const register = (route) => {
    routes.push(route)
    return () => {}
  }
  const fetchImpl = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const config = host.normalizeConfig({ ollama: { model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } })
  const translator = new host.Translator({ config, fetchImpl })
  let guardReject = false
  host.registerRoutes({
    register,
    translator,
    config,
    guard: (_req, res) => {
      if (!guardReject) return false
      res.statusCode = 401
      res.end()
      return true
    },
  })

  assert.deepEqual(
    routes.map((route) => route.path).sort(),
    ['/_cotx/models', '/_cotx/providers', '/_cotx/translate'],
  )
  const translate = routes.find((route) => route.path === '/_cotx/translate')

  const okRes = fakeResponse()
  await translate.handler(
    fakeRequest('POST', JSON.stringify({ segments: ['hello'] })),
    okRes,
  )
  assert.equal(okRes.statusCode, 200)
  assert.deepEqual(JSON.parse(okRes.body), { translations: ['中文译文'], provider: 'ollama' })
  assert.equal(okRes.headers['cache-control'], 'no-store')

  const badRes = fakeResponse()
  await translate.handler(fakeRequest('POST', '{"segments":[]}'), badRes)
  assert.equal(badRes.statusCode, 400)
  assert.equal(JSON.parse(badRes.body).error, 'bad-request')

  const methodRes = fakeResponse()
  await translate.handler(fakeRequest('GET'), methodRes)
  assert.equal(methodRes.statusCode, 405)
  assert.equal(methodRes.headers.allow, 'POST')

  guardReject = true
  const fenceRes = fakeResponse()
  await translate.handler(fakeRequest('POST', '{"segments":["hello"]}'), fenceRes)
  assert.equal(fenceRes.statusCode, 401)
})

test('apply 在假 ctx 上注册三条路由并可通过 effect 卸载', () => {
  const disposers = []
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      disposers.push({ label, disposer })
      return () => {}
    },
    webServer: {
      register: () => () => {},
    },
    logger: { info() {} },
    get: () => undefined,
  }
  host.apply(ctx, { chain: ['google'] })
  assert.equal(disposers.length, 1)
  assert.equal(typeof disposers[0].disposer, 'function')
  disposers[0].disposer()
})

test('apply 的 guard 走 connection.requestRejection', async () => {
  const routes = []
  const ctx = {
    effect(callback) {
      callback()
      return () => {}
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    get: (serviceName) =>
      serviceName === 'connection'
        ? { requestRejection: () => 403 }
        : undefined,
  }
  host.apply(ctx, {})
  const providers = routes.find((route) => route.path === '/_cotx/providers')
  const res = fakeResponse()
  await providers.handler(fakeRequest('GET'), res)
  assert.equal(res.statusCode, 403)
})
