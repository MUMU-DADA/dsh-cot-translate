/**
 * 设置页：DSH「设置 → 思维链翻译」整个页面（`settings.section` 槽位）。
 *
 * 纯 React + 原生控件（不依赖 ui-primitives），所有数据走自己的 host 路由：
 *   GET  /_cotx/state
 *   POST /_cotx/settings
 *   POST /_cotx/models/download | /_cotx/models/delete
 *   POST /_cotx/selftest
 * 改动即时生效（host 会重建翻译器并重启本地服务）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createElement as h } from 'react'
import type { ReactElement } from 'react'
import { apiGet, apiPost } from './api'
import type { Translate } from './cordis'
import { formatNumber, localize, fallbackTranslate } from './locales'
import { loadPrefs, setPrefs } from './prefs'

/** host `/state` 的形状（只声明用到的字段）。 */
interface ModelStatusLike {
  id: string
  label: string
  bundled: boolean
  note: string
  noteKey?: string
  sizeMB: number
  installed: boolean
  bytes: number
  license: string
  copyright: string
  source: string
}

interface DownloadStateLike {
  id: string
  phase: 'idle' | 'downloading' | 'done' | 'error'
  received: number
  total: number
  error?: string
}

interface SettingsLike {
  enabled: boolean
  mode: 'semi' | 'auto'
  modelId: string
  useSessionModel: boolean
  target: string
}

interface CacheStatsLike {
  entries: number
  bytes: number
  limitBytes: number
  dir: string
}

interface LanguageLike {
  code: string
  en: string
  zh: string
}

interface StateLike {
  settings: SettingsLike
  models: ModelStatusLike[]
  download: DownloadStateLike[]
  chain: string[]
  enabled: boolean
  target: string
  bundledReady: boolean
  cache: CacheStatsLike
  languages: LanguageLike[]
  localPort: number
}

interface PortStatusLike {
  port: number
  free: boolean
  ours: boolean
}

interface SelfTestLike {
  ok: boolean
  provider: string
  ms: number
  perSegmentMs: number
  segments: number
  errorCode?: 'all-unavailable' | 'failed'
  error?: string
}

/** 构建时由 esbuild `define` 注入的插件版本号。 */
declare const __COTX_VERSION__: string

export interface SettingsSectionProps {
  /** 宿主的本地化函数（注册时声明了 locale 才有）。 */
  t?: Translate
  /** 订阅界面语言变化（让设置页在切换语言后立即重渲染）。 */
  subscribeLocale?: (callback: () => void) => () => void
}

/** 按大小显示（MB / GB）。 */
function sizeText(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** 进度百分比（无总长时返回 0）。 */
function percent(state: DownloadStateLike | undefined): number {
  if (state === undefined || state.total <= 0) return 0
  return Math.min(100, Math.round((state.received / state.total) * 100))
}

/** 字节数 → 人类可读（KB / MB / GB）。 */
function bytesText(bytes: number): string {
  const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  if (bytes < 1024) return `${formatNumber(bytes)} B`
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, oneDecimal)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${formatNumber(bytes / 1024 / 1024, oneDecimal)} MB`
  return `${formatNumber(bytes / 1024 / 1024 / 1024, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`
}

/** 设置页组件。 */
export function SettingsSection(props: SettingsSectionProps): ReactElement {
  const tr = props.t ?? fallbackTranslate
  const [state, setState] = useState<StateLike | null>(null)
  const [error, setError] = useState<string>('')
  const [busy, setBusy] = useState<string>('')
  const [test, setTest] = useState<SelfTestLike | null>(null)
  const [portDraft, setPortDraft] = useState<string>('')
  // 语言切换时强制重渲染（t 是按当前 locale 动态解析的）
  const [, setLocaleTick] = useState(0)
  const [portStatus, setPortStatus] = useState<PortStatusLike | null>(null)
  const polling = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const next = await apiGet<StateLike>('/_cotx/state')
      setState(next)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      if (polling.current !== undefined) clearInterval(polling.current)
    }
  }, [refresh])


  // 有下载任务时轮询进度
  useEffect(() => {
    const downloading = (state?.download ?? []).some((item) => item.phase === 'downloading')
    if (!downloading) {
      if (polling.current !== undefined) {
        clearInterval(polling.current)
        polling.current = undefined
      }
      return
    }
    if (polling.current !== undefined) return
    polling.current = setInterval(() => {
      void refresh()
    }, 1500)
    return () => {
      if (polling.current !== undefined) {
        clearInterval(polling.current)
        polling.current = undefined
      }
    }
  }, [state?.download, refresh])

  const patch = useCallback(
    async (next: Partial<SettingsLike>) => {
      setBusy('save')
      try {
        const updated = await apiPost<StateLike>('/_cotx/settings', next)
        setState(updated)
        setPrefs(updated.settings)
        setError('')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy('')
      }
    },
    [],
  )

  const download = useCallback(
    async (id: string) => {
      setBusy(`download:${id}`)
      try {
        await apiPost('/_cotx/models/download', { id })
        await refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy('')
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      setBusy(`delete:${id}`)
      try {
        const updated = await apiPost<StateLike>('/_cotx/models/delete', { id })
        setState(updated)
        setPrefs(updated.settings)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy('')
      }
    },
    [],
  )

  useEffect(() => {
    const unsubscribe = props.subscribeLocale?.(() => {
      setLocaleTick((tick) => tick + 1)
    })
    return unsubscribe
  }, [props.subscribeLocale])

  const checkPort = useCallback(async (port: number) => {
    try {
      setPortStatus(await apiGet<PortStatusLike>(`/_cotx/port?port=${port}`))
    } catch {
      setPortStatus(null)
    }
  }, [])

  // 端口草稿跟随设置；并探测一次端口状态（放在 checkPort 定义之后，避免 TDZ）
  useEffect(() => {
    if (state === null) return
    setPortDraft(String(state.localPort))
    void checkPort(state.localPort)
  }, [state?.localPort, checkPort])

  const applyPort = useCallback(async () => {
    const value = Number(portDraft)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      setError(tr('set.portInvalid'))
      return
    }
    setBusy('port')
    try {
      const updated = await apiPost<StateLike>('/_cotx/settings', { localPort: value })
      setState(updated)
      setPrefs(updated.settings)
      setError('')
      await checkPort(value)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy('')
    }
  }, [portDraft, checkPort, tr])

  const clearCache = useCallback(async () => {
    setBusy('cache')
    try {
      const updated = await apiPost<StateLike>('/_cotx/cache/clear')
      setState(updated)
      setPrefs(updated.settings)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy('')
    }
  }, [])

  const selftest = useCallback(async () => {
    setBusy('selftest')
    setTest(null)
    try {
      const result = await apiPost<SelfTestLike>('/_cotx/selftest', undefined, 180000)
      setTest(result)
      await loadPrefs()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy('')
    }
  }, [])

  const heading = h('h2', { className: 'cotx-set-title' }, tr('set.title'))
  const intro = h('p', { className: 'cotx-set-intro' }, tr('set.intro'))

  if (state === null) {
    return h(
      'div',
      { className: 'cotx-set' },
      heading,
      h('p', { className: 'cotx-set-hint' }, error === '' ? tr('set.loading') : error),
    )
  }

  const settings = state.settings
  const downloadOf = (id: string) => state.download.find((item) => item.id === id)

  const toggleRow = (label: string, checked: boolean, onChange: (value: boolean) => void, hint?: string) =>
    h(
      'div',
      { className: 'cotx-set-row' },
      h('div', { className: 'cotx-set-label' }, label, hint === undefined ? null : h('div', { className: 'cotx-set-hint' }, hint)),
      h('label', { className: 'cotx-set-switch' }, h('input', {
        type: 'checkbox',
        checked,
        onChange: (event: { target: { checked: boolean } }) => onChange(event.target.checked),
      })),
    )

  const modelOptions = state.models.map((model) =>
    h(
      'option',
      {
        key: model.id,
        value: model.id,
        disabled: !model.installed,
      },
      `${model.label}${model.installed ? '' : `（${tr('set.notDownloaded')}）`}`,
    ),
  )

  const modelRows = state.models.map((model) => {
    const progress = downloadOf(model.id)
    const downloading = progress?.phase === 'downloading'
    const canDownload = busy !== `download:${model.id}`
    return h(
      'div',
      { className: 'cotx-set-model', key: model.id },
      h(
        'div',
        { className: 'cotx-set-model-main' },
        h('div', { className: 'cotx-set-model-name' }, model.label, model.bundled ? h('span', { className: 'cotx-set-badge' }, tr('set.bundled')) : null),
        h('div', { className: 'cotx-set-hint' }, localize(tr, model.noteKey, model.note)),
        h(
          'div',
          { className: 'cotx-set-hint' },
          `${model.license} · ${model.copyright} · ${model.source}`,
        ),
        h(
          'div',
          { className: 'cotx-set-hint' },
          model.installed
            ? `${tr('set.installed')} · ${(model.bytes / 1024 / 1024).toFixed(0)} MB`
            : `${tr('set.notInstalled')} · ${tr('set.aboutSize')} ${sizeText(model.sizeMB)}`,
          progress?.phase === 'error' && progress.error !== undefined
            ? ` · ${tr('set.downloadFailed')}: ${progress.error}`
            : null,
        ),
        downloading
          ? h(
              'div',
              { className: 'cotx-set-progress' },
              h('div', { className: 'cotx-set-bar', style: { width: `${percent(progress)}%` } }),
              h('span', { className: 'cotx-set-hint' }, `${percent(progress)}%`),
            )
          : null,
      ),
      h(
        'div',
        { className: 'cotx-set-actions' },
        !model.installed || progress?.phase === 'error'
          ? h(
              'button',
              {
                type: 'button',
                className: 'cotx-set-btn',
                disabled: !canDownload,
                onClick: () => {
                  void download(model.id)
                },
              },
              model.installed ? tr('set.update') : tr('set.download'),
            )
          : null,
        model.installed
          ? h(
              'button',
              {
                type: 'button',
                className: 'cotx-set-btn',
                disabled: busy === `download:${model.id}`,
                onClick: () => {
                  void download(model.id)
                },
              },
              tr('set.update'),
            )
          : null,
        !model.bundled && model.installed
          ? h(
              'button',
              {
                type: 'button',
                className: 'cotx-set-btn cotx-set-btn-danger',
                disabled: busy === `delete:${model.id}`,
                onClick: () => {
                  void remove(model.id)
                },
              },
              tr('set.delete'),
            )
          : null,
      ),
    )
  })

  const modeRow = h(
    'div',
    { className: 'cotx-set-row' },
    h(
      'div',
      { className: 'cotx-set-label' },
      tr('set.mode'),
      h('div', { className: 'cotx-set-hint' }, tr('set.modeHint')),
    ),
    h(
      'div',
      { className: 'cotx-set-segmented' },
      h(
        'label',
        { className: `cotx-set-seg${settings.mode === 'semi' ? ' is-active' : ''}` },
        h('input', {
          type: 'radio',
          name: 'cotx-mode',
          checked: settings.mode === 'semi',
          onChange: () => {
            void patch({ mode: 'semi' })
          },
        }),
        tr('set.modeSemi'),
      ),
      h(
        'label',
        { className: `cotx-set-seg${settings.mode === 'auto' ? ' is-active' : ''}` },
        h('input', {
          type: 'radio',
          name: 'cotx-mode',
          checked: settings.mode === 'auto',
          onChange: () => {
            void patch({ mode: 'auto' })
          },
        }),
        tr('set.modeAuto'),
      ),
    ),
  )

  const targetRow = h(
    'div',
    { className: 'cotx-set-row' },
    h(
      'div',
      { className: 'cotx-set-label' },
      tr('set.target'),
      h('div', { className: 'cotx-set-hint' }, tr('set.targetHint')),
    ),
    h(
      'select',
      {
        className: 'cotx-set-select',
        value: settings.target,
        onChange: (event: { target: { value: string } }) => {
          void patch({ target: event.target.value })
        },
      },
      settings.target === ''
        ? h('option', { key: 'unset', value: '' }, tr('set.targetUnset'))
        : null,
      state.languages.map((language) =>
        h('option', { key: language.code, value: language.code }, language.zh),
      ),
    ),
  )

  const portStatusText =
    portStatus === null
      ? ''
      : portStatus.free
        ? tr('set.portFree')
        : portStatus.ours
          ? tr('set.portOurs')
          : tr('set.portBusy')

  const portRow = h(
    'div',
    { className: 'cotx-set-row' },
    h(
      'div',
      { className: 'cotx-set-label' },
      tr('set.port'),
      h('div', { className: 'cotx-set-hint' }, tr('set.portHint')),
      portStatusText === ''
        ? null
        : h(
            'div',
            {
              className: portStatus?.free === true ? 'cotx-set-ok' : 'cotx-set-bad',
            },
            portStatusText,
          ),
    ),
    h(
      'div',
      { className: 'cotx-set-actions' },
      h('input', {
        type: 'number',
        className: 'cotx-set-input',
        min: 1024,
        max: 65535,
        value: portDraft,
        onChange: (event: { target: { value: string } }) => setPortDraft(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === 'Enter') void applyPort()
        },
      }),
      h(
        'button',
        {
          type: 'button',
          className: 'cotx-set-btn',
          disabled: busy === 'port',
          onClick: () => {
            void applyPort()
          },
        },
        tr('set.portSave'),
      ),
    ),
  )

  const cacheRow = h(
    'div',
    { className: 'cotx-set-row' },
    h(
      'div',
      { className: 'cotx-set-label' },
      tr('set.cache'),
      h(
        'div',
        { className: 'cotx-set-hint' },
        tr('set.cacheHint', { limit: bytesText(state.cache.limitBytes) }),
      ),
      h(
        'div',
        { className: 'cotx-set-hint' },
        tr('set.cacheUsage', {
          used: bytesText(state.cache.bytes),
          limit: bytesText(state.cache.limitBytes),
          entries: String(state.cache.entries),
        }),
      ),
    ),
    h(
      'div',
      { className: 'cotx-set-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'cotx-set-btn',
          disabled: busy === 'cache' || state.cache.entries === 0,
          onClick: () => {
            void clearCache()
          },
        },
        busy === 'cache' ? tr('set.cacheCleared') : tr('set.cacheClear'),
      ),
    ),
  )

  const testRow = h(
    'div',
    { className: 'cotx-set-row' },
    h(
      'div',
      { className: 'cotx-set-label' },
      tr('set.selftest'),
      h('div', { className: 'cotx-set-hint' }, tr('set.selftestHint')),
    ),
    h(
      'div',
      { className: 'cotx-set-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'cotx-set-btn',
          disabled: busy === 'selftest',
          onClick: () => {
            void selftest()
          },
        },
        busy === 'selftest' ? tr('set.selftestRunning') : tr('set.selftestStart'),
      ),
      test === null
        ? null
        : h(
            'span',
            { className: test.ok ? 'cotx-set-ok' : 'cotx-set-bad' },
            test.ok
              ? tr('set.selftestResult', {
                  api: localize(tr, `provider.${test.provider}`, test.provider),
                  ms: test.perSegmentMs,
                })
              : `${tr('set.selftestFailed')}: ${
                  test.errorCode === 'all-unavailable'
                    ? tr('set.selftestAllUnavailable')
                    : (test.error ?? '')
                }`,
          ),
    ),
  )

  const footer = h(
    'div',
    { className: 'cotx-set-footer' },
    h('div', null, tr('set.copyright')),
    h(
      'div',
      { className: 'cotx-set-footer-sub' },
      typeof __COTX_VERSION__ === 'string'
        ? tr('set.version', { version: __COTX_VERSION__ })
        : tr('set.versionUnknown'),
    ),
    h('div', { className: 'cotx-set-footer-sub' }, tr('set.thirdParty')),
  )

  return h(
    'div',
    { className: 'cotx-set' },
    heading,
    intro,
    error === '' ? null : h('p', { className: 'cotx-set-bad' }, error),
    toggleRow(tr('set.enabled'), settings.enabled, (value) => {
      void patch({ enabled: value })
    }, tr('set.enabledHint')),
    modeRow,
    targetRow,
    h(
      'div',
      { className: 'cotx-set-row' },
      h(
        'div',
        { className: 'cotx-set-label' },
        tr('set.model'),
        h('div', { className: 'cotx-set-hint' }, tr('set.modelHint')),
      ),
      h(
        'select',
        {
          className: 'cotx-set-select',
          value: settings.modelId,
          onChange: (event: { target: { value: string } }) => {
            void patch({ modelId: event.target.value })
          },
        },
        modelOptions,
      ),
    ),
    h('div', { className: 'cotx-set-models' }, ...modelRows),
    h(
      'div',
      { className: 'cotx-set-row' },
      h(
        'div',
        { className: 'cotx-set-label' },
        tr('set.sessionModel'),
        h('div', { className: 'cotx-set-hint' }, tr('set.sessionModelHint')),
      ),
      h('label', { className: 'cotx-set-switch' }, h('input', {
        type: 'checkbox',
        checked: settings.useSessionModel,
        onChange: (event: { target: { checked: boolean } }) => {
          void patch({ useSessionModel: event.target.checked })
        },
      })),
    ),
    cacheRow,
    portRow,
    testRow,
    h(
      'p',
      { className: 'cotx-set-hint' },
      `${tr('set.chain')}: ${state.chain
        .map((id) => localize(tr, `provider.${id}`, id))
        .join(' → ')}`,
    ),
    footer,
  )
}
