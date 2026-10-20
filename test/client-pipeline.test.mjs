/**
 * Client 翻译流水线冒烟：切分 / 分批 / 拼回 / fail-open。
 *
 * 同样直接加载构建产物 `lib/client.js`（假 DOM + 假 window 让
 * `__ModuleLoader__` 外壳能跑），纯逻辑一并导出复用。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const REQUIRE = createRequire(import.meta.url)
const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 在假 DOM 里执行 bundle，返回模块导出。 */
function loadClient() {
  let captured
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(options) {
          captured = options
        },
      },
    },
    document: {
      head: { appendChild() {} },
      querySelector: () => null,
      createElement: () => ({ textContent: '', setAttribute() {}, remove() {} }),
    },
    // 浏览器里由 Web 平台提供的全局；vm 沙箱没有，手动补上。
    AbortSignal,
    console,
  }
  vm.runInContext(SOURCE, vm.createContext(sandbox))
  return captured.factory(REQUIRE)
}

const client = loadClient()

/** 假 fetch：把每段包上「译:」前缀返回，并记录请求。 */
function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ url, body })
    return handler(body, calls.length)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

function okPayload(segments) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      translations: segments.map((segment) => `译:${segment.trim()}`),
      provider: 'ollama',
    }),
  }
}

test('splitForTranslation：技术片段原样保留，拼接可还原原文', () => {
  const text =
    'Check `config.ts` and https://example.com/docs, then run C:\\tools\\run.exe.\n' +
    '```bash\nnpm test\n```\nFinally read /usr/local/notes.txt.'
  const spans = client.splitForTranslation(text)

  assert.equal(
    spans.map((span) => span.text).join(''),
    text,
    '所有片段拼回去必须逐字等于原文',
  )
  const kept = spans.filter((span) => !span.translate).map((span) => span.text)
  assert.ok(kept.includes('`config.ts`'))
  assert.ok(kept.includes('https://example.com/docs,'))
  assert.ok(kept.includes('C:\\tools\\run.exe.'))
  assert.ok(kept.includes('/usr/local/notes.txt.'))
  assert.ok(kept.some((item) => item.startsWith('```bash')))
  assert.ok(spans.some((span) => span.translate && span.text.includes('Check')))
})

test('sentenceChunks：拼接还原、单块不超限', () => {
  const text = 'First sentence here. Second one follows! 第三句在这里。'
  const chunks = client.sentenceChunks(text)
  assert.equal(chunks.join(''), text)

  const long = 'x'.repeat(700)
  const pieces = client.sentenceChunks(long, 240)
  assert.ok(pieces.length >= 3)
  for (const piece of pieces) assert.ok(piece.length <= 240)
  assert.equal(pieces.join(''), long)
})

test('batchChunks：每批段数与字符数都受限', () => {
  const chunks = Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(200, 'a'))
  const batches = client.batchChunks(chunks)
  assert.ok(batches.every((batch) => batch.length <= client.MAX_CHUNKS_PER_REQUEST))
  assert.ok(
    batches.every((batch) =>
      batch.reduce((total, chunk) => total + chunk.length, 0) <= client.MAX_CHARS_PER_REQUEST),
  )
  assert.equal(batches.flat().length, chunks.length)
})

test('TextTranslator：成功后按原位拼回，代码块保持原样', async () => {
  const fetchImpl = fakeFetch((body) => okPayload(body.segments))
  const translator = new client.TextTranslator({ fetchImpl })

  const text = 'Run `npm test` now, then open https://example.com.'
  const outcome = await translator.translate(text)

  assert.equal(outcome.ok, true)
  assert.equal(outcome.provider, 'ollama')
  assert.ok(outcome.text.includes('`npm test`'), '行内代码必须原样保留')
  assert.ok(outcome.text.includes('https://example.com.'), 'URL 必须原样保留')
  assert.ok(outcome.text.includes('译:Run'), '自然语言部分应被翻译')
  assert.ok(!fetchImpl.calls[0].body.segments.some((segment) => segment.includes('https://')))

  // 第二次同文本命中 client 缓存，不再发请求。
  const before = fetchImpl.calls.length
  const cached = await translator.translate(text)
  assert.equal(cached.ok, true)
  assert.equal(fetchImpl.calls.length, before, '同文本应命中 client 缓存')
})

test('TextTranslator：provider 失败时 fail-open 返回原文', async () => {
  const fetchImpl = fakeFetch(() => ({
    ok: false,
    status: 503,
    json: async () => ({ error: 'unavailable' }),
  }))
  const translator = new client.TextTranslator({ fetchImpl })
  const text = 'Some reasoning text.'
  const outcome = await translator.translate(text)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.text, text, '失败必须原样返回原文')
})

test('TextTranslator：纯技术文本不发请求', async () => {
  const fetchImpl = fakeFetch((body) => okPayload(body.segments))
  const translator = new client.TextTranslator({ fetchImpl })
  const text = '`npm run build` /usr/local/bin https://example.com'
  const outcome = await translator.translate(text)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.provider, 'none')
  assert.equal(fetchImpl.calls.length, 0)
  assert.equal(outcome.text, text)
})
