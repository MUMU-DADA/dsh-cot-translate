/**
 * M2 端到端：真 HTTP（node:http）+ 假 Ollama，验证 `/_cotx/*` 三条路由的
 * 真实网络行为（请求体流、状态码、JSON 形状、provider 链）。
 *
 * 不依赖 DSH 进程：host 半的 apply() 在假 ctx 上注册路由，路由处理器挂到
 * 一个真实的 http server 上。
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

const host = await import('../lib/index.js')

/** 起一个假 Ollama：/api/chat 回显「译:原文」，/api/tags 报模型列表。 */
async function startFakeOllama(model) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ models: [{ name: model }] }))
      return
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        const user = body.messages?.find((message) => message.role === 'user')?.content ?? ''
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: { content: `译:${user.trim()}` } }))
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

/** 把插件注册的 exact 路由挂到一个真实 http server 上。 */
async function startHost(routes) {
  const server = createServer((req, res) => {
    const route = routes.find((candidate) => candidate.path === req.url)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

test('end-to-end：本地 provider 翻译 → providers 健康 → models', async (context) => {
  const model = 'kaelri/hy-mt2:7b-q4_K_M'
  const ollama = await startFakeOllama(model)
  context.after(() => ollama.server.close())

  const routes = []
  const ctx = {
    effect(callback) {
      callback()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    logger: { info() {} },
    get: () => undefined,
  }
  host.apply(ctx, {
    ollama: { baseURL: ollama.url, model },
    chain: ['ollama'],
  })

  const web = await startHost(routes)
  context.after(() => web.server.close())

  // 1) 翻译：代码片段不送翻，自然语言走本地 provider。
  const translateResponse = await fetch(`${web.url}/_cotx/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments: ['Check the repository layout.'] }),
  })
  assert.equal(translateResponse.status, 200)
  const translated = await translateResponse.json()
  assert.deepEqual(translated.translations, ['译:Check the repository layout.'])
  assert.equal(translated.provider, 'ollama')

  // 2) 健康检查：模型已在 /api/tags 里 → available。
  const providersResponse = await fetch(`${web.url}/_cotx/providers`)
  assert.equal(providersResponse.status, 200)
  const providers = await providersResponse.json()
  assert.equal(providers.enabled, true)
  assert.equal(providers.target, 'zh-Hans')
  assert.deepEqual(providers.chain, ['ollama'])
  assert.equal(providers.providers[0].id, 'ollama')
  assert.equal(providers.providers[0].available, true)

  // 3) 模型列表。
  const modelsResponse = await fetch(`${web.url}/_cotx/models`)
  assert.equal(modelsResponse.status, 200)
  assert.deepEqual(await modelsResponse.json(), { models: [model] })

  // 4) 坏请求 → 400，且不泄漏异常。
  const badResponse = await fetch(`${web.url}/_cotx/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments: [] }),
  })
  assert.equal(badResponse.status, 400)
  assert.equal((await badResponse.json()).error, 'bad-request')
})

test('end-to-end：provider 全挂时 200 + 空译文（fail-open）', async (context) => {
  const routes = []
  const ctx = {
    effect(callback) {
      callback()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    logger: { info() {} },
    get: () => undefined,
  }
  // 指向一个必然连不上的端口，且关掉 google 兜底与本地服务自启。
  host.apply(ctx, {
    ollama: { baseURL: 'http://127.0.0.1:1', model: 'none', autostart: false },
    google: { enabled: false },
    chain: ['ollama', 'google'],
    timeoutMs: 1000,
  })
  const web = await startHost(routes)
  context.after(() => web.server.close())

  const response = await fetch(`${web.url}/_cotx/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segments: ['hello'] }),
  })
  assert.equal(response.status, 200, 'provider 挂了也不能 5xx，由 UI 显示原文')
  const payload = await response.json()
  assert.deepEqual(payload.translations, [''])
  assert.equal(payload.provider, '')
})
