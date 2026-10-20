/**
 * Host 半（M2）冒烟测试：直接加载构建产物 `lib/index.js`，用假 fetch / 假 HTTP
 * 对象跑 provider 链、缓存、校验与路由。
 *
 * 产物是自包含 ESM（不 import 任何 @deepseek-ai/*），所以能在 node 里直接跑。
 * `pretest` 会先 build。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  assert.deepEqual(defaults.chain, ['llamacpp', 'google'])
  assert.equal(defaults.ollama.baseURL, 'http://127.0.0.1:11434')

  const custom = host.normalizeConfig({
    timeoutMs: 1,
    cacheSize: -5,
    negativeTtlMs: 10 ** 9,
    chain: ['google', 'google', 'bogus'],
    ollama: { enabled: true, baseURL: 'http://10.0.0.2:11434///', model: 'x/y:1b' },
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
    host.normalizeConfig({ ollama: { enabled: true, model: 'kaelri/hy-mt2:7b-q4_K_M', keepAlive: '5m', autostart: false } }).ollama,
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
      ollama: { enabled: true, model: 'auto', baseURL: 'http://fake:1', autostart: false },
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
    host.normalizeConfig({ ollama: { enabled: true, model: 'auto', baseURL: 'http://fake-probe:1' } }).ollama,
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
    ollama: { enabled: true, model: 'auto', baseURL: 'http://autostart:1', autostart: true, bin: 'C:/fake/ollama.exe' },
    chain: ['ollama'],
  })
  const translator = new host.Translator({
    config,
    fetchImpl,
    localRuntime: {
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
    ollama: { enabled: true, model: 'auto', baseURL: 'http://no-autostart:1', autostart: false },
    chain: ['ollama'],
    google: { enabled: false },
  })
  const translator = new host.Translator({
    config,
    fetchImpl,
    localRuntime: { launch: (bin) => launched.push(bin), sleep: async () => {}, waitMs: 100 },
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

test('llamacpp 适配器：OpenAI 兼容请求与响应', async () => {
  let body
  const fetchImpl = fakeFetch((_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse({ choices: [{ message: { content: '  本地译文  ' } }] })
  })
  const provider = host.createLlamaCppProvider(
    host.normalizeConfig({
      llamacpp: { baseURL: 'http://127.0.0.1:8081', autostart: false },
    }).llamacpp,
  )
  const out = await provider.translate(
    ['Check the repo layout.'],
    'zh-Hans',
    AbortSignal.timeout(1000),
    fetchImpl,
  )
  assert.deepEqual(out, ['本地译文'])
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:8081/v1/chat/completions')
  assert.equal(body.messages[0].role, 'system')
  assert.match(body.messages[0].content, /Simplified Chinese/)
  assert.equal(body.messages[1].content, 'Check the repo layout.')
  assert.equal(body.temperature, 0.7)
  assert.equal(body.top_k, 20)
  assert.ok(body.max_tokens >= 128)
})

test('llamacpp probe：/health 失败时回退 /v1/models', async () => {
  const healthy = host.createLlamaCppProvider(
    host.normalizeConfig({ llamacpp: { baseURL: 'http://h1:1', autostart: false } }).llamacpp,
  )
  const healthyProbe = await healthy.probe(
    AbortSignal.timeout(500),
    fakeFetch(() => jsonResponse({ status: 'ok' })),
  )
  assert.equal(healthyProbe.available, true)
  assert.match(healthyProbe.detail, /^model: /, '应报出当前会用的模型名')

  const fallback = host.createLlamaCppProvider(
    host.normalizeConfig({ llamacpp: { baseURL: 'http://h2:1', autostart: false } }).llamacpp,
  )
  const fetchImpl = fakeFetch((url) =>
    url.endsWith('/health')
      ? jsonResponse({}, 404)
      : jsonResponse({ data: [{ id: 'local' }] }),
  )
  const probe = await fallback.probe(AbortSignal.timeout(500), fetchImpl)
  assert.equal(probe.available, true)
})

test('llamacpp 自启：拉起参数带模型、端口与 GPU 层数', async () => {
  const launched = []
  let healthCalls = 0
  const fetchImpl = fakeFetch((url) => {
    if (url.endsWith('/health')) {
      healthCalls += 1
      return healthCalls <= 2 ? jsonResponse({}, 503) : jsonResponse({ status: 'ok' })
    }
    return jsonResponse({ choices: [{ message: { content: '译文' } }] })
  })
  const config = host.normalizeConfig({
    chain: ['llamacpp'],
    llamacpp: {
      baseURL: 'http://127.0.0.1:18080',
      bin: 'C:/fake/llama-server.exe',
      modelPath: 'C:/fake/model.gguf',
      gpuLayers: 42,
      ctxSize: 2048,
      autostart: true,
    },
  })
  const translator = new host.Translator({
    config,
    fetchImpl,
    localRuntime: {
      launch: (bin, args) => launched.push({ bin, args }),
      sleep: async () => {},
      waitMs: 5000,
    },
  })
  const result = await translator.translate(['hello'])
  assert.deepEqual(result.translations, ['译文'])
  assert.equal(launched.length, 1)
  assert.equal(launched[0].bin, 'C:/fake/llama-server.exe')
  const args = launched[0].args.join(' ')
  assert.match(args, /-m C:\/fake\/model\.gguf/)
  assert.match(args, /--port 18080/)
  assert.match(args, /-ngl 42/)
  assert.match(args, /-c 2048/)
  assert.match(args, /--no-webui/)
})

test('modelPath 给定时 provider.model 用文件名', () => {
  const provider = host.createLlamaCppProvider(
    host.normalizeConfig({
      llamacpp: { modelPath: 'C:/models/Hy-MT2-1.8B-Q4_K_M.gguf', autostart: false },
    }).llamacpp,
  )
  assert.equal(provider.model, 'Hy-MT2-1.8B-Q4_K_M')
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
    config: host.normalizeConfig({ chain: ['ollama', 'google'], llamacpp: { enabled: false, autostart: false }, ollama: { enabled: true, model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } }),
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
  const translator = new host.Translator({ config: host.normalizeConfig({ chain: ['ollama', 'google'], llamacpp: { enabled: false, autostart: false }, ollama: { enabled: true, autostart: false } }), fetchImpl })

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
    config: host.normalizeConfig({ chain: ['ollama', 'google'], llamacpp: { enabled: false, autostart: false }, ollama: { enabled: true, model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } }),
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
  const config = host.normalizeConfig({ chain: ['ollama', 'google'], llamacpp: { enabled: false, autostart: false }, ollama: { enabled: true, model: 'kaelri/hy-mt2:7b-q4_K_M', autostart: false } })
  const translator = new host.Translator({ config, fetchImpl })
  const facade = {
    translate: (segments, target, sessionId) =>
      translator.translate(segments, target ?? config.target, sessionId === undefined ? undefined : { sessionId }),
    providerStates: () => translator.providerStates(),
    modelsList: () => translator.models(),
  }
  let guardReject = false
  host.registerRoutes({
    register,
    facade,
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

// ── 设置 / 模型 / 控制层（M4）────────────────────────────────────

/** 在临时目录里跑（设置与下载都写这里，不碰真实 ~/.dsh）。 */
function withTempHome(fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cotx-home-'))
    process.env.COTX_HOME = dir
    try {
      await fn(dir)
    } finally {
      delete process.env.COTX_HOME
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('设置：归一化坏值回退默认，补丁落盘可读回', withTempHome(async () => {
  assert.deepEqual(host.normalizeSettings({}), host.DEFAULT_SETTINGS)
  assert.equal(host.normalizeSettings({ mode: 'auto', enabled: false }).mode, 'auto')
  assert.equal(host.normalizeSettings({ mode: 'nope' }).mode, 'semi')
  assert.equal(host.normalizeSettings({ modelId: '   ' }).modelId, host.DEFAULT_SETTINGS.modelId)
  assert.equal(host.normalizeSettings({ target: 42 }).target, host.DEFAULT_SETTINGS.target)

  const saved = host.patchSettings({ mode: 'auto' })
  assert.equal(saved.mode, 'auto')
  assert.deepEqual(host.loadSettings(), saved)

  const again = host.patchSettings({ modelId: 'hy-mt2-7b-q4', useSessionModel: true })
  assert.equal(again.mode, 'auto', '补丁不能丢掉已有字段')
  assert.equal(again.modelId, 'hy-mt2-7b-q4')
  assert.equal(again.useSessionModel, true)
}))

test('模型目录：下载 → 已安装 → 可删除；自带模型不可删', withTempHome(async () => {
  const preset = host.MODEL_CATALOG.find((model) => model.id === 'hy-mt2-1.8b-q8')
  assert.ok(preset !== undefined)

  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(String(url))
    return new Response(Buffer.from('GGUF-FAKE'))
  }
  await host.downloadModel('hy-mt2-1.8b-q8', fetchImpl)
  assert.deepEqual(fetched, [preset.url])

  const status = host.listModels().find((model) => model.id === 'hy-mt2-1.8b-q8')
  assert.equal(status.installed, true)
  assert.equal(status.bytes, 9)
  // 每个可下载/自带模型都必须带许可证信息（设置页要展示）
  for (const model of host.MODEL_CATALOG) {
    assert.equal(model.license, 'Apache-2.0', `${model.id} 应标注许可证`)
    assert.match(model.copyright, /Tencent/, `${model.id} 应标注版权`)
    assert.match(model.source, /^tencent\/Hy-MT2/, `${model.id} 应标注来源仓库`)
  }
  assert.equal(status.license, 'Apache-2.0')
  assert.match(status.source, /Hy-MT2/)
  assert.equal(host.resolveModelPath('hy-mt2-1.8b-q8'), join(host.managedDir(), preset.file))
  assert.deepEqual(host.downloadStateOf('hy-mt2-1.8b-q8').phase, 'done')

  assert.equal(host.deleteModel('hy-mt2-1.8b-q4'), false, '自带兜底模型不可删除')
  assert.equal(host.deleteModel('hy-mt2-1.8b-q8'), true)
  assert.equal(host.listModels().find((model) => model.id === 'hy-mt2-1.8b-q8').installed, false)
}))

test('Control：设置即时生效（关翻译 / 用会话模型 / 静态 chain 不被覆盖）', withTempHome(async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const staticConfig = {
    chain: ['ollama'],
    google: { enabled: false },
    ollama: { enabled: true, model: 'x/y:1b', autostart: false },
  }
  const control = new host.Control({ staticConfig, fetchImpl })

  const initial = control.state()
  assert.equal(initial.settings.mode, 'semi')
  assert.deepEqual(initial.chain, ['ollama'])
  assert.equal(initial.enabled, true)

  const result = await control.translate(['hello'])
  assert.deepEqual(result.translations, ['中文译文'])
  assert.equal(result.provider, 'ollama')

  const off = control.update({ enabled: false })
  assert.equal(off.enabled, false)
  assert.deepEqual((await control.translate(['hello'])).translations, [''])

  const on = control.update({ enabled: true })
  assert.equal(on.enabled, true)

  // 打开「用对话模型翻译」：session 档插到链首
  const sessionControl = new host.Control({
    staticConfig,
    fetchImpl,
    sessionModel: () => ({
      resolveRoute: (sessionId) => (sessionId === undefined ? undefined : { provider: 'p', model: 'm' }),
      call: async (request) => `会话译文:${request.user}`,
    }),
  })
  sessionControl.update({ useSessionModel: true })
  assert.deepEqual(sessionControl.state().chain, ['session', 'ollama'])
  const viaSession = await sessionControl.translate(['session hello'], undefined, 'session-1')
  assert.deepEqual(viaSession.translations, ['会话译文:session hello'])
  assert.equal(viaSession.provider, 'session')

  // 没有会话 id 时 session 档拿不到路由 → 降级到 ollama（换一段文本避开缓存）
  const fallback = await sessionControl.translate(['fallback text'])
  assert.equal(fallback.provider, 'ollama')
}))

test('Control：速度自测返回耗时与 provider', withTempHome(async () => {
  const fetchImpl = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const control = new host.Control({
    staticConfig: {
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, model: 'x/y:1b', autostart: false },
    },
    fetchImpl,
  })
  const result = await control.selftest()
  assert.equal(result.ok, true)
  assert.equal(result.provider, 'ollama')
  assert.equal(result.segments, 3)
  assert.ok(result.ms >= 0)
  assert.ok(result.perSegmentMs >= 0)
}))
// ── 磁盘译文缓存（M4.1）────────────────────────────────────────

test('磁盘缓存：写读、统计、损坏文件自愈', withTempHome(async (dir) => {
  const cache = new host.PersistentCache({ dir: join(dir, 'cache') })
  assert.equal(cache.get('zh-Hans', 'hello'), undefined)

  cache.set('zh-Hans', 'hello', '你好', 'llamacpp')
  cache.set('zh-Hans', 'world', '世界', 'llamacpp')
  assert.equal(cache.get('zh-Hans', 'hello'), '你好')
  const stats = cache.stats()
  assert.equal(stats.entries, 2)
  assert.ok(stats.bytes > 0)
  assert.equal(stats.limitBytes, host.DEFAULT_CACHE_LIMIT_BYTES, '默认上限 50MB')

  // 原文不落盘：目录里不应出现原文
  const files = []
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) walk(child)
      else files.push(child)
    }
  }
  walk(join(dir, 'cache'))
  const contents = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.ok(!contents.includes('hello'), '原文不应写入磁盘')
  assert.ok(contents.includes('你好'), '译文应写入磁盘')

  // 损坏文件：读不到就当没有，且不会抛错
  writeFileSync(files[0], 'not-json')
  assert.equal(cache.get('zh-Hans', 'hello'), undefined)
  assert.equal(cache.get('zh-Hans', 'hello'), undefined, '损坏条目被清掉后仍返回 undefined')
}))

test('磁盘缓存：超过上限按最旧的淘汰', withTempHome(async (dir) => {
  const limit = 1024
  const cache = new host.PersistentCache({ dir: join(dir, 'cache'), limitBytes: limit })
  for (let index = 0; index < 40; index += 1) {
    cache.set('zh-Hans', `text-${index}`, `译文-${index}-${'x'.repeat(40)}`, 'llamacpp')
  }
  const stats = cache.stats()
  assert.ok(stats.bytes <= limit, `占用应回到上限内（${stats.bytes} <= ${limit}）`)
  assert.ok(stats.entries < 40, '应有条目被淘汰')
  assert.equal(cache.get('zh-Hans', 'text-0'), undefined, '最旧的条目应被淘汰')
  assert.notEqual(cache.get('zh-Hans', 'text-39'), undefined, '最新条目应保留')
}))

test('磁盘缓存：clear 清空并归零，重启后仍可读', withTempHome(async (dir) => {
  const dirPath = join(dir, 'cache')
  const first = new host.PersistentCache({ dir: dirPath })
  first.set('zh-Hans', 'persist me', '持久化', 'llamacpp')

  const second = new host.PersistentCache({ dir: dirPath })
  assert.equal(second.get('zh-Hans', 'persist me'), '持久化', '新实例应能读到已有缓存')

  const cleared = second.clear()
  assert.equal(cleared.entries, 0)
  assert.equal(cleared.bytes, 0)
  assert.equal(new host.PersistentCache({ dir: dirPath }).get('zh-Hans', 'persist me'), undefined)
}))

test('provider 链：磁盘缓存命中不再打模型（跨实例）', withTempHome(async (dir) => {
  const dirPath = join(dir, 'cache')
  const config = host.normalizeConfig({
    chain: ['ollama'],
    llamacpp: { enabled: false, autostart: false },
    google: { enabled: false },
    ollama: { enabled: true, model: 'm', autostart: false },
  })
  const firstFetch = fakeFetch(() => jsonResponse(OLLAMA_OK))
  const first = new host.Translator({
    config,
    fetchImpl: firstFetch,
    persistent: new host.PersistentCache({ dir: dirPath }),
  })
  assert.deepEqual((await first.translate(['hello'])).translations, ['中文译文'])
  assert.equal(firstFetch.calls.length, 1)

  const secondFetch = fakeFetch(() => {
    throw new Error('不应再打模型')
  })
  const second = new host.Translator({
    config,
    fetchImpl: secondFetch,
    persistent: new host.PersistentCache({ dir: dirPath }),
  })
  const cached = await second.translate(['hello'])
  assert.deepEqual(cached.translations, ['中文译文'])
  assert.equal(cached.provider, 'cache')
  assert.equal(secondFetch.calls.length, 0, '磁盘缓存命中后不应调用 provider')
}))
test('设置：target 默认空（待客户端初始化），已知语言才保留', () => {
  assert.equal(host.normalizeSettings({}).target, '', '默认不预设语言')
  assert.equal(host.normalizeSettings({ target: 'fr' }).target, 'fr')
  assert.equal(host.normalizeSettings({ target: 'zh-Hant' }).target, 'zh-Hant')
  assert.equal(host.normalizeSettings({ target: 'nope' }).target, '', '未知语言码回退为空')
  assert.equal(host.normalizeSettings({ target: '' }).target, '')
})

test('多语言：提示词用完整英文语言名（缩写会掉质量）', () => {
  assert.equal(host.targetLabel('zh-Hans'), 'Simplified Chinese')
  assert.equal(host.targetLabel('zh-Hant'), 'Traditional Chinese')
  assert.equal(host.targetLabel('zh-CN'), 'Simplified Chinese')
  assert.equal(host.targetLabel('fr'), 'French')
  assert.equal(host.targetLabel('de'), 'German')
  assert.equal(host.targetLabel('ja'), 'Japanese')
  assert.equal(host.targetLabel('ar'), 'Arabic')
  assert.equal(host.targetLabel('yue'), 'Cantonese')
  // 未知语言原样透传（不猜）
  assert.equal(host.targetLabel('xx'), 'xx')
  // 语言表覆盖模型卡的全部语言
  assert.ok(host.LANGUAGES.length >= 33, '至少 33 种语言')
  assert.equal(host.LANGUAGES.find((language) => language.code === 'fr').zh, '法语')
})

test('多语言：provider 请求体里是完整语言名', async () => {
  let body
  const fetchImpl = fakeFetch((_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse({ choices: [{ message: { content: 'Bonjour' } }] })
  })
  const provider = host.createLlamaCppProvider(
    host.normalizeConfig({ llamacpp: { autostart: false } }).llamacpp,
  )
  await provider.translate(['hello'], 'fr', AbortSignal.timeout(1000), fetchImpl)
  assert.match(body.messages[0].content, /French/)
  assert.ok(!body.messages[0].content.includes('into fr '), '不能把缩写直接塞进提示词')
})
test('设置：服务端口归一化（1024–65535，坏值回退 28457）', () => {
  assert.equal(host.DEFAULT_SETTINGS.localPort, host.DEFAULT_LOCAL_PORT)
  assert.equal(host.DEFAULT_LOCAL_PORT, 28457)
  assert.equal(host.normalizeSettings({}).localPort, 28457)
  assert.equal(host.normalizeSettings({ localPort: 30000 }).localPort, 30000)
  assert.equal(host.normalizeSettings({ localPort: 80 }).localPort, 28457, '1024 以下回退')
  assert.equal(host.normalizeSettings({ localPort: 70000 }).localPort, 28457, '越界回退')
  assert.equal(host.normalizeSettings({ localPort: 'x' }).localPort, 28457, '非数字回退')
})

test('Control：改端口立即生效（baseURL 跟着变）', withTempHome(async () => {
  const control = new host.Control({
    staticConfig: {
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, model: 'm', autostart: false },
    },
    fetchImpl: fakeFetch(() => jsonResponse(OLLAMA_OK)),
  })
  assert.equal(control.state().localPort, 28457)
  const updated = control.update({ localPort: 30555 })
  assert.equal(updated.localPort, 30555)
  assert.match(control.configView().llamacpp.baseURL, /:30555$/)
}))

test('probePort：空闲 / 被占用 / 不是我们的服务', withTempHome(async () => {
  const free = await host.probePort(28457 + 2000 + Math.floor(Math.random() * 500))
  assert.equal(free.free, true)

  const server = createServer((_req, res) => {
    res.statusCode = 404
    res.end('nope')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const occupied = await host.probePort(port)
    assert.equal(occupied.free, false)
    assert.equal(occupied.ours, false, '不是 llama-server 的 /health')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}))
test('目标语言未初始化：不拼空提示词（回退 zh-Hans）', withTempHome(async () => {
  let body
  const fetchImpl = fakeFetch((_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse(OLLAMA_OK)
  })
  const staticConfig = {
    chain: ['ollama'],
    google: { enabled: false },
    ollama: { enabled: true, model: 'm', autostart: false },
  }
  const control = new host.Control({ staticConfig, fetchImpl })
  assert.equal(control.state().settings.target, '', '默认未初始化')
  const result = await control.translate(['hello'])
  assert.deepEqual(result.translations, ['中文译文'])
  const system = body.messages.find((message) => message.role === 'system').content
  assert.match(system, /Simplified Chinese/, '空 target 应回退 zh-Hans')

  // 直接给 Translator 传空串也不能拼出空提示词
  const translator = new host.Translator({
    config: host.normalizeConfig({ chain: ['ollama'], google: { enabled: false }, ollama: { enabled: true, model: 'm', autostart: false } }),
    fetchImpl,
  })
  await translator.translate(['hello2'], '')
  const system2 = body.messages.find((message) => message.role === 'system').content
  assert.match(system2, /Simplified Chinese/)
}))
test('i18n：host 只给 key/枚举，展示文案由客户端翻译', withTempHome(async () => {
  // 模型目录带 noteKey（客户端据此本地化）
  for (const entry of host.MODEL_CATALOG) {
    assert.match(entry.noteKey, /^model\.note\./, `${entry.id} 应有 noteKey`)
    assert.equal(/[\u4e00-\u9fff]/.test(entry.note), false, `${entry.id} 的 note 应是英文后备`)
  }
  assert.equal(host.listModels()[0].noteKey, 'model.note.bundled')

  // provider 状态带 labelKey
  const translator = new host.Translator({
    config: host.normalizeConfig({
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, model: 'm', autostart: false },
    }),
    fetchImpl: fakeFetch(() => jsonResponse({ models: [{ name: 'm' }] })),
  })
  const states = await translator.providerStates()
  assert.equal(states[0].labelKey, 'provider.ollama')
  assert.equal(/[\u4e00-\u9fff]/.test(states[0].label), false, 'label 应是英文规范名')

  // 自测失败给稳定错误码（客户端按语言显示）
  const failing = new host.Control({
    staticConfig: {
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, baseURL: 'http://127.0.0.1:1', model: 'm', autostart: false },
    },
    fetchImpl: fakeFetch(() => {
      throw new Error('offline')
    }),
  })
  const result = await failing.selftest()
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'all-unavailable')
}))
test('ensureLocalServer：服务退出后重新探活并自启（不缓存永久 ready）', async () => {
  let healthy = false
  let launches = 0
  const fetchImpl = fakeFetch(() => (healthy ? jsonResponse({ status: 'ok' }) : jsonResponse({}, 503)))
  const options = {
    baseURL: 'http://127.0.0.1:29999',
    probePath: '/health',
    fetchImpl,
    plan: () => ({ bin: 'fake-llama-server', args: [] }),
    deps: {
      launch: () => {
        launches += 1
        healthy = true
        return 4242
      },
      sleep: async () => {},
      waitMs: 500,
    },
  }
  // 第一次：服务没起 → 拉起
  assert.deepEqual(await host.ensureLocalServer(options), { started: true, ready: true })
  assert.equal(launches, 1)
  // 第二次：服务还在 → 探活成功，不重复拉起
  assert.deepEqual(await host.ensureLocalServer(options), { started: false, ready: true })
  assert.equal(launches, 1)
  // 服务退出：探活失败 → 必须重新拉起，而不是返回缓存里的 ready
  healthy = false
  assert.deepEqual(await host.ensureLocalServer(options), { started: true, ready: true })
  assert.equal(launches, 2)
  // 拉不起来（没有 plan）时给 ready:false，而不是一直假装 ready
  healthy = false
  assert.deepEqual(
    await host.ensureLocalServer({ ...options, plan: () => undefined }),
    { started: false, ready: false },
  )
})

test('registerRoutes：非法 / 超限请求体返回 400 / 413，且不触发控制方法', async () => {
  const routes = []
  const register = (route) => {
    routes.push(route)
    return () => {}
  }
  const calls = { restart: 0, clear: 0 }
  const control = {
    state: () => ({ cache: {} }),
    update: () => ({}),
    restart: () => {
      calls.restart += 1
      return {}
    },
    clearCache: () => {
      calls.clear += 1
      return {}
    },
    remove: () => ({}),
    download: async () => {},
    selftest: async () => ({}),
    portStatus: async () => ({ free: true }),
  }
  const facade = {
    translate: async () => ({ translations: [], provider: '' }),
    providerStates: async () => [],
    modelsList: async () => [],
  }
  host.registerRoutes({ register, facade, config: host.normalizeConfig({}), guard: () => false, control })
  const find = (path) => routes.find((route) => route.path === path)

  // 非法 JSON → 400，且不执行清缓存
  const badBody = fakeResponse()
  await find('/_cotx/cache/clear').handler(fakeRequest('POST', '{not json'), badBody)
  assert.equal(badBody.statusCode, 400)
  assert.equal(calls.clear, 0)

  // 超过 64KB → 413，且不执行重启
  const tooLarge = fakeResponse()
  await find('/_cotx/restart').handler(fakeRequest('POST', 'x'.repeat(70_000)), tooLarge)
  assert.equal(tooLarge.statusCode, 413)
  assert.equal(calls.restart, 0)

  // 数组/标量 JSON 也不是合法对象体 → 400
  const arrayBody = fakeResponse()
  await find('/_cotx/restart').handler(fakeRequest('POST', '[1,2]'), arrayBody)
  assert.equal(arrayBody.statusCode, 400)
  assert.equal(calls.restart, 0)

  // 合法 JSON / 空体照常执行
  const okBody = fakeResponse()
  await find('/_cotx/restart').handler(fakeRequest('POST', '{"x":1}'), okBody)
  assert.equal(okBody.statusCode, 200)
  assert.equal(calls.restart, 1)
  const emptyBody = fakeResponse()
  await find('/_cotx/cache/clear').handler(fakeRequest('POST'), emptyBody)
  assert.equal(emptyBody.statusCode, 200)
  assert.equal(calls.clear, 1)
})
test('errorCategory：把第三方错误归类，不保留原文', () => {
  assert.equal(host.errorCategory(new Error('fetch failed')), 'network')
  assert.equal(host.errorCategory(new Error('ECONNREFUSED 127.0.0.1')), 'network')
  assert.equal(host.errorCategory(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'timeout')
  assert.equal(host.errorCategory(new Error('HTTP 502')), 'http')
  assert.equal(host.errorCategory(new Error('Unauthorized: bad api key')), 'auth')
  assert.equal(host.errorCategory(new Error('Unexpected token in JSON')), 'parse')
  assert.equal(host.errorCategory(new Error('p: length mismatch')), 'length-mismatch')
  assert.equal(host.errorCategory('随便什么原文'), 'unknown')
})

test('Translator：日志只记错误类别，不泄露第三方原始错误文本', async () => {
  const logs = []
  const translator = new host.Translator({
    config: host.normalizeConfig({
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, model: 'm', autostart: false },
    }),
    fetchImpl: fakeFetch(() => {
      throw new Error('SECRET 原文 hello world sk-123456')
    }),
    log: (line) => logs.push(line),
  })
  const out = await translator.translate(['hello world'])
  assert.deepEqual(out.translations, [''])
  assert.ok(logs.some((line) => line.includes('failed')), '应有失败日志')
  const joined = JSON.stringify(logs)
  assert.equal(joined.includes('SECRET'), false, '日志不能含第三方原始错误')
  assert.equal(joined.includes('sk-123456'), false, '日志不能含疑似密钥')
  assert.equal(joined.includes('hello world'), false, '日志不能含原文')
})

test('Translator.models：拿不到列表时日志同样不泄露原始错误', async () => {
  const logs = []
  const translator = new host.Translator({
    config: host.normalizeConfig({
      chain: ['ollama'],
      google: { enabled: false },
      ollama: { enabled: true, baseURL: 'http://127.0.0.1:29991', model: 'auto', autostart: false },
    }),
    fetchImpl: fakeFetch(() => {
      throw new Error('SECRET-TOKEN-xyz 用户原文')
    }),
    log: (line) => logs.push(line),
  })
  assert.deepEqual(await translator.models(), [])
  assert.ok(logs.some(line => line.includes('listModels failed')))
  assert.equal(JSON.stringify(logs).includes('SECRET'), false)
})

test('Control.clearCache：同时清掉磁盘与内存缓存', withTempHome(async () => {
  let calls = 0
  const fetchImpl = fakeFetch(() => {
    calls += 1
    return jsonResponse(OLLAMA_OK)
  })
  const control = new host.Control({
    staticConfig: host.normalizeConfig({
      chain: ['ollama'],
      google: { enabled: false },
      llamacpp: { enabled: false },
      ollama: { enabled: true, model: 'm', autostart: false },
    }),
    fetchImpl,
  })
  const first = await control.translate(['hello'])
  assert.equal(first.provider, 'ollama')
  const afterFirst = calls
  // 第二次命中内存缓存，不该再打 provider
  await control.translate(['hello'])
  assert.equal(calls, afterFirst)
  // 清缓存后内存 LRU 也应清空，必须重新请求
  control.clearCache()
  const afterClear = await control.translate(['hello'])
  assert.equal(afterClear.provider, 'ollama')
  assert.equal(calls, afterFirst + 1)
}))
