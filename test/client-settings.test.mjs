/**
 * 设置页渲染冒烟（jsdom + React）：确认 `SettingsSection` 能挂载、读到 `/_cotx/state`
 * 并渲染开关、模型、端口、缓存以及底部的版权信息。真实数据来自 host，这里用假 fetch。
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const REQUIRE = createRequire(import.meta.url)
const SOURCE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 假状态：一个自带模型（已安装）+ 一个预选（未安装）。 */
const STATE = {
  settings: {
    enabled: true,
    mode: 'semi',
    modelId: 'hy-mt2-1.8b-q4',
    useSessionModel: false,
    target: 'zh-Hans',
  },
  models: [
    {
      id: 'hy-mt2-1.8b-q4',
      label: 'Hy-MT2 1.8B Q4_K_M',
      bundled: true,
      note: '插件自带 · 兜底模型（不可删除）；最快，显存约 1.5GB',
      sizeMB: 1080.6,
      installed: true,
      bytes: 1133000000,
      license: 'Apache-2.0',
      copyright: '© Tencent Hunyuan',
      source: 'tencent/Hy-MT2-1.8B-GGUF',
    },
    {
      id: 'hy-mt2-7b-q4',
      label: 'Hy-MT2 7B Q4_K_M',
      bundled: false,
      note: '质量最好，显存约 4.5GB',
      sizeMB: 4410.4,
      installed: false,
      bytes: 0,
      license: 'Apache-2.0',
      copyright: '© Tencent Hunyuan',
      source: 'tencent/Hy-MT2-7B-GGUF',
    },
  ],
  download: [
    { id: 'hy-mt2-1.8b-q4', phase: 'idle', received: 0, total: 0 },
    { id: 'hy-mt2-7b-q4', phase: 'idle', received: 0, total: 0 },
  ],
  chain: ['llamacpp', 'google'],
  enabled: true,
  target: 'zh-Hans',
  bundledReady: true,
  cache: {
    entries: 12,
    bytes: 3 * 1024 * 1024,
    limitBytes: 50 * 1024 * 1024,
    dir: 'C:/tmp/cache',
  },
  languages: [
    { code: 'zh-Hans', en: 'Simplified Chinese', zh: '简体中文' },
    { code: 'en', en: 'English', zh: '英语' },
    { code: 'ja', en: 'Japanese', zh: '日语' },
  ],
  localPort: 28457,
}

test('设置页：挂载后渲染开关、时机、模型、端口、缓存与版权信息', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
  })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
  }
  globalThis.window = dom.window
  globalThis.document = dom.window.document

  const fetchStub = async (url) => {
    if (String(url).includes('/_cotx/port')) {
      return { ok: true, status: 200, json: async () => ({ port: 28457, free: true, ours: false }) }
    }
    return { ok: true, status: 200, json: async () => STATE }
  }
  globalThis.fetch = fetchStub
  dom.window.fetch = fetchStub
  let root

  try {
    // jsdom 的 AbortSignal 未必实现静态 timeout；apiGet 会用到它。
    if (typeof dom.window.AbortSignal.timeout !== 'function') {
      Object.defineProperty(dom.window.AbortSignal, 'timeout', {
        value: () => new dom.window.AbortController().signal,
        configurable: true,
      })
    }
    let captured
    dom.window.__ModuleLoader__ = {
      load(options) {
        captured = options
      },
    }
    dom.window.eval(SOURCE)
    const client = captured.factory(REQUIRE)

    const React = REQUIRE('react')
    const { createRoot } = REQUIRE('react-dom/client')
    const container = dom.window.document.getElementById('root')
    root = createRoot(container)
    root.render(React.createElement(client.SettingsSection, { t: client.fallbackTranslate }))

    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      // 等异步的端口探测也回填（状态行出现）
      if (
        container.textContent.includes('本地服务端口') &&
        container.textContent.includes('端口空闲')
      ) {
        break
      }
    }

    const text = container.textContent
    assert.ok(text.includes('思维链翻译'), `应渲染标题: ${text.slice(0, 200)}`)
    assert.ok(text.includes('启用翻译'), `应有翻译开关: ${text.slice(0, 400)}`)
    assert.ok(text.includes('半自动'), '应有时机切换')
    assert.ok(text.includes('Hy-MT2 1.8B Q4_K_M'), '应列出模型')
    assert.ok(text.includes('下载'), '未安装模型应有下载按钮')
    assert.ok(text.includes('llamacpp → google'), '应显示当前翻译链')
    assert.ok(text.includes('3.0 MB / 50.0 MB'), '应显示缓存用量')
    assert.ok(text.includes('清理缓存'), '应有清理缓存按钮')
    assert.ok(text.includes('译文语言'), '应有目标语言选择')
    assert.ok(text.includes('本地服务端口'), '应有服务端口设置')
    assert.ok(text.includes('端口空闲'), '应显示端口状态')
    assert.ok(text.includes('© 2026 dsh-cot-translate contributors'), '底部应有版权信息')
    assert.ok(text.includes('MIT License'), '底部应显示许可证')
    assert.ok(/v\d+\.\d+\.\d+/.test(text), '底部应显示版本号')
    assert.ok(text.includes('Apache-2.0'), '模型行应显示许可证')
    assert.ok(text.includes('© Tencent Hunyuan'), '模型行应显示版权')
    assert.ok(text.includes('tencent/Hy-MT2-1.8B-GGUF'), '模型行应显示来源仓库')
    assert.ok(text.includes('第三方组件'), '底部应有第三方组件许可摘要')
  } finally {
    try {
      root.unmount()
    } catch {
      // 卸载失败不影响断言结果
    }
    globalThis.window = previous.window
    globalThis.document = previous.document
    globalThis.fetch = previous.fetch
    dom.window.close()
  }
})
